from __future__ import annotations

from dataclasses import dataclass, field
from io import BytesIO
import re
from statistics import median
from typing import Any, Literal

import pymupdf
import pdfplumber
from pdfplumber.page import Page
from pydantic import BaseModel, Field


BlockKind = Literal["paragraph", "heading", "metadata", "list", "caption", "table", "figure"]


class TextSpan(BaseModel):
    text: str
    bold: bool = False
    italic: bool = False


class ImportedBlock(BaseModel):
    kind: BlockKind
    text: str = Field(min_length=1)
    heading_level: int | None = None
    spans: list[TextSpan] = Field(default_factory=list)
    rows: list[list[str]] | None = None
    page_number: int | None = None
    bbox: tuple[float, float, float, float] | None = Field(default=None, exclude=True)


class PdfImportResponse(BaseModel):
    filename: str
    page_count: int
    character_count: int
    blocks: list[ImportedBlock]


class PdfImportError(ValueError):
    pass


@dataclass(frozen=True)
class WordToken:
    text: str
    x0: float
    x1: float
    top: float
    bottom: float
    size: float
    fontname: str
    bold: bool
    italic: bool


@dataclass
class TextLine:
    words: list[WordToken]
    page_number: int
    x0: float
    x1: float
    top: float
    bottom: float
    size: float
    bold_ratio: float
    italic_ratio: float
    text: str
    spans: list[TextSpan]


@dataclass
class DraftBlock:
    kind: BlockKind
    lines: list[TextLine] = field(default_factory=list)
    text: str = ""
    spans: list[TextSpan] = field(default_factory=list)
    heading_level: int | None = None
    rows: list[list[str]] | None = None
    page_number: int | None = None
    bbox: tuple[float, float, float, float] | None = None
    layout_order: int = 0


def extract_pdf_content(raw_pdf: bytes, filename: str) -> PdfImportResponse:
    """Extract editable text blocks from a text-based PDF."""
    if not raw_pdf or not raw_pdf.lstrip().startswith(b"%PDF"):
        raise PdfImportError("The uploaded file is not a valid PDF.")

    try:
        with pdfplumber.open(BytesIO(raw_pdf)) as pdf, pymupdf.open(stream=raw_pdf, filetype="pdf") as pymupdf_doc:
            page_line_sets = [
                extract_text_lines_from_pymupdf(pymupdf_doc[index], page_number=index + 1)
                for index in range(len(pymupdf_doc))
            ]
            repeated_peripheral_texts = repeated_peripheral_lines(page_line_sets, pymupdf_doc)
            page_blocks = [
                extract_page_blocks(
                    pdf.pages[index],
                    pymupdf_doc[index],
                    page_number=index + 1,
                    text_lines=page_line_sets[index],
                    repeated_peripheral_texts=repeated_peripheral_texts,
                )
                for index in range(len(pdf.pages))
            ]
            page_count = len(pdf.pages)
    except Exception as exc:
        raise PdfImportError("PDF text extraction failed. The file may be encrypted, invalid, or unsupported.") from exc

    blocks = postprocess_blocks([block for page in page_blocks for block in page])
    character_count = sum(len(block.text) for block in blocks)

    if not blocks or character_count == 0:
        raise PdfImportError(
            "No usable text could be extracted. Phase 2 supports text-based PDFs only and does not include OCR."
        )

    return PdfImportResponse(
        filename=filename,
        page_count=page_count,
        character_count=character_count,
        blocks=blocks,
    )


def extract_page_blocks(
    page: Page,
    pymupdf_page: pymupdf.Page,
    page_number: int,
    text_lines: list[TextLine],
    repeated_peripheral_texts: set[str],
) -> list[ImportedBlock]:
    table_blocks, table_bboxes = extract_tables(page, page_number)
    figure_blocks = extract_figures(page, page_number)
    body_size = body_font_size(text_lines)
    lines = [
        line
        for line in text_lines
        if not point_in_bboxes(line_center(line), table_bboxes)
        and not is_peripheral_line(line, float(pymupdf_page.rect.height), body_size, repeated_peripheral_texts)
    ]
    ordered_lines = merge_split_heading_number_lines(order_lines_by_layout(lines, page_width=float(pymupdf_page.rect.width)))

    table_drafts: list[DraftBlock] = [
        DraftBlock(
            kind="table",
            text=block.text,
            rows=block.rows,
            page_number=page_number,
            bbox=block.bbox,
        )
        for block in table_blocks
    ]

    figure_drafts = [
        DraftBlock(
            kind="figure",
            text=block.text,
            page_number=page_number,
            bbox=block.bbox,
        )
        for block in figure_blocks
    ]

    text_blocks = reconstruct_text_blocks(ordered_lines, body_size=body_font_size(ordered_lines))
    layout_items = merge_layout_blocks(text_blocks, table_drafts + figure_drafts)
    return [to_imported_block(block) for block in layout_items]


