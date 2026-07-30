"""Plotly visualizations and Streamlit metric cards for the MVP."""

from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st

from .feature_extraction import TextFeatures

BLUE = "#5367E8"
TEAL = "#168C80"


def show_overview(features: TextFeatures) -> None:
    """Render the five overview values as Streamlit metric cards."""
    values = (
        ("Words", features.word_count),
        ("Sentences", features.sentence_count),
        ("Paragraphs", features.paragraph_count),
        ("Avg. sentence length", f"{features.average_sentence_length:.1f}"),
        ("Avg. paragraph length", f"{features.average_paragraph_length:.1f}"),
    )
    for column, (label, value) in zip(st.columns(5), values):
        column.metric(label, value, help="Length values are measured in words.")


def sentence_length_figure(features: TextFeatures):
    """Create a histogram representing the sentence length distribution."""
    frame = pd.DataFrame({"Length in words": features.sentence_lengths})
    figure = px.histogram(
        frame,
        x="Length in words",
        nbins=min(12, max(4, len(features.sentence_lengths))),
        labels={"count": "Number of sentences"},
        color_discrete_sequence=[BLUE],
    )
    figure.update_layout(bargap=0.08, yaxis_title="Number of sentences")
    return figure


def paragraph_length_figure(features: TextFeatures):
    """Create an ordered bar chart of paragraph lengths."""
    frame = pd.DataFrame(
        {
            "Paragraph": [f"Paragraph {number}" for number in range(1, features.paragraph_count + 1)],
            "Length in words": features.paragraph_lengths,
        }
    )
    figure = px.bar(
        frame,
        x="Paragraph",
        y="Length in words",
        color_discrete_sequence=[BLUE],
    )
    figure.update_layout(xaxis_title=None)
    return figure


def transition_figure(features: TextFeatures):
    """Create a frequency chart, returning ``None`` for an empty result."""
    if not features.transition_frequencies:
        return None
    frame = pd.DataFrame(
        sorted(features.transition_frequencies.items(), key=lambda item: (-item[1], item[0])),
        columns=["Transition word", "Occurrences"],
    )
    return px.bar(
        frame,
        x="Occurrences",
        y="Transition word",
        orientation="h",
        color_discrete_sequence=[TEAL],
    ).update_layout(yaxis={"categoryorder": "total ascending"})


def longest_sentences_table(features: TextFeatures, limit: int = 5) -> pd.DataFrame:
    """Return the longest sentences with stable, human-readable numbering."""
    frame = pd.DataFrame(
        {
            "Sentence": range(1, features.sentence_count + 1),
            "Words": features.sentence_lengths,
            "Text": features.sentences,
        }
    )
    return frame.sort_values(["Words", "Sentence"], ascending=[False, True]).head(limit)
