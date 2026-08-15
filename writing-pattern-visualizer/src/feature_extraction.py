"""Interpretable feature extraction for the Writing Pattern Visualizer."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import re

from .preprocessing import content_paragraphs, count_words, split_sentences
from .section_detection import is_academic_heading


ENGLISH_TRANSITIONS = {
    "Addition": [
        "additionally",
        "furthermore",
        "moreover",
        "in addition",
        "besides",
        "also",
        "as well",
        "similarly",
        "likewise",
    ],
    "Contrast": [
        "however",
        "nevertheless",
        "nonetheless",
        "yet",
        "still",
        "in contrast",
        "by contrast",
        "on the other hand",
        "conversely",
        "whereas",
        "while",
        "although",
        "even though",
        "despite",
        "in spite of",
    ],
    "Cause and result": [
        "therefore",
        "thus",
        "hence",
        "consequently",
        "as a result",
        "for this reason",
        "accordingly",
        "because",
        "since",
        "due to",
        "as a consequence",
    ],
    "Example and specification": [
        "for example",
        "for instance",
        "such as",
        "in particular",
        "particularly",
        "specifically",
        "namely",
        "to illustrate",
    ],
    "Sequence and structure": [
        "first",
        "firstly",
        "second",
        "secondly",
        "third",
        "thirdly",
        "next",
        "then",
        "subsequently",
        "afterwards",
        "finally",
        "at the same time",
        "meanwhile",
    ],
    "Summary and conclusion": [
        "in conclusion",
        "to conclude",
        "in summary",
        "to summarize",
        "overall",
        "taken together",
        "ultimately",
    ],
    "Clarification": [
        "in other words",
        "that is",
        "put differently",
        "more precisely",
        "in this sense",
    ],
}

GERMAN_TRANSITIONS = {
    "Addition": [
        "außerdem",
        "darüber hinaus",
        "zudem",
        "zusätzlich",
        "ferner",
        "weiterhin",
        "ebenso",
        "ebenfalls",
    ],
    "Contrast": [
        "jedoch",
        "allerdings",
        "dennoch",
        "trotzdem",
        "hingegen",
        "dagegen",
        "demgegenüber",
        "im Gegensatz dazu",
        "auf der anderen Seite",
        "einerseits",
        "andererseits",
        "während",
        "obwohl",
        "trotz",
        "nichtsdestotrotz",
    ],
    "Cause and result": [
        "daher",
        "deshalb",
        "deswegen",
        "somit",
        "folglich",
        "infolgedessen",
        "dementsprechend",
        "demnach",
        "aus diesem Grund",
        "aufgrund dessen",
        "daraus ergibt sich",
        "weil",
    ],
    "Example and specification": [
        "zum Beispiel",
        "beispielsweise",
        "etwa",
        "insbesondere",
        "vor allem",
        "konkret",
        "genauer gesagt",
        "nämlich",
    ],
    "Sequence and structure": [
        "zunächst",
        "zuerst",
        "erstens",
        "zweitens",
        "drittens",
        "anschließend",
        "danach",
        "daraufhin",
        "schließlich",
        "zuletzt",
        "währenddessen",
        "im Folgenden",
        "zuvor",
    ],
    "Summary and conclusion": [
        "abschließend",
        "zusammenfassend",
        "zusammengefasst",
        "insgesamt",
        "letztlich",
        "im Ergebnis",
        "daraus folgt",
    ],
    "Clarification": [
        "mit anderen Worten",
        "das heißt",
        "genauer",
        "genauer gesagt",
        "anders formuliert",
    ],
}

TRANSITION_CATEGORIES = {
    "English": ENGLISH_TRANSITIONS,
    "German": GERMAN_TRANSITIONS,
}

# Backwards-compatible flat English list for callers that only need display terms.
TRANSITION_WORDS = tuple(term for terms in ENGLISH_TRANSITIONS.values() for term in terms)


@dataclass(frozen=True)
class TextFeatures:
    word_count: int
    sentence_count: int
    paragraph_count: int
    sentence_lengths: list[int]
    paragraph_lengths: list[int]
    average_sentence_length: float
    average_paragraph_length: float
    transition_frequencies: dict[str, int]
    transition_category_frequencies: dict[str, int]
    sentences: list[str]
    language: str

    @property
    def transition_count(self) -> int:
        return sum(self.transition_frequencies.values())


@dataclass(frozen=True)
class TransitionCandidate:
    term: str
    category: str
    pattern: re.Pattern[str]


def transition_categories_for_language(language: str) -> dict[str, list[str]]:
    """Return the selected language's editable transition categories."""
    return TRANSITION_CATEGORIES.get(language, ENGLISH_TRANSITIONS)