def extract_text_lines_from_pymupdf(page: pymupdf.Page, page_number: int) -> list[TextLine]:
    """Use PyMuPDF's block/line model as the text-layout source."""
    page_dict = page.get_text("dict", sort=False)
    lines: list[TextLine] = []

    for block in page_dict.get("blocks", []):
        if block.get("type") != 0:
            continue

        for raw_line in block.get("lines", []):
            spans = text_spans_from_pymupdf_line(raw_line)
            text = normalize_block_text(merge_spans_text(spans))
            if not text:
                continue

            bbox = tuple(float(value) for value in raw_line.get("bbox", block.get("bbox", (0, 0, 0, 0))))
            sizes = [float(span.get("size") or 0) for span in raw_line.get("spans", []) if span.get("text")]
            fontnames = [str(span.get("font") or "") for span in raw_line.get("spans", []) if span.get("text")]
            bold_count = sum(1 for fontname in fontnames if is_bold_font(fontname))
            italic_count = sum(1 for fontname in fontnames if is_italic_font(fontname))

            lines.append(
                TextLine(
                    words=[],
                    page_number=page_number,
                    x0=bbox[0],
                    x1=bbox[2],
                    top=bbox[1],
                    bottom=bbox[3],
                    size=median(sizes) if sizes else 0,
                    bold_ratio=bold_count / len(fontnames) if fontnames else 0,
                    italic_ratio=italic_count / len(fontnames) if fontnames else 0,
                    text=text,
                    spans=spans,
                )
            )

    return lines


def text_spans_from_pymupdf_line(raw_line: dict[str, Any]) -> list[TextSpan]:
    spans: list[TextSpan] = []
    previous_x1: float | None = None

    for raw_span in raw_line.get("spans", []):
        text = re.sub(r"\s+", " ", str(raw_span.get("text") or ""))
        if not text.strip():
            continue

        bbox = tuple(float(value) for value in raw_span.get("bbox", (0, 0, 0, 0)))
        fontname = str(raw_span.get("font") or "")
        size = float(raw_span.get("size") or 0)

        if previous_x1 is not None and needs_span_space(spans[-1].text if spans else "", text, bbox[0] - previous_x1, size):
            text = " " + text

        append_span(spans, TextSpan(text=text, bold=is_bold_font(fontname), italic=is_italic_font(fontname)))
        previous_x1 = bbox[2]

    return spans


def needs_span_space(previous_text: str, next_text: str, horizontal_gap: float, font_size: float) -> bool:
    if horizontal_gap <= max(font_size * 0.16, 1.2):
        return False
    if not previous_text or previous_text.endswith((" ", "-", "/", "(", "[", "{")):
        return False
    if next_text.startswith((" ", ",", ".", ";", ":", "!", "?", ")", "]", "}")):
        return False
    return True


def repeated_peripheral_lines(page_line_sets: list[list[TextLine]], doc: pymupdf.Document) -> set[str]:
    page_occurrences: dict[str, set[int]] = {}
    if len(page_line_sets) < 2:
        return set()

    for page_index, lines in enumerate(page_line_sets):
        page_height = float(doc[page_index].rect.height)
        for line in lines:
            if not is_near_page_edge(line, page_height):
                continue
            key = repeated_line_key(line.text)
            if not key:
                continue
            page_occurrences.setdefault(key, set()).add(page_index)

    return {key for key, pages in page_occurrences.items() if len(pages) > 1}


def repeated_line_key(text: str) -> str:
    return re.sub(r"\s+", " ", text.casefold()).strip()


def is_peripheral_line(line: TextLine, page_height: float, body_size: float, repeated_peripheral_texts: set[str]) -> bool:
    text = line.text.strip()
    lowered = text.casefold()
    edge = is_near_page_edge(line, page_height)

    if is_publication_boilerplate(lowered) or ("license" in lowered and line.size <= max(body_size * 0.86, 7.5)):
        return True
    if repeated_line_key(text) in repeated_peripheral_texts:
        return True
    if is_likely_running_header(line, page_height, body_size, text):
        return True
    if not edge:
        return False
    if line.page_number > 1 and looks_like_person_or_affiliation(text):
        return True
    if re.fullmatch(r"\d+", text):
        return True
    if line.size and line.size <= max(body_size * 0.86, 7.5):
        return True
    return any(marker in lowered for marker in PERIPHERAL_MARKERS)


