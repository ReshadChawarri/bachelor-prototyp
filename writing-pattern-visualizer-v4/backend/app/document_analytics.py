from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
import re
import sys
from typing import Literal

from pydantic import BaseModel, Field


V3_PROJECT_ROOT = Path(__file__).resolve().parents[3] / "writing-pattern-visualizer"
if str(V3_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(V3_PROJECT_ROOT))

from src.feature_extraction import (  # type: ignore[import-not-found]  # noqa: E402
    transition_categories_for_language,
)
from src.section_detection import is_academic_heading  # type: ignore[import-not-found]  # noqa: E402


Language = Literal["English", "German"]

LANGUAGE_ALIASES = {
    "english": "English",
    "en": "English",
    "german": "German",
    "de": "German",
    "deutsch": "German",
}

PROSE_BLOCK_TYPES = {"paragraph"}
HEADING_BLOCK_TYPES = {"heading"}
NON_PROSE_BLOCK_TYPES = {
    "metadata",
    "caption",
    "table",
    "figure",
    "image",
    "list",
    "footnote",
    "references",
    "header",
    "footer",
}

# Repetition is intentionally simple and deterministic: no stemming, no NLP model.
REPETITION_MIN_WORD_LENGTH = 4
REPETITION_MIN_COUNT = 2
REPETITION_MAX_TERMS = 8

WORD_PATTERN = re.compile(r"[\w]+(?:[-'][\w]+)*", flags=re.UNICODE)
NUMBERED_HEADING_PATTERN = re.compile(r"^\s*(?P<number>\d+(?:\.\d+)*)\.?\s+")

ENGLISH_STOPWORDS = {
    "about",
    "above",
    "after",
    "again",
    "against",
    "also",
    "although",
    "among",
    "because",
    "been",
    "before",
    "being",
    "below",
    "between",
    "both",
    "could",
    "does",
    "doing",
    "down",
    "during",
    "each",
    "from",
    "further",
    "have",
    "having",
    "here",
    "into",
    "itself",
    "more",
    "most",
    "only",
    "other",
    "over",
    "same",
    "should",
    "such",
    "than",
    "that",
    "their",
    "them",
    "then",
    "there",
    "these",
    "they",
    "this",
    "those",
    "through",
    "under",
    "until",
    "very",
    "were",
    "what",
    "when",
    "where",
    "which",
    "while",
    "with",
    "within",
    "would",
    "your",
}

GERMAN_STOPWORDS = {
    "aber",
    "alle",
    "allem",
    "allen",
    "aller",
    "alles",
    "auch",
    "auf",
    "aus",
    "bei",
    "bin",
    "bis",
    "das",
    "dass",
    "dem",
    "den",
    "der",
    "des",
    "die",
    "dies",
    "diese",
    "diesem",
    "diesen",
    "dieser",
    "dieses",
    "doch",
    "durch",
    "eine",
    "einem",
    "einen",
    "einer",
    "eines",
    "für",
    "hat",
    "hatte",
    "hier",
    "ihre",
    "ihrem",
    "ihren",
    "ihrer",
    "ist",
    "mit",
    "nach",
    "nicht",
    "noch",
    "oder",
    "sich",
    "sind",
    "über",
    "und",
    "vom",
    "von",
    "vor",
    "war",
    "wenn",
    "werden",
    "wie",
    "wir",
    "wird",
    "zur",
    "zum",
}


class AnalyticsBlock(BaseModel):
    id: str
    type: str = "paragraph"
    blockType: str = "paragraph"
    order: int = 0
    text: str = ""
    headingLevel: int | None = None
    listType: str | None = None


@dataclass(frozen=True)
class TransitionCandidate:
    term: str
    category: str
    pattern: re.Pattern[str]


class DocumentAnalyticsRequest(BaseModel):
    documentId: str
    revision: int
    requestId: str
    language: str = "English"
    blocks: list[AnalyticsBlock] = Field(default_factory=list)


class TransitionOccurrence(BaseModel):
    paragraphId: str
    startOffset: int
    endOffset: int
    text: str
    term: str
    category: str