def transition_terms_for_language(language: str) -> tuple[str, ...]:
    """Return unique transition terms in category order."""
    terms: list[str] = []
    seen: set[str] = set()
    for category_terms in transition_categories_for_language(language).values():
        for term in category_terms:
            key = term.casefold()
            if key not in seen:
                seen.add(key)
                terms.append(term)
    return tuple(terms)


def transition_counts(text: str, language: str) -> tuple[dict[str, int], dict[str, int]]:
    """Count transition markers without double-counting overlapping phrase matches."""
    term_counts: Counter[str] = Counter()
    category_counts: Counter[str] = Counter()
    occupied_spans: list[tuple[int, int]] = []

    for candidate in _transition_candidates(language):
        for match in candidate.pattern.finditer(text):
            span = match.span()
            if _overlaps_existing_span(span, occupied_spans):
                continue
            occupied_spans.append(span)
            term_counts[candidate.term] += 1
            category_counts[candidate.category] += 1

    return (
        dict(sorted(term_counts.items(), key=lambda item: (-item[1], item[0]))),
        dict(category_counts),
    )


def extract_features(text: str, language: str = "English") -> TextFeatures:
    """Calculate the complete, rule-based feature set for *text*."""
    paragraphs = content_paragraphs(
        text,
        heading_detector=lambda paragraph: is_academic_heading(paragraph, language),
    )
    sentences = [
        sentence
        for paragraph in paragraphs
        for sentence in split_sentences(paragraph)
    ]
    sentence_lengths = [count_words(sentence) for sentence in sentences]
    paragraph_lengths = [count_words(paragraph) for paragraph in paragraphs]
    term_counts, category_counts = transition_counts(text, language)

    return TextFeatures(
        word_count=count_words(text),
        sentence_count=len(sentences),
        paragraph_count=len(paragraphs),
        sentence_lengths=sentence_lengths,
        paragraph_lengths=paragraph_lengths,
        average_sentence_length=_mean(sentence_lengths),
        average_paragraph_length=_mean(paragraph_lengths),
        transition_frequencies=term_counts,
        transition_category_frequencies=category_counts,
        sentences=sentences,
        language=language,
    )


def _transition_candidates(language: str) -> list[TransitionCandidate]:
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
                    pattern=_transition_pattern(term),
                )
            )

    return sorted(
        candidates,
        key=lambda candidate: (len(candidate.term.split()), len(candidate.term)),
        reverse=True,
    )


def _transition_pattern(term: str) -> re.Pattern[str]:
    phrase_pattern = r"\s+".join(re.escape(part) for part in term.split())
    return re.compile(rf"(?<![\w-]){phrase_pattern}(?![\w-])", flags=re.IGNORECASE)


def _overlaps_existing_span(
    span: tuple[int, int],
    occupied_spans: list[tuple[int, int]],
) -> bool:
    start, end = span
    return any(start < occupied_end and end > occupied_start for occupied_start, occupied_end in occupied_spans)


def _mean(values: list[int]) -> float:
    return sum(values) / len(values) if values else 0.0