def is_likely_running_header(line: TextLine, page_height: float, body_size: float, text: str) -> bool:
    if line.page_number <= 1 or line.top > max(72, page_height * 0.1):
        return False
    return line.size <= max(body_size * 0.86, 7.5) or looks_like_person_or_affiliation(text)


def is_publication_boilerplate(lowered: str) -> bool:
    return any(
        marker in lowered
        for marker in (
            "this work is licensed under",
            "permission to make digital or hard copies",
            "creative commons attribution",
            "acm isbn",
        )
    )


def is_near_page_edge(line: TextLine, page_height: float) -> bool:
    return line.top < 34 or line.bottom > page_height - 28


def order_lines_by_layout(lines: list[TextLine], page_width: float) -> list[TextLine]:
    if not lines:
        return []

    has_two_columns = detect_two_columns([line for line in lines if is_column_candidate(line, page_width)], page_width)
    if not has_two_columns:
        return sorted(lines, key=lambda line: (line.top, line.x0))

    column_top = detect_column_region_top(lines, page_width)
    front_matter = [line for line in lines if line.top < column_top - 3]
    remaining = [line for line in lines if line.top >= column_top - 3]
    full_width = [line for line in remaining if is_full_width_line(line, page_width)]
    column_lines = [line for line in remaining if line not in full_width]

    split_x = infer_column_split(column_lines, page_width)
    left = [line for line in column_lines if is_left_column_line(line, split_x, page_width)]
    right = [line for line in column_lines if not is_left_column_line(line, split_x, page_width)]

    return (
        sorted(front_matter, key=lambda line: (line.top, line.x0))
        + sorted(left, key=lambda line: (line.top, line.x0))
        + sorted(right, key=lambda line: (line.top, line.x0))
        + sorted(full_width, key=lambda line: (line.top, line.x0))
    )


def merge_split_heading_number_lines(lines: list[TextLine]) -> list[TextLine]:
    merged: list[TextLine] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if index + 1 < len(lines) and is_heading_number_line(line) and can_merge_heading_number(line, lines[index + 1]):
            merged.append(combine_text_lines(line, lines[index + 1], separator=" "))
            index += 2
        else:
            merged.append(line)
            index += 1
    return merged


def is_heading_number_line(line: TextLine) -> bool:
    return bool(re.fullmatch(r"\d+(?:\.\d+)*", line.text.strip()))


def can_merge_heading_number(number_line: TextLine, heading_line: TextLine) -> bool:
    gap = heading_line.top - number_line.bottom
    heading_text = heading_line.text.strip()
    if gap > max(number_line.size * 1.4, 14):
        return False
    if abs(number_line.x0 - heading_line.x0) > 28:
        return False
    if len(heading_text.split()) > 8:
        return False
    if "." in number_line.text and len(heading_text.split()) <= 4:
        return True
    return heading_text.isupper() or strip_heading_number(heading_text).casefold() in ACADEMIC_HEADINGS


def combine_text_lines(first: TextLine, second: TextLine, separator: str) -> TextLine:
    spans = [span.model_copy() for span in first.spans]
    if spans:
        spans[-1].text += separator
    spans.extend(span.model_copy() for span in second.spans)
    text = normalize_block_text(merge_spans_text(spans))
    return TextLine(
        words=[],
        page_number=first.page_number,
        x0=min(first.x0, second.x0),
        x1=max(first.x1, second.x1),
        top=min(first.top, second.top),
        bottom=max(first.bottom, second.bottom),
        size=median([value for value in (first.size, second.size) if value]) if first.size or second.size else 0,
        bold_ratio=max(first.bold_ratio, second.bold_ratio),
        italic_ratio=max(first.italic_ratio, second.italic_ratio),
        text=text,
        spans=spans,
    )


def detect_column_region_top(lines: list[TextLine], page_width: float) -> float:
    body_start_tops = [line.top for line in lines if is_body_start_line(line.text)]
    if body_start_tops:
        return min(body_start_tops)

    candidates = [line for line in lines if is_column_candidate(line, page_width)]
    return min((line.top for line in candidates), default=min(line.top for line in lines))


