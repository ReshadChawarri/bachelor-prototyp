"""Non-evaluative, rule-based writing profile descriptions."""

from __future__ import annotations

from .feature_extraction import TextFeatures


def generate_profile(features: TextFeatures) -> list[str]:
    """Describe observable patterns without grading or correcting the writing."""
    observations: list[str] = []

    if features.average_sentence_length < 12:
        observations.append("The text tends to use short sentences.")
    elif features.average_sentence_length > 24:
        observations.append("The text tends to use long sentences.")
    else:
        observations.append("The text tends to use medium-length sentences.")

    if features.average_paragraph_length < 60:
        observations.append("The paragraph structure appears compact.")
    elif features.average_paragraph_length > 140:
        observations.append("The text tends to use extended paragraphs.")
    else:
        observations.append("The paragraphs are moderate in length overall.")

    if features.sentence_lengths:
        spread = max(features.sentence_lengths) - min(features.sentence_lengths)
        if spread >= 20:
            observations.append("Sentence length varies noticeably across the text.")
        else:
            observations.append("Sentence lengths remain relatively consistent.")

    if features.transition_frequencies:
        ranked = sorted(features.transition_frequencies, key=features.transition_frequencies.get, reverse=True)
        examples = ", ".join(ranked[:3])
        observations.append(f"The text uses listed transitions such as {examples}.")
    else:
        observations.append("The predefined transition terms do not appear in this text.")

    observations.append(
        "These observations describe patterns only; they are not a grade or quality score."
    )
    return observations
