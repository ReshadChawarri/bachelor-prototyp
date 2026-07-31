"""Interpretable feature extraction for the Writing Pattern Visualizer."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import re

from .preprocessing import content_paragraphs, count_words, split_sentences


TRANSITION_WORDS = (
    "additionally",
    "although",
    "as a result",
    "because",
    "consequently",
    "finally",
    "first",
    "for example",
    "for instance",
    "furthermore",
    "hence",
    "however",
    "in addition",
    "in conclusion",
    "in contrast",
    "in summary",
    "moreover",
    "nevertheless",
    "on the other hand",
    "second",
    "similarly",
    "therefore",
    "thus",
    "whereas",
)


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
    sentences: list[str]

    @property
    def transition_count(self) -> int:
        return sum(self.transition_frequencies.values())


def _transition_counts(text: str) -> dict[str, int]:
    lowered = text.casefold()
    counts = Counter()
    for transition in TRANSITION_WORDS:
        # Boundaries prevent, for example, "thus" from matching "enthusiasm".
        counts[transition] = len(
            re.findall(rf"(?<!\w){re.escape(transition)}(?!\w)", lowered)
        )
    return {word: count for word, count in counts.items() if count > 0}


def extract_features(text: str) -> TextFeatures:
    """Calculate the complete, rule-based feature set for *text*."""
    paragraphs = content_paragraphs(text)
    sentences = [
        sentence
        for paragraph in paragraphs
        for sentence in split_sentences(paragraph)
    ]
    sentence_lengths = [count_words(sentence) for sentence in sentences]
    paragraph_lengths = [count_words(paragraph) for paragraph in paragraphs]
    word_count = count_words(text)

    return TextFeatures(
        word_count=word_count,
        sentence_count=len(sentences),
        paragraph_count=len(paragraphs),
        sentence_lengths=sentence_lengths,
        paragraph_lengths=paragraph_lengths,
        average_sentence_length=(
            sum(sentence_lengths) / len(sentence_lengths) if sentence_lengths else 0.0
        ),
        average_paragraph_length=(
            sum(paragraph_lengths) / len(paragraph_lengths) if paragraph_lengths else 0.0
        ),
        transition_frequencies=_transition_counts(text),
        sentences=sentences,
    )