def is_body_start_line(text: str) -> bool:
    stripped = strip_heading_number(text).strip(":").casefold()
    return stripped in {"abstract", "introduction", "1 introduction"}


def infer_column_split(column_lines: list[TextLine], page_width: float) -> float:
    if not column_lines:
        return page_width / 2

    left_edges = [line.x0 for line in column_lines if line.x0 < page_width * 0.35]
    right_edges = [line.x0 for line in column_lines if line.x0 > page_width * 0.45]
    if left_edges and right_edges:
        return (median(left_edges) + median(right_edges)) / 2
    return page_width / 2


def is_column_candidate(line: TextLine, page_width: float) -> bool:
    return line.x1 - line.x0 < page_width * 0.52 and not is_centered_short_line(line, page_width)


def is_full_width_line(line: TextLine, page_width: float) -> bool:
    return line.x0 < page_width * 0.15 and line.x1 > page_width * 0.82


def is_left_column_line(line: TextLine, split_x: float, page_width: float) -> bool:
    if is_citation_fragment(line.text):
        return line.x0 < page_width / 2
    return (line.x0 + line.x1) / 2 < split_x


def is_centered_short_line(line: TextLine, page_width: float) -> bool:
    center = (line.x0 + line.x1) / 2
    return abs(center - page_width / 2) < page_width * 0.12 and line.x1 - line.x0 < page_width * 0.42


def extract_text_lines_from_words(
    page: Page,
    page_number: int,
    excluded_bboxes: list[tuple[float, float, float, float]],
) -> list[TextLine]:
    words = [
        word
        for word in page.extract_words(
            x_tolerance=2,
            y_tolerance=3,
            keep_blank_chars=False,
            use_text_flow=False,
            extra_attrs=["fontname", "size"],
        )
        if word.get("text") and not point_in_bboxes(word_center(word), excluded_bboxes)
    ]
    tokens = [word_token(word) for word in words]
    return order_lines(group_words_into_lines(tokens, page_number), page_width=float(page.width))


def word_token(word: dict[str, Any]) -> WordToken:
    fontname = str(word.get("fontname") or "")
    size = float(word.get("size") or 0)
    return WordToken(
        text=normalize_token(str(word["text"])),
        x0=float(word["x0"]),
        x1=float(word["x1"]),
        top=float(word["top"]),
        bottom=float(word["bottom"]),
        size=size,
        fontname=fontname,
        bold=is_bold_font(fontname),
        italic=is_italic_font(fontname),
    )


def group_words_into_lines(tokens: list[WordToken], page_number: int) -> list[TextLine]:
    if not tokens:
        return []

    sorted_tokens = sorted(tokens, key=lambda token: (token.top, token.x0))
    line_groups: list[list[WordToken]] = []
    for token in sorted_tokens:
        if not line_groups:
            line_groups.append([token])
            continue

        current = line_groups[-1]
        current_mid = median([(word.top + word.bottom) / 2 for word in current])
        token_mid = (token.top + token.bottom) / 2
        tolerance = max(3.0, median([word.bottom - word.top for word in current]) * 0.45)

        if abs(token_mid - current_mid) <= tolerance:
            current.append(token)
        else:
            line_groups.append([token])

    split_groups = [segment for group in line_groups for segment in split_line_group_by_gaps(group)]
    return [line_from_words(group, page_number) for group in split_groups]


def split_line_group_by_gaps(words: list[WordToken]) -> list[list[WordToken]]:
    sorted_words = sorted(words, key=lambda word: word.x0)
    if len(sorted_words) < 2:
        return [sorted_words]

    word_widths = [max(word.x1 - word.x0, 1) for word in sorted_words]
    font_sizes = [word.size for word in sorted_words if word.size]
    gap_threshold = max(24.0, median(word_widths) * 2.5, (median(font_sizes) if font_sizes else 10.0) * 2.4)

    groups: list[list[WordToken]] = [[sorted_words[0]]]
    for previous, word in zip(sorted_words, sorted_words[1:]):
        gap = word.x0 - previous.x1
        if gap > gap_threshold:
            groups.append([word])
        else:
            groups[-1].append(word)

    return groups


