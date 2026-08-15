"""Plotly visualizations and Streamlit metric cards for the prototype."""

from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st

from .feature_extraction import TextFeatures
from .section_detection import SectionInfo


BLUE = "#4F7CAC"
GREEN = "#59A14F"
MAGENTA = "#B07AA1"
ORANGE = "#F28E2B"
TEMPLATE = "plotly_white"


def show_overview(features: TextFeatures, section_count: int) -> None:
    """Render overview values as Streamlit metric cards."""
    top_values = (
        ("Words", features.word_count),
        ("Sentences", features.sentence_count),
        ("Paragraphs", features.paragraph_count),
        ("Transitions", features.transition_count),
    )
    for column, (label, value) in zip(st.columns(4), top_values):
        column.metric(label, value)

    bottom_values = (
        ("Avg. sentence length", f"{features.average_sentence_length:.1f} words"),
        ("Avg. paragraph length", f"{features.average_paragraph_length:.1f} words"),
        ("Detected sections", section_count),
    )
    for column, (label, value) in zip(st.columns(3), bottom_values):
        column.metric(label, value)


def sentence_length_figure(features: TextFeatures):
    """Create a histogram representing the sentence length distribution."""
    frame = pd.DataFrame({"Sentence length in words": features.sentence_lengths})
    figure = px.histogram(
        frame,
        x="Sentence length in words",
        nbins=min(20, max(5, len(set(features.sentence_lengths)))),
        labels={"count": "Number of sentences"},
        color_discrete_sequence=[BLUE],
        template=TEMPLATE,
    )
    figure.add_vline(x=8, line_dash="dot", line_color="#5D8FD6")
    figure.add_vline(x=30, line_dash="dot", line_color="#C98922")
    figure.update_layout(
        bargap=0.08,
        height=360,
        margin=dict(l=10, r=10, t=20, b=10),
        yaxis_title="Number of sentences",
    )
    return figure


def paragraph_length_figure(features: TextFeatures):
    """Create an ordered bar chart of paragraph lengths."""
    frame = pd.DataFrame(
        {
            "Paragraph": [f"P{number}" for number in range(1, features.paragraph_count + 1)],
            "Words": features.paragraph_lengths,
        }
    )
    figure = px.bar(
        frame,
        x="Paragraph",
        y="Words",
        text="Words",
        color_discrete_sequence=[GREEN],
        template=TEMPLATE,
    )
    figure.update_traces(textposition="outside")
    figure.update_layout(height=360, margin=dict(l=10, r=10, t=20, b=10), xaxis_title=None)
    return figure


def transition_figure(features: TextFeatures):
    """Create a transition frequency chart, returning ``None`` for an empty result."""
    if not features.transition_frequencies:
        return None
    frame = transition_table(features)
    figure = px.bar(
        frame.sort_values("Frequency", ascending=True),
        x="Frequency",
        y="Transition word or phrase",
        orientation="h",
        color_discrete_sequence=[MAGENTA],
        template=TEMPLATE,
    )
    figure.update_layout(height=360, margin=dict(l=10, r=10, t=20, b=10))
    return figure


def transition_category_figure(features: TextFeatures):
    """Create a category-level transition frequency chart."""
    if not features.transition_category_frequencies:
        return None
    frame = transition_category_table(features)
    figure = px.bar(
        frame.sort_values("Frequency", ascending=True),
        x="Frequency",
        y="Category",
        orientation="h",
        color_discrete_sequence=[MAGENTA],
        template=TEMPLATE,
    )
    figure.update_layout(height=320, margin=dict(l=10, r=10, t=20, b=10))
    return figure


def section_length_figure(sections: list[SectionInfo]):
    """Create a bar chart showing word count per detected section."""
    frame = section_table(sections)
    figure = px.bar(
        frame,
        x="Section",
        y="Words",
        text="Words",
        color_discrete_sequence=[ORANGE],
        template=TEMPLATE,
    )
    figure.update_traces(textposition="outside")
    figure.update_layout(height=380, margin=dict(l=10, r=10, t=20, b=10), xaxis_title=None)
    return figure


def transition_table(features: TextFeatures) -> pd.DataFrame:
    """Return detected transition frequencies in descending order."""
    return pd.DataFrame(
        sorted(features.transition_frequencies.items(), key=lambda item: (-item[1], item[0])),
        columns=["Transition word or phrase", "Frequency"],
    )


def transition_category_table(features: TextFeatures) -> pd.DataFrame:
    """Return transition category frequencies in descending order."""
    return pd.DataFrame(
        sorted(
            features.transition_category_frequencies.items(),
            key=lambda item: (-item[1], item[0]),
        ),
        columns=["Category", "Frequency"],
    )


def section_table(sections: list[SectionInfo]) -> pd.DataFrame:
    """Return detected section metrics."""
    return pd.DataFrame(
        [
            {
                "Section": section.title,
                "Words": section.word_count,
                "Paragraphs": section.paragraph_count,
                "Relative length (%)": round(section.relative_length, 1),
            }
            for section in sections
        ]
    )


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
