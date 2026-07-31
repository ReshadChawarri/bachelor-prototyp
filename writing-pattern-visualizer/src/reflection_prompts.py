"""Reflection questions that invite interpretation rather than correction."""

from __future__ import annotations

import streamlit as st


SENTENCE_PROMPTS = (
    "What do you notice about the distribution of sentence lengths?",
    "Do longer sentences appear frequently or only occasionally?",
    "How might sentence length influence readability in this text?",
)

PARAGRAPH_PROMPTS = (
    "Are the paragraphs balanced or uneven in length?",
    "Which paragraphs are especially long or short?",
    "How does the paragraph structure shape the rhythm of the text?",
)

TRANSITION_PROMPTS = (
    "Which transitions do you use most often?",
    "Do the detected transitions make relationships between ideas explicit?",
    "Are there sections where transitions appear more or less frequently?",
)

SECTION_PROMPTS = (
    "Which section takes up the most space?",
    "Does the section distribution match the intended structure of the text?",
    "Are any important academic sections missing or unusually short?",
)

HIGHLIGHTING_PROMPTS = (
    "What patterns become visible when looking directly at the highlighted text?",
    "Do long or short sentences cluster in specific parts of the text?",
    "Do transition words appear where you expected them?",
)

GENERAL_PROMPTS = (
    "Which writing pattern feels most characteristic of this text?",
    "Which visualization changed how you looked at the text?",
    "How do the visible patterns relate to your intended academic writing style?",
)


def show_prompts(prompts: tuple[str, ...]) -> None:
    """Render a compact set of reflection prompts."""
    st.markdown("**Reflection prompts**")
    for prompt in prompts:
        st.markdown(f"- {prompt}")