def line_from_words(words: list[WordToken], page_number: int) -> TextLine:
    sorted_words = sorted(words, key=lambda word: word.x0)
    spans = spans_from_words(sorted_words)
    text = merge_spans_text(spans)
    return TextLine(
        words=sorted_words,
        page_number=page_number,
        x0=min(word.x0 for word in sorted_words),
        x1=max(word.x1 for word in sorted_words),
        top=min(word.top for word in sorted_words),
        bottom=max(word.bottom for word in sorted_words),
        size=median([word.size for word in sorted_words if word.size]) if sorted_words else 0,
        bold_ratio=sum(1 for word in sorted_words if word.bold) / len(sorted_words),
        italic_ratio=sum(1 for word in sorted_words if word.italic) / len(sorted_words),
        text=text,
        spans=spans,
    )


def spans_from_words(words: list[WordToken]) -> list[TextSpan]:
    spans: list[TextSpan] = []
    previous: WordToken | None = None

    for word in words:
        token = normalize_token(word.text)
        if not token:
            continue

        prefix = spacing_between(previous, word)
        append_span(spans, TextSpan(text=prefix + token, bold=word.bold, italic=word.italic))
        previous = word

    return spans


def spacing_between(previous: WordToken | None, word: WordToken) -> str:
    if previous is None:
        return ""
    if re.fullmatch(r"[,.;:!?%)]", word.text):
        return ""
    if previous.text in {"(", "[", "{"}:
        return ""
    return " "


def order_lines(lines: list[TextLine], page_width: float) -> list[TextLine]:
    if not lines:
        return []

    full_width_threshold = page_width * 0.58
    column_candidates = [line for line in lines if line.x1 - line.x0 < full_width_threshold]
    has_two_columns = detect_two_columns(column_candidates, page_width)

    if not has_two_columns:
        return sorted(lines, key=lambda line: (line.top, line.x0))

    midline = page_width / 2
    full_width = [line for line in lines if line.x0 < page_width * 0.2 and line.x1 > page_width * 0.8]
    column_lines = [line for line in lines if line not in full_width]
    before_columns = [line for line in full_width if line.top < min(line.top for line in column_lines)]
    after_or_inside = [line for line in full_width if line not in before_columns]
    left = [line for line in column_lines if (line.x0 + line.x1) / 2 < midline]
    right = [line for line in column_lines if (line.x0 + line.x1) / 2 >= midline]

    return (
        sorted(before_columns, key=lambda line: (line.top, line.x0))
        + sorted(left, key=lambda line: (line.top, line.x0))
        + sorted(right, key=lambda line: (line.top, line.x0))
        + sorted(after_or_inside, key=lambda line: (line.top, line.x0))
    )


def detect_two_columns(lines: list[TextLine], page_width: float) -> bool:
    if len(lines) < 6:
        return False
    midline = page_width / 2
    left = [line for line in lines if line.x1 < midline + page_width * 0.08]
    right = [line for line in lines if line.x0 > midline - page_width * 0.08]
    if len(left) < 3 or len(right) < 3:
        return False
    return median([line.x0 for line in right]) - median([line.x0 for line in left]) > page_width * 0.25


def reconstruct_text_blocks(lines: list[TextLine], body_size: float) -> list[DraftBlock]:
    blocks: list[DraftBlock] = []
    current: DraftBlock | None = None
    normal_gap = normal_line_gap(lines)

    for line in lines:
        kind = classify_line(line, body_size)

        if current and current.kind in {"paragraph", "list"} and kind == "paragraph" and should_merge_with_current(
            current, line, normal_gap
        ):
            current.lines.append(line)
            continue

        if kind == "list":
            if current:
                blocks.append(finalize_text_block(current))
            current = DraftBlock(kind="list", lines=[line], page_number=line.page_number)
            continue

        if kind != "paragraph":
            if current:
                blocks.append(finalize_text_block(current))
                current = None
            blocks.append(finalize_text_block(DraftBlock(kind=kind, lines=[line], page_number=line.page_number)))
            continue

        if current and should_merge_with_current(current, line, normal_gap):
            current.lines.append(line)
        else:
            if current:
                blocks.append(finalize_text_block(current))
            current = DraftBlock(kind="paragraph", lines=[line], page_number=line.page_number)

    if current:
        blocks.append(finalize_text_block(current))

    merged_blocks = merge_adjacent_headings(blocks, body_size)
    for index, block in enumerate(merged_blocks):
        block.layout_order = index
    return merged_blocks


def classify_line(line: TextLine, body_size: float) -> BlockKind:
    text = line.text.strip()
    words = text.split()

    if is_caption(text):
        return "caption"
    if is_figure_label(text):
        return "figure"
    if is_list_item(text):
        return "list"
    if is_conservative_heading(line, body_size):
        return "heading"
    if is_metadata_line(text):
        return "metadata"

    return "paragraph"


