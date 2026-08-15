"""Non-evaluative, rule-based writing profile descriptions."""

from __future__ import annotations

from statistics import pstdev

from .feature_extraction import TextFeatures
from .section_detection import SectionInfo


def generate_profile(features: TextFeatures, sections: list[SectionInfo]) -> list[str]:
    """Describe observable patterns without grading or correcting the writing."""
    return [
        describe_sentence_tendency(features),
        describe_sentence_variation(features),
        describe_paragraph_compactness(features),
        describe_paragraph_variation(features),
        describe_transition_usage(features),
        describe_section_structure(sections),
    ]


def describe_sentence_tendency(features: TextFeatures) -> str:
    if features.sentence_count == 0:
        return "No sentence-level pattern could be detected yet."
    long_sentences = sum(1 for length in features.sentence_lengths if length > 30)
    short_sentences = sum(1 for length in features.sentence_lengths if length < 8)

    if long_sentences >= max(2, features.sentence_count * 0.25):
        return "The text contains a relatively high number of longer sentences."
    if short_sentences >= max(2, features.sentence_count * 0.25):
        return "The text contains a relatively high number of shorter sentences."
    if features.average_sentence_length < 14:
        return "The text tends to use relatively short sentences."
    if features.average_sentence_length > 25:
        return "The text tends to use relatively long sentences."
    return "The text tends to use medium-length sentences."


def describe_sentence_variation(features: TextFeatures) -> str:
    variation = coefficient_of_variation(features.sentence_lengths)
    if variation is None:
        return "Sentence length variation cannot be estimated from the current sentence set."
    if variation >= 0.55:
        return "Sentence lengths vary noticeably across the text."
    if variation >= 0.30:
        return "Sentence lengths show some variation across the text."
    return "Sentence lengths appear relatively consistent across the text."


def describe_paragraph_compactness(features: TextFeatures) -> str:
    if features.paragraph_count == 0:
        return "No paragraph-level pattern could be detected yet."
    if features.average_paragraph_length < 80:
        return "The paragraph structure appears compact."
    if features.average_paragraph_length > 170:
        return "The paragraph structure appears extended, with longer blocks of text."
    return "The paragraph structure appears moderately developed."


def describe_paragraph_variation(features: TextFeatures) -> str:
    variation = coefficient_of_variation(features.paragraph_lengths)
    if variation is None:
        return "Paragraph length variation cannot be estimated from the current paragraph set."
    if variation >= 0.60:
        return "Paragraph lengths vary noticeably across the text."
    if variation >= 0.35:
        return "Paragraph lengths show some variation across the text."
    return "Paragraph lengths appear relatively balanced across the text."


def describe_transition_usage(features: TextFeatures) -> str:
    if not features.transition_frequencies:
        return "No transition markers from the predefined list were detected."

    category_count = len(features.transition_category_frequencies)
    if category_count >= 3:
        return "Transition markers are distributed across several categories."
    if category_count == 2:
        categories = ", ".join(features.transition_category_frequencies)
        return f"Transition markers appear across two categories: {categories}."

    category = next(iter(features.transition_category_frequencies))
    return f"The detected transition markers appear mainly in the category {category}."


def describe_section_structure(sections: list[SectionInfo]) -> str:
    if not sections:
        return "No explicit academic section headings were detected."

    largest_section = max(sections, key=lambda section: section.word_count)
    return (
        "Explicit academic section headings were detected; the longest detected section "
        f"by word count is {largest_section.title}."
    )


def coefficient_of_variation(values: list[int]) -> float | None:
    """Return population-standard-deviation divided by mean for comparable spread."""
    if len(values) < 2:
        return None
    average = sum(values) / len(values)
    if average == 0:
        return None
    return pstdev(values) / average