class TransitionCategoryCount(BaseModel):
    name: str
    count: int
    occurrences: list[TransitionOccurrence] = Field(default_factory=list)


class TransitionTermCount(BaseModel):
    term: str
    category: str
    count: int
    occurrences: list[TransitionOccurrence] = Field(default_factory=list)


class TransitionAnalytics(BaseModel):
    total: int
    categories: list[TransitionCategoryCount]
    terms: list[TransitionTermCount]


class RepetitionOccurrence(BaseModel):
    paragraphId: str
    startOffset: int
    endOffset: int
    text: str
    normalizedTerm: str


class RepetitionTerm(BaseModel):
    term: str
    count: int
    occurrences: list[RepetitionOccurrence] = Field(default_factory=list)


class RepetitionAnalytics(BaseModel):
    terms: list[RepetitionTerm]
    minCount: int


class StructureHeading(BaseModel):
    text: str
    level: int
    nodeId: str | None = None
    paragraphId: str | None = None


class DocumentStructureAnalytics(BaseModel):
    source: Literal["explicit", "heuristic", "none"]
    headings: list[StructureHeading]


class DocumentAnalyticsResponse(BaseModel):
    documentId: str
    revision: int
    requestId: str
    language: Language
    transitions: TransitionAnalytics
    repetition: RepetitionAnalytics
    structure: DocumentStructureAnalytics


def analyze_document(request: DocumentAnalyticsRequest) -> DocumentAnalyticsResponse:
    language = normalize_language(request.language)
    blocks = sorted(request.blocks, key=lambda block: block.order)
    prose_blocks = [block for block in blocks if is_prose_block(block)]

    return DocumentAnalyticsResponse(
        documentId=request.documentId,
        revision=request.revision,
        requestId=request.requestId,
        language=language,
        transitions=analyze_transitions(prose_blocks, language),
        repetition=analyze_repetition(prose_blocks, language),
        structure=analyze_structure(blocks, language),
    )


def normalize_language(language: str) -> Language:
    return LANGUAGE_ALIASES.get(language.strip().casefold(), "English")  # type: ignore[return-value]


def analyze_transitions(blocks: list[AnalyticsBlock], language: Language) -> TransitionAnalytics:
    category_definitions = transition_categories_for_language(language)
    occurrences: list[TransitionOccurrence] = []

    for block in blocks:
        occupied_spans: list[tuple[int, int]] = []
        for candidate in transition_candidates(language):
            for match in candidate.pattern.finditer(block.text):
                span = match.span()
                if overlaps_existing_span(span, occupied_spans):
                    continue
                occupied_spans.append(span)
                occurrences.append(
                    TransitionOccurrence(
                        paragraphId=block.id,
                        startOffset=span[0],
                        endOffset=span[1],
                        text=match.group(0),
                        term=candidate.term,
                        category=candidate.category,
                    )
                )

    occurrences_by_category: dict[str, list[TransitionOccurrence]] = defaultdict(list)
    occurrences_by_term: dict[str, list[TransitionOccurrence]] = defaultdict(list)
    for occurrence in occurrences:
        occurrences_by_category[occurrence.category].append(occurrence)
        occurrences_by_term[occurrence.term].append(occurrence)

    categories = [
        TransitionCategoryCount(
            name=category,
            count=len(occurrences_by_category[category]),
            occurrences=occurrences_by_category[category],
        )
        for category in category_definitions
        if occurrences_by_category[category]
    ]
    terms = [
        TransitionTermCount(
            term=term,
            category=occurrences_by_term[term][0].category,
            count=len(occurrences_by_term[term]),
            occurrences=occurrences_by_term[term],
        )
        for term in sorted(occurrences_by_term, key=lambda item: (-len(occurrences_by_term[item]), item))
    ]

    return TransitionAnalytics(
        total=len(occurrences),
        categories=categories,
        terms=terms,
    )


