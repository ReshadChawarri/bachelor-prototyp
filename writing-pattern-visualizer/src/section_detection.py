"""Simple local detection of common academic section headings."""

from __future__ import annotations

from dataclasses import dataclass
import re

from .preprocessing import count_words, split_paragraphs


SECTION_HEADINGS = (
    "Abstract",
    "Introduction",
    "Background",
    "Related Work",
    "Theory",
    "Method",
    "Methodology",
    "Analysis",
    "Results",
    "Discussion",
    "Conclusion",
    "References",
)

_HEADING_LOOKUP = {heading.casefold(): heading for heading in SECTION_HEADINGS}
_HEADING_PATTERN = re.compile(
    r"^\s*(?:\d+(?:\.\d+)*\.?\s*)?(?P<title>"
    + "|".join(re.escape(heading) for heading in sorted(SECTION_HEADINGS, key=len, reverse=True))
    + r")\s*:?\s*$",
    flags=re.IGNORECASE,
)


@dataclass(frozen=True)
class SectionInfo:
    title: str
    word_count: int
    paragraph_count: int
    relative_length: float


def is_academic_heading(text: str) -> bool:
    """Return whether a text block matches one of the tracked heading names."""
    return bool(_HEADING_PATTERN.match(text.strip()))


def detect_sections(text: str) -> list[SectionInfo]:
    """Detect academic sections and summarize their relative size."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    headings = [
        (line_number, _canonical_heading(match.group("title")))
        for line_number, line in enumerate(lines)
        if (match := _HEADING_PATTERN.match(line.strip()))
    ]

    if not headings:
        return []

    drafts: list[tuple[str, int, int]] = []
    for index, (line_number, title) in enumerate(headings):
        next_line = headings[index + 1][0] if index + 1 < len(headings) else len(lines)
        section_text = "\n".join(lines[line_number + 1 : next_line]).strip()
        drafts.append(
            (
                title,
                count_words(section_text),
                len(split_paragraphs(section_text)) if section_text else 0,
            )
        )

    total_words = sum(word_count for _, word_count, _ in drafts)
    return [
        SectionInfo(
            title=title,
            word_count=word_count,
            paragraph_count=paragraph_count,
            relative_length=(word_count / total_words * 100 if total_words else 0.0),
        )
        for title, word_count, paragraph_count in drafts
    ]


def _canonical_heading(heading: str) -> str:
    return _HEADING_LOOKUP.get(heading.casefold(), heading.title())
