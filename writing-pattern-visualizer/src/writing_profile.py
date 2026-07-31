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
        return "The text contains no detected transition words from the predefined academic list."

    ranked = sorted(features.transition_frequencies.items(), key=lambda item: (-item[1], item[0]))
    examples = ", ".join(term for term, _ in ranked[:3])
    if features.transition_count >= max(6, features.paragraph_count * 2):
        return f"The text uses several explicit transition words from the predefined academic list, including {examples}."
    return f"The text uses a smaller set of explicit transition words from the predefined academic list, including {examples}."


def describe_section_structure(sections: list[SectionInfo]) -> str:
    if not sections:
        return "No clear academic section headings were detected in the text."

    largest_section = max(sections, key=lambda section: section.word_count)
    return (
        "The detected section structure suggests that the text follows a recognizable "
        f"academic organization; the largest detected section is {largest_section.title}."
    )


def coefficient_of_variation(values: list[int]) -> float | None:
    """Return population-standard-deviation divided by mean for comparable spread."""
    if len(values) < 2:
        return None
    average = sum(values) / len(values)
    if average == 0:
        return None
    return pstdev(values) / average
