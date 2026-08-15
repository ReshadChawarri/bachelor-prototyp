"""Simple local detection of common academic section headings."""

from __future__ import annotations

from dataclasses import dataclass
import re

from .preprocessing import count_words, split_paragraphs


ENGLISH_SECTION_HEADINGS = (
    "Abstract",
    "Introduction",
    "Background",
    "Related Work",
    "Literature Review",
    "Theory",
    "Method",
    "Methods",
    "Methodology",
    "Concept",
    "Design",
    "Implementation",
    "Evaluation",
    "Results",
    "Discussion",
    "Conclusion",
    "References",
    "Bibliography",
    "Appendix",
)

GERMAN_SECTION_HEADINGS = (
    "Kurzfassung",
    "Abstract",
    "Einleitung",
    "Hintergrund",
    "Verwandte Arbeiten",
    "Stand der Forschung",
    "Literaturübersicht",
    "Theorie",
    "Methode",
    "Methoden",
    "Methodik",
    "Konzept",
    "Design",
    "Implementierung",
    "Evaluation",
    "Auswertung",
    "Ergebnisse",
    "Diskussion",
    "Fazit",
    "Schlussfolgerung",
    "Zusammenfassung",
    "Literatur",
    "Quellen",
    "Anhang",
)

SECTION_HEADINGS_BY_LANGUAGE = {
    "English": ENGLISH_SECTION_HEADINGS,
    "German": GERMAN_SECTION_HEADINGS,
}


@dataclass(frozen=True)
class SectionInfo:
    title: str
    word_count: int
    paragraph_count: int
    relative_length: float


def section_headings_for_language(language: str) -> tuple[str, ...]:
    """Return the selected language's editable academic heading list."""
    return SECTION_HEADINGS_BY_LANGUAGE.get(language, ENGLISH_SECTION_HEADINGS)


def is_academic_heading(text: str, language: str = "English") -> bool:
    """Return whether a text block matches one of the tracked heading names."""
    return bool(_heading_pattern(language).match(text.strip()))


def detect_sections(text: str, language: str = "English") -> list[SectionInfo]:
    """Detect academic sections and summarize their approximate size."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    pattern = _heading_pattern(language)
    headings = [
        (line_number, _canonical_heading(match.group("title"), language))
        for line_number, line in enumerate(lines)
        if (match := pattern.match(line.strip()))
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


def _heading_pattern(language: str) -> re.Pattern[str]:
    alternatives = "|".join(
        re.escape(heading)
        for heading in sorted(section_headings_for_language(language), key=len, reverse=True)
    )
    return re.compile(
        rf"^\s*(?:\d+(?:\.\d+)*\.?\s*)?(?P<title>{alternatives})\s*:?\s*$",
        flags=re.IGNORECASE,
    )


def _canonical_heading(heading: str, language: str) -> str:
    lookup = {
        known_heading.casefold(): known_heading
        for known_heading in section_headings_for_language(language)
    }
    return lookup.get(heading.casefold(), heading.title())
