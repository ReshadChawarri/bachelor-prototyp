from __future__ import annotations

from dataclasses import dataclass, field
from io import BytesIO
import re
from statistics import median
from typing import Any, Literal

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


def extract_pdf_content(raw_pdf: bytes, filename: str) -> PdfImportResponse:
    """Extract editable text blocks from a text-based PDF."""
    if not raw_pdf or not raw_pdf.lstrip().startswith(b"%PDF"):
        raise PdfImportError("The uploaded file is not a valid PDF.")

    try:
        with pdfplumber.open(BytesIO(raw_pdf)) as pdf:
            page_blocks = [extract_page_blocks(page, page_number=index + 1) for index, page in enumerate(pdf.pages)]
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


def extract_page_blocks(page: Page, page_number: int) -> list[ImportedBlock]:
    table_blocks, table_bboxes = extract_tables(page, page_number)
    figure_blocks = extract_figures(page, page_number)
    lines = extract_text_lines_from_words(page, page_number, excluded_bboxes=table_bboxes)

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

    text_blocks = reconstruct_text_blocks(lines, body_size=body_font_size(lines))
    layout_items = merge_layout_blocks(text_blocks, table_drafts + figure_drafts)
    return [to_imported_block(block) for block in layout_items]


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

    return merge_adjacent_headings(blocks, body_size)


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
    if not text or len(words) > 12 or re.search(r"[.!?]$", text):
        return False
    if is_caption(text):
        return False
    known_heading = text.casefold() in ACADEMIC_HEADINGS
    size_signal = body_size > 0 and line.size >= body_size * 1.22
    weight_signal = line.bold_ratio >= 0.55
    short_signal = len(words) <= 8 and len(text) <= 90
    title_signal = line.page_number == 1 and line.top < 170 and line.size >= body_size * 1.35 and len(words) <= 14
    if is_metadata_line(text) and not known_heading and not title_signal:
        return False
    if re.match(r"^\d+(?:\.\d+)*\.?\s+\S+", line.text):
        return len(words) <= 10
    return known_heading or title_signal or (size_signal and weight_signal and short_signal)


def should_merge_with_current(current: DraftBlock, line: TextLine, normal_gap: float) -> bool:
    previous = current.lines[-1]
    gap = line.top - previous.bottom
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
    if previous_text.endswith("-") and next_text[:1].islower() and should_remove_line_end_hyphen(previous_text):
        existing[-1].text = previous_text[:-1]
        incoming[0].text = next_text
    elif previous_text.endswith("-") and next_text[:1].islower():
        incoming[0].text = next_text
    else:
        incoming[0].text = " " + next_text


def should_remove_line_end_hyphen(previous_text: str) -> bool:
    match = re.search(r"([A-Za-z]{5,})-$", previous_text)
    return bool(match and "-" not in match.group(1))


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
    if any(marker in lowered for marker in METADATA_MARKERS):
        return True
    if looks_like_person_or_affiliation(text):
        return True
    return False


def looks_like_person_or_affiliation(text: str) -> bool:
    stripped = text.strip()
    words = stripped.split()
    if not stripped or len(words) > 18:
        return False
    if re.search(r"[.!?]$", stripped):
        return False
    if any(marker in stripped.casefold() for marker in METADATA_MARKERS):
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
}

METADATA_MARKERS = (
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
    "journal",
    "conference",
    "proceedings",
    "arxiv",
    "preprint",
    "copyright",
)