def is_conservative_heading(line: TextLine, body_size: float) -> bool:
    text = strip_heading_number(line.text).strip(":")
    words = text.split()
    if not text or len(words) > 14:
        return False
    if is_caption(text):
        return False
    known_heading = text.casefold() in ACADEMIC_HEADINGS
    size_signal = body_size > 0 and line.size >= body_size * 1.22
    weight_signal = line.bold_ratio >= 0.55
    short_signal = len(words) <= 8 and len(text) <= 90
    title_signal = line.page_number == 1 and line.top < 170 and line.size >= body_size * 1.35 and len(words) <= 14
    if title_signal and not is_metadata_line(text):
        return True
    if re.search(r"[.!?]$", text):
        return False
    if is_metadata_line(text) and not known_heading and not title_signal:
        return False
    if re.match(r"^\d+(?:\.\d+)*\.?\s+\S+", line.text):
        return len(words) <= 10
    return known_heading or title_signal or (size_signal and weight_signal and short_signal)


def should_merge_with_current(current: DraftBlock, line: TextLine, normal_gap: float) -> bool:
    previous = current.lines[-1]
    gap = line.top - previous.bottom
    if is_citation_fragment(line.text) and gap <= max(normal_gap * 2.0, previous.size * 1.2, 12):
        return True
    if gap > max(normal_gap * 1.75, previous.size * 1.35, 12):
        return False
    if re.search(r"[.!?]$", previous.text) and gap > max(normal_gap * 1.15, previous.size * 0.9, 10):
        return False
    if abs(line.size - previous.size) > max(1.8, previous.size * 0.18):
        return False
    if abs(line.x0 - previous.x0) > 28 and re.search(r"[.!?]$", previous.text):
        return False
    return True


def finalize_text_block(block: DraftBlock) -> DraftBlock:
    if not block.lines:
        return block
    text, spans = join_line_spans(block.lines)
    block.text = text
    block.spans = spans
    block.heading_level = infer_heading_level(block.lines[0]) if block.kind == "heading" else None
    block.page_number = block.lines[0].page_number
    block.bbox = (
        min(line.x0 for line in block.lines),
        min(line.top for line in block.lines),
        max(line.x1 for line in block.lines),
        max(line.bottom for line in block.lines),
    )
    return block


def join_line_spans(lines: list[TextLine]) -> tuple[str, list[TextSpan]]:
    spans: list[TextSpan] = []
    for index, line in enumerate(lines):
        line_spans = [span.model_copy() for span in line.spans]
        if not line_spans:
            continue
        if index > 0:
            apply_line_join(spans, line_spans)
        for span in line_spans:
            append_span(spans, span)
    return merge_spans_text(spans), spans


def apply_line_join(existing: list[TextSpan], incoming: list[TextSpan]) -> None:
    if not existing:
        return
    previous_text = existing[-1].text
    next_text = incoming[0].text.lstrip()
    if previous_text.endswith("-") and next_text[:1].islower() and should_remove_line_end_hyphen(previous_text, next_text):
        existing[-1].text = previous_text[:-1]
        incoming[0].text = next_text
    elif previous_text.endswith("-") and next_text[:1].islower():
        incoming[0].text = next_text
    else:
        incoming[0].text = " " + next_text


def should_remove_line_end_hyphen(previous_text: str, next_text: str) -> bool:
    previous_match = re.search(r"([A-Za-z]{2,})-$", previous_text)
    next_match = re.match(r"([a-z]{3,})", next_text)
    if not previous_match or not next_match:
        return False
    stem = previous_match.group(1)
    if "-" in stem or stem.isupper():
        return False
    return len(stem) <= 3 or len(stem) >= 5


def merge_adjacent_headings(blocks: list[DraftBlock], body_size: float) -> list[DraftBlock]:
    merged: list[DraftBlock] = []
    for block in blocks:
        if (
            merged
            and block.kind == "heading"
            and merged[-1].kind == "heading"
            and block.lines
            and merged[-1].lines
            and block.lines[0].page_number == merged[-1].lines[-1].page_number
            and block.lines[0].top - merged[-1].lines[-1].bottom < max(block.lines[0].size * 1.5, 18)
            and abs(block.lines[0].size - merged[-1].lines[-1].size) <= max(2, body_size * 0.18)
        ):
            merged[-1].lines.extend(block.lines)
            finalize_text_block(merged[-1])
        else:
            merged.append(block)
    return merged


