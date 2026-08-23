from __future__ import annotations

from io import BytesIO
import re
from statistics import median
from typing import Literal

import pdfplumber
from pdfplumber.page import Page
from pydantic import BaseModel, Field


class ImportedBlock(BaseModel):
    kind: Literal["paragraph", "heading"]
    text: str = Field(min_length=1)
    heading_level: int | None = None


class PdfImportResponse(BaseModel):
    filename: str
    page_count: int
    character_count: int
    blocks: list[ImportedBlock]


class PdfImportError(ValueError):
    pass


def extract_pdf_content(raw_pdf: bytes, filename: str) -> PdfImportResponse:
    """Extract editable text blocks from a text-based PDF."""
    if not raw_pdf or not raw_pdf.lstrip().startswith(b"%PDF"):
        raise PdfImportError("The uploaded file is not a valid PDF.")

    try:
        with pdfplumber.open(BytesIO(raw_pdf)) as pdf:
            page_texts = [extract_page_text(page) for page in pdf.pages]
            page_count = len(pdf.pages)
    except Exception as exc:
        raise PdfImportError("PDF text extraction failed. The file may be encrypted, invalid, or unsupported.") from exc

    blocks = reconstruct_blocks("\n\n".join(page_texts))
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


def extract_page_text(page: Page) -> str:
    """Extract page text while preserving likely paragraph gaps from line positions."""
    try:
        lines = page.extract_text_lines(strip=True, return_chars=False)
    except Exception:
        lines = []

    if not lines:
        return page.extract_text(x_tolerance=1, y_tolerance=3) or ""

    sorted_lines = sorted(lines, key=lambda line: (line.get("top", 0), line.get("x0", 0)))
    line_heights = [
        line["bottom"] - line["top"]
        for line in sorted_lines
        if isinstance(line.get("top"), (int, float)) and isinstance(line.get("bottom"), (int, float))
    ]
    paragraph_gap = max((median(line_heights) * 0.8 if line_heights else 8), 6)

    text_lines: list[str] = []
    previous_bottom: float | None = None
    for line in sorted_lines:
        text = normalize_line(line.get("text", ""))
        if not text:
            continue

        top = line.get("top")
        if (
            previous_bottom is not None
            and isinstance(top, (int, float))
            and top - previous_bottom > paragraph_gap
        ):
            text_lines.append("")

        text_lines.append(text)
        bottom = line.get("bottom")
        if isinstance(bottom, (int, float)):
            previous_bottom = bottom

    return "\n".join(text_lines)


def reconstruct_blocks(extracted_text: str) -> list[ImportedBlock]:
    """Normalize PDF line wrapping into conservative editable paragraphs."""
    text = extracted_text.replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    blocks: list[ImportedBlock] = []
    current_lines: list[str] = []

    def flush_paragraph() -> None:
        nonlocal current_lines
        paragraph = normalize_wrapped_lines(current_lines)
        if paragraph:
            blocks.append(ImportedBlock(kind="paragraph", text=paragraph))
        current_lines = []

    for raw_line in lines:
        line = normalize_line(raw_line)
        if not line:
            flush_paragraph()
            continue

        if is_obvious_heading(line):
            flush_paragraph()
            blocks.append(
                ImportedBlock(
                    kind="heading",
                    text=strip_heading_number(line),
                    heading_level=heading_level(line),
                )
            )
            continue

        current_lines.append(line)

    flush_paragraph()
    return blocks


def normalize_line(line: str) -> str:
    return re.sub(r"\s+", " ", line).strip()


def normalize_wrapped_lines(lines: list[str]) -> str:
    if not lines:
        return ""

    text = lines[0]
    for line in lines[1:]:
        if text.endswith("-") and line[:1].islower():
            text = text[:-1] + line
        else:
            text += " " + line

    return re.sub(r"\s+", " ", text).strip()


def is_obvious_heading(line: str) -> bool:
    cleaned = strip_heading_number(line).strip(":")
    words = cleaned.split()

    if not cleaned or len(words) > 10:
        return False
    if re.search(r"[.!?]$", cleaned):
        return False
    if re.match(r"^\d+(?:\.\d+)*\.?\s+\S+", line):
        return True
    if cleaned.isupper() and len(words) <= 8:
        return True
    if len(words) <= 7 and sum(word[:1].isupper() for word in words) >= max(1, len(words) - 1):
        return True

    return False


def strip_heading_number(line: str) -> str:
    return re.sub(r"^\d+(?:\.\d+)*\.?\s+", "", line).strip()


def heading_level(line: str) -> int:
    match = re.match(r"^(\d+(?:\.\d+)*)\.?\s+", line)
    if not match:
        return 1
    return min(3, match.group(1).count(".") + 1)
