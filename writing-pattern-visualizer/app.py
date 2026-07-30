"""Streamlit entry point for the Writing Pattern Visualizer MVP."""

from __future__ import annotations

from pathlib import Path

import streamlit as st

from src.feature_extraction import extract_features
from src.reflection_prompts import PARAGRAPHS, PROMPTS, SENTENCES, TRANSITIONS
from src.visualizations import (
    longest_sentences_table,
    paragraph_length_figure,
    sentence_length_figure,
    show_overview,
    transition_figure,
)
from src.writing_profile import generate_profile

st.set_page_config(page_title="Writing Pattern Visualizer", page_icon="✦", layout="wide")

st.title("Writing Pattern Visualizer")
st.caption("An interactive view of patterns in your academic writing")

st.header("Introduction")
st.write(
    "Explore how sentence length, paragraph structure, and transition words shape "
    "your text. The results are descriptive starting points for reflection—not a "
    "grade, correction, or quality score. All analysis runs locally."
)

st.header("Upload Academic Text")
input_method = st.radio(
    "Choose a text source",
    ("Upload a .txt file", "Use sample text"),
    horizontal=True,
)

text: str | None = None
if input_method == "Upload a .txt file":
    uploaded_file = st.file_uploader("Select a UTF-8 plain-text file", type=["txt"])
    if uploaded_file is not None:
        try:
            text = uploaded_file.getvalue().decode("utf-8")
        except UnicodeDecodeError:
            st.error("This file is not UTF-8 encoded. Save it as UTF-8 and try again.")
else:
    sample_path = Path(__file__).parent / "sample_texts" / "example_academic_text.txt"
    text = sample_path.read_text(encoding="utf-8")
    st.success("The included academic sample is ready to explore.")

if text is None:
    st.info("Upload a text file or choose the sample text to display the analysis.")
    st.stop()
if not text.strip():
    st.warning("The selected file is empty. Please choose a file containing text.")
    st.stop()

features = extract_features(text)

st.header("Writing Overview")
st.write("These cards summarize the size and basic structure of the selected text.")
show_overview(features)

st.header("Sentence Structure")
st.write(
    "The distribution groups sentences by their word count. It reveals whether "
    "the text relies on similar sentence lengths or uses a wider range."
)
st.plotly_chart(sentence_length_figure(features), use_container_width=True)
st.info(f"Reflection: {SENTENCES}", icon="💭")
with st.expander("Show the five longest sentences"):
    st.dataframe(longest_sentences_table(features), hide_index=True, use_container_width=True)

st.header("Paragraph Structure")
st.write(
    "Each bar represents one paragraph in reading order. Its height is the number "
    "of words in that paragraph."
)
st.plotly_chart(paragraph_length_figure(features), use_container_width=True)
st.info(f"Reflection: {PARAGRAPHS}", icon="💭")

st.header("Transition Words")
st.write(
    "This chart counts selected academic transitions. It shows explicit links "
    "between ideas, but does not judge whether more or fewer are needed."
)
transition_chart = transition_figure(features)
if transition_chart is None:
    st.info("No terms from the predefined transition-word list were found.")
else:
    st.plotly_chart(transition_chart, use_container_width=True)
st.info(f"Reflection: {TRANSITIONS}", icon="💭")

st.header("Personal Writing Profile")
st.write("This rule-based summary describes visible tendencies without evaluating them.")
for observation in generate_profile(features):
    st.markdown(f"- {observation}")

st.header("Reflection Questions")
for prompt in PROMPTS:
    st.markdown(f"- {prompt}")

with st.expander("View analyzed text"):
    st.text(text)