def postprocess_blocks(blocks: list[ImportedBlock]) -> list[ImportedBlock]:
    processed: list[ImportedBlock] = []
    seen_first_major_heading = False

    for block in blocks:
        if block.kind == "heading" and block.page_number == 1:
            if not seen_first_major_heading:
                seen_first_major_heading = True
            elif block.heading_level == 1 and looks_like_person_or_affiliation(block.text):
                block = block.model_copy(update={"kind": "metadata", "heading_level": None})

        if block.kind == "paragraph" and looks_like_person_or_affiliation(block.text):
            block = block.model_copy(update={"kind": "metadata"})

        if block.kind == "paragraph" and is_caption(block.text):
            block = block.model_copy(update={"kind": "caption"})

        processed.append(block)

    return processed


def to_imported_block(block: DraftBlock) -> ImportedBlock:
    return ImportedBlock(
        kind=block.kind,
        text=normalize_block_text(block.text),
        heading_level=block.heading_level,
        spans=[span for span in block.spans if span.text],
        rows=block.rows,
        page_number=block.page_number,
    )


def extract_tables(page: Page, page_number: int) -> tuple[list[ImportedBlock], list[tuple[float, float, float, float]]]:
    blocks: list[ImportedBlock] = []
    bboxes: list[tuple[float, float, float, float]] = []
    try:
        tables = page.find_tables()
    except Exception:
        tables = []

    for index, table in enumerate(tables, start=1):
        rows = [
            [normalize_cell(cell) for cell in row]
            for row in (table.extract() or [])
            if any(normalize_cell(cell) for cell in row)
        ]
        if not rows:
            continue
        text = "\n".join(" | ".join(cell for cell in row if cell) for row in rows)
        block = ImportedBlock(
            kind="table",
            text=text or f"[Table detected on page {page_number}]",
            rows=rows,
            page_number=page_number,
            bbox=tuple(float(value) for value in table.bbox),
        )
        blocks.append(block)
        bboxes.append(tuple(float(value) for value in table.bbox))

    return blocks, bboxes


def extract_figures(page: Page, page_number: int) -> list[ImportedBlock]:
    blocks: list[ImportedBlock] = []
    for image in page.images:
        width = float(image.get("width") or image.get("x1", 0) - image.get("x0", 0))
        height = float(image.get("height") or image.get("bottom", 0) - image.get("top", 0))
        if width < 48 or height < 48:
            continue
        block = ImportedBlock(
            kind="figure",
            text=f"[Figure/image detected on page {page_number}]",
            page_number=page_number,
            bbox=(
                float(image.get("x0", 0)),
                float(image.get("top", 0)),
                float(image.get("x1", 0)),
                float(image.get("bottom", 0)),
            ),
        )
        blocks.append(block)
    return blocks


def merge_layout_blocks(text_blocks: list[DraftBlock], non_text_blocks: list[DraftBlock]) -> list[DraftBlock]:
    if not non_text_blocks:
        return text_blocks

    ordered: list[DraftBlock] = []
    pending = sorted(non_text_blocks, key=lambda block: (block_top(block), block_left(block)))

    for text_block in text_blocks:
        while pending and block_top(pending[0]) <= block_top(text_block):
            ordered.append(pending.pop(0))
        ordered.append(text_block)

    ordered.extend(pending)
    return ordered


def block_top(block: DraftBlock) -> float:
    return (block.bbox or (0, 0, 0, 0))[1]


def block_left(block: DraftBlock) -> float:
    return (block.bbox or (0, 0, 0, 0))[0]


def body_font_size(lines: list[TextLine]) -> float:
    candidates = [line.size for line in lines if len(line.text.split()) >= 5 and line.size > 0]
    if not candidates:
        candidates = [line.size for line in lines if line.size > 0]
    return median(candidates) if candidates else 11.0


def normal_line_gap(lines: list[TextLine]) -> float:
    gaps = [
        current.top - previous.bottom
        for previous, current in zip(lines, lines[1:])
        if 0 <= current.top - previous.bottom <= 24
    ]
    return median(gaps) if gaps else 4.0