def analyze_repetition(blocks: list[AnalyticsBlock], language: Language) -> RepetitionAnalytics:
    stopwords = stopwords_for_language(language)
    occurrences_by_term: dict[str, list[RepetitionOccurrence]] = defaultdict(list)

    for block in blocks:
        for match in WORD_PATTERN.finditer(block.text):
            raw_word = match.group(0)
            word = raw_word.strip("_").casefold()
            if not word or word.isnumeric():
                continue
            if len(word) < REPETITION_MIN_WORD_LENGTH:
                continue
            if word in stopwords:
                continue
            occurrences_by_term[word].append(
                RepetitionOccurrence(
                    paragraphId=block.id,
                    startOffset=match.start(),
                    endOffset=match.end(),
                    text=raw_word,
                    normalizedTerm=word,
                )
            )

    terms = [
        RepetitionTerm(term=term, count=len(occurrences_by_term[term]), occurrences=occurrences_by_term[term])
        for term in sorted(occurrences_by_term, key=lambda item: (-len(occurrences_by_term[item]), item))
        if len(occurrences_by_term[term]) >= REPETITION_MIN_COUNT
    ][:REPETITION_MAX_TERMS]

    return RepetitionAnalytics(terms=terms, minCount=REPETITION_MIN_COUNT)


def analyze_structure(blocks: list[AnalyticsBlock], language: Language) -> DocumentStructureAnalytics:
    explicit_headings = [
        StructureHeading(
            text=normalized_text(block.text),
            level=normalize_heading_level(block.headingLevel),
            nodeId=block.id,
            paragraphId=block.id,
        )
        for block in blocks
        if is_explicit_heading_block(block) and normalized_text(block.text)
    ]
    if explicit_headings:
        return DocumentStructureAnalytics(source="explicit", headings=explicit_headings)

    heuristic_headings = [
        StructureHeading(
            text=normalized_text(block.text),
            level=infer_heading_level(block.text),
            nodeId=None,
            paragraphId=block.id,
        )
        for block in blocks
        if is_heuristic_candidate_block(block)
        and normalized_text(block.text)
        and is_academic_heading(block.text, language)
    ]
    if heuristic_headings:
        return DocumentStructureAnalytics(source="heuristic", headings=heuristic_headings)

    return DocumentStructureAnalytics(source="none", headings=[])


def is_prose_block(block: AnalyticsBlock) -> bool:
    return block.type == "paragraph" and block.blockType in PROSE_BLOCK_TYPES


def is_explicit_heading_block(block: AnalyticsBlock) -> bool:
    return block.type == "heading" or block.blockType in HEADING_BLOCK_TYPES


def is_heuristic_candidate_block(block: AnalyticsBlock) -> bool:
    return block.blockType not in NON_PROSE_BLOCK_TYPES and not is_explicit_heading_block(block)


def normalize_heading_level(level: int | None) -> int:
    if level is None:
        return 1
    return min(max(level, 1), 3)


def infer_heading_level(text: str) -> int:
    match = NUMBERED_HEADING_PATTERN.match(text)
    if not match:
        return 1
    return min(match.group("number").count(".") + 1, 3)


def stopwords_for_language(language: Language) -> set[str]:
    if language == "German":
        return GERMAN_STOPWORDS
    return ENGLISH_STOPWORDS


def transition_candidates(language: Language) -> list[TransitionCandidate]:
    candidates: list[TransitionCandidate] = []
    seen_terms: set[str] = set()

    for category, terms in transition_categories_for_language(language).items():
        for term in terms:
            key = term.casefold()
            if key in seen_terms:
                continue
            seen_terms.add(key)
            candidates.append(
                TransitionCandidate(
                    term=term,
                    category=category,
                    pattern=transition_pattern(term),
                )
            )

    return sorted(
        candidates,
        key=lambda candidate: (len(candidate.term.split()), len(candidate.term)),
        reverse=True,
    )


def transition_pattern(term: str) -> re.Pattern[str]:
    phrase_pattern = r"\s+".join(re.escape(part) for part in term.split())
    return re.compile(rf"(?<![\w-]){phrase_pattern}(?![\w-])", flags=re.IGNORECASE)


def overlaps_existing_span(span: tuple[int, int], occupied_spans: list[tuple[int, int]]) -> bool:
    start, end = span
    return any(start < occupied_end and end > occupied_start for occupied_start, occupied_end in occupied_spans)


def normalized_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()