def normalize_token(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def normalize_block_text(text: str) -> str:
    return re.sub(r"[ \t]+", " ", text).strip()


def normalize_cell(cell: object) -> str:
    return re.sub(r"\s+", " ", str(cell or "")).strip()


def append_span(spans: list[TextSpan], span: TextSpan) -> None:
    if not span.text:
        return
    if spans and spans[-1].bold == span.bold and spans[-1].italic == span.italic:
        spans[-1].text += span.text
    else:
        spans.append(span)


def merge_spans_text(spans: list[TextSpan]) -> str:
    return "".join(span.text for span in spans)


def is_bold_font(fontname: str) -> bool:
    return any(marker in fontname.casefold() for marker in ("bold", "black", "heavy", "semibold", "demi"))


def is_italic_font(fontname: str) -> bool:
    return any(marker in fontname.casefold() for marker in ("italic", "oblique", "slant"))


def is_caption(text: str) -> bool:
    return bool(re.match(r"^(?:fig\.?|figure|table)\s*\d+[a-z]?\s*[:.]", text.strip(), flags=re.IGNORECASE))


def is_figure_label(text: str) -> bool:
    return bool(re.fullmatch(r"\([a-z]\)", text.strip(), flags=re.IGNORECASE))


def is_list_item(text: str) -> bool:
    return bool(re.match(r"^(?:[-*•]\s+|\d+[.)]\s+|[a-z][.)]\s+)", text.strip(), flags=re.IGNORECASE))


def is_metadata_line(text: str) -> bool:
    lowered = text.casefold()
    if "@" in text or "doi:" in lowered or "http://" in lowered or "https://" in lowered:
        return True
    if contains_metadata_marker(lowered):
        return True
    if looks_like_person_or_affiliation(text):
        return True
    return False


def contains_metadata_marker(lowered: str) -> bool:
    for marker in METADATA_MARKERS:
        normalized_marker = marker.casefold().strip()
        if " " in normalized_marker:
            if normalized_marker in lowered:
                return True
        elif re.search(rf"\b{re.escape(normalized_marker)}\b", lowered):
            return True
    return False


def looks_like_person_or_affiliation(text: str) -> bool:
    stripped = text.strip()
    if strip_heading_number(stripped).strip(":").casefold() in ACADEMIC_HEADINGS:
        return False
    words = stripped.split()
    if not stripped or len(words) > 18:
        return False
    if re.search(r"[.!?]$", stripped):
        return False
    if contains_metadata_marker(stripped.casefold()):
        return True
    if "," in stripped and sum(word[:1].isupper() for word in words) >= max(2, len(words) // 2):
        return True
    if 2 <= len(words) <= 6 and all(re.match(r"^[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'.-]+,?$", word) for word in words):
        return True
    return False


def strip_heading_number(line: str) -> str:
    return re.sub(r"^\d+(?:\.\d+)*\.?\s+", "", line).strip()


def infer_heading_level(line: TextLine) -> int:
    match = re.match(r"^(\d+(?:\.\d+)*)\.?\s+", line.text)
    if match:
        return min(3, match.group(1).count(".") + 1)
    return 1 if line.size >= 16 else 2


def word_center(word: dict[str, Any]) -> tuple[float, float]:
    return ((float(word["x0"]) + float(word["x1"])) / 2, (float(word["top"]) + float(word["bottom"])) / 2)


def point_in_bboxes(point: tuple[float, float], bboxes: list[tuple[float, float, float, float]]) -> bool:
    x, y = point
    return any(x0 <= x <= x1 and top <= y <= bottom for x0, top, x1, bottom in bboxes)


def line_center(line: TextLine) -> tuple[float, float]:
    return ((line.x0 + line.x1) / 2, (line.top + line.bottom) / 2)


def is_citation_fragment(text: str) -> bool:
    stripped = text.strip()
    return bool(
        re.fullmatch(r"\[[\d,\s;:-]+\]\.?", stripped)
        or re.fullmatch(r"[\d,\s;:-]+\]\.?", stripped)
    )


ACADEMIC_HEADINGS = {
    "abstract",
    "introduction",
    "background",
    "related work",
    "literature review",
    "method",
    "methods",
    "methodology",
    "results",
    "discussion",
    "conclusion",
    "references",
    "appendix",
    "ccs concepts",
    "keywords",
    "acm reference format",
}

METADATA_MARKERS = (
    "affiliation",
    "university",
    "department",
    "institute",
    "school of",
    "faculty",
    "laboratory",
    "lab ",
    "germany",
    "usa",
    "united states",
    "kingdom",
    "arxiv",
    "preprint",
    "copyright",
    "lmu",
    "munich",
    "campus",
)

PERIPHERAL_MARKERS = (
    "permission to make",
    "copyright",
    "licensed under",
    "license",
    "doi:",
    "acm isbn",
    "conference",
)
