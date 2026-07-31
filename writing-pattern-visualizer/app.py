"""Streamlit entry point for the Writing Pattern Visualizer V2 prototype."""

from __future__ import annotations

from pathlib import Path

import streamlit as st

from src.feature_extraction import TRANSITION_WORDS, extract_features
from src.reflection_prompts import (
    GENERAL_PROMPTS,
    HIGHLIGHTING_PROMPTS,
    PARAGRAPH_PROMPTS,
    SECTION_PROMPTS,
    SENTENCE_PROMPTS,
    TRANSITION_PROMPTS,
    show_prompts,
)
from src.section_detection import detect_sections
from src.text_highlighting import (
    LONG_SENTENCE_LIMIT,
    SHORT_SENTENCE_LIMIT,
    highlighted_text_html,
)
from src.visualizations import (
    longest_sentences_table,
    paragraph_length_figure,
    section_length_figure,
    section_table,
    sentence_length_figure,
    show_overview,
    transition_figure,
    transition_table,
)
from src.writing_profile import generate_profile


PROJECT_DIR = Path(__file__).parent
SAMPLE_PATH = PROJECT_DIR / "sample_texts" / "example_academic_text.txt"


st.set_page_config(page_title="Writing Pattern Visualizer", page_icon="W", layout="wide")


def read_uploaded_file(uploaded_file) -> str:
    """Read plain-text uploads with a small fallback for common text encodings."""
    try:
        return uploaded_file.getvalue().decode("utf-8")
    except UnicodeDecodeError:
        return uploaded_file.getvalue().decode("latin-1")


def show_highlight_legend() -> None:
    """Render a compact legend for the highlighted text view."""
    st.markdown(
        """
        <style>
        .legend-row {
            display: flex;
            flex-wrap: wrap;
            gap: 0.75rem;
            margin: 0.25rem 0 1rem;
        }
        .legend-chip {
            border-radius: 6px;
            border: 1px solid #d9dee7;
            padding: 0.35rem 0.55rem;
            font-size: 0.92rem;
        }
        .legend-transition {
            background: #dff3e6;
            border-color: #9ed2b0;
        }
        .legend-short {
            background: #e8f2ff;
            border-bottom: 2px solid #5d8fd6;
        }
        .legend-long {
            background: #fff1d9;
            border-bottom: 2px solid #c98922;
        }
        </style>
        <div class="legend-row">
            <span class="legend-chip legend-transition">transition words</span>
            <span class="legend-chip legend-short">very short sentences</span>
            <span class="legend-chip legend-long">very long sentences</span>
        </div>
        """,
        unsafe_allow_html=True,
    )


with st.sidebar:
    st.header("Prototype V2")
    st.write("Reflection dashboard for exploring academic writing patterns.")
    st.divider()
    st.markdown("**Local analysis**")
    st.write("No external APIs, language models, grading, or automatic correction.")
    st.markdown("**Highlight thresholds**")
    st.write(f"Very short sentences: fewer than {SHORT_SENTENCE_LIMIT} words.")
    st.write(f"Very long sentences: more than {LONG_SENTENCE_LIMIT} words.")


st.title("Writing Pattern Visualizer")
st.caption("Version 2 MVP prototype for academic writing reflection")

st.header("Introduction")
st.write(
    "This prototype helps students explore visible patterns in academic writing through "
    "local, deterministic, and interpretable visualizations. It does not generate text, "
    "grade writing, or correct the uploaded document."
)


st.header("Upload Academic Text")
st.write(
    "Upload a `.txt` file, or use the included sample text to test the reflection dashboard "
    "without preparing a file."
)
input_method = st.radio(
    "Text source",
    ("Use sample text", "Upload a .txt file"),
    horizontal=True,
)

text: str | None = None
if input_method == "Upload a .txt file":
    uploaded_file = st.file_uploader("Choose an academic text file", type=["txt"])
    if uploaded_file is not None:
        text = read_uploaded_file(uploaded_file)
        st.caption(f"Selected file: {uploaded_file.name}")
else:
    text = SAMPLE_PATH.read_text(encoding="utf-8")
    st.caption("Using the included academic sample text.")

if text is None:
    st.info("Upload a text file or choose the sample text to display the analysis.")
    st.stop()
if not text.strip():
    st.warning("The selected file is empty. Please choose a file containing text.")
    st.stop()


features = extract_features(text)
sections = detect_sections(text)
profile = generate_profile(features, sections)


st.header("Writing Overview")
st.write(
    "These metrics provide a first overview of the text structure. They are descriptive "
    "and should be used as starting points for reflection."
)
show_overview(features, section_count=len(sections))


st.header("Sentence Structure")
st.write(
    "The sentence length distribution shows how often sentences of different lengths appear. "
    "The dotted reference lines mark the thresholds used later for text highlighting."
)
st.plotly_chart(sentence_length_figure(features), use_container_width=True)
with st.expander("View the five longest detected sentences"):
    st.dataframe(longest_sentences_table(features), hide_index=True, use_container_width=True)
show_prompts(SENTENCE_PROMPTS)


st.header("Paragraph Structure")
st.write(
    "The paragraph chart shows the number of words in each detected content paragraph. "
    "It can reveal whether the text moves through similarly sized blocks or alternates "
    "between compact and extended paragraphs."
)
st.plotly_chart(paragraph_length_figure(features), use_container_width=True)
show_prompts(PARAGRAPH_PROMPTS)


st.header("Transition Words")
st.write(
    "This view counts explicit academic transition words and phrases from a predefined local list. "
    "The list is transparent and can be edited in the code."
)
st.metric("Detected transition words", features.transition_count)
if features.transition_frequencies:
    st.dataframe(transition_table(features).head(10), hide_index=True, use_container_width=True)
    st.plotly_chart(transition_figure(features), use_container_width=True)
else:
    st.info(
        "No transition words from the predefined list were detected. This does not indicate "
        "a problem; it only means the current local list did not match explicit transitions "
        "in the text."
    )
with st.expander("View predefined transition list"):
    st.write(", ".join(TRANSITION_WORDS))
show_prompts(TRANSITION_PROMPTS)


st.header("Section Structure")
st.write(
    "This section uses simple line-based heading detection for common academic headings such as "
    "Abstract, Introduction, Methodology, Results, Discussion, and Conclusion."
)
if sections:
    st.dataframe(section_table(sections), hide_index=True, use_container_width=True)
    st.plotly_chart(section_length_figure(sections), use_container_width=True)
else:
    st.info(
        "No clear academic section headings were detected. This may be due to the text format "
        "or because the text does not use explicit headings."
    )
show_prompts(SECTION_PROMPTS)


st.header("Text Highlighting")
st.write(
    "The highlighted view connects the visual summaries back to the text. Highlighting supports "
    "exploration and does not mark errors."
)
show_highlight_legend()
with st.expander("View highlighted text", expanded=True):
    st.markdown(highlighted_text_html(text), unsafe_allow_html=True)
show_prompts(HIGHLIGHTING_PROMPTS)


st.header("Personal Writing Profile")
st.write(
    "The profile summarizes observed tendencies with rule-based statements. It is descriptive, "
    "not evaluative."
)
for observation in profile:
    st.markdown(f"- {observation}")


st.header("Reflection Questions")
st.write(
    "Use these questions to connect the visual patterns to your own writing process and intentions."
)
for prompt in GENERAL_PROMPTS:
    st.markdown(f"- {prompt}")


with st.expander("View analyzed text"):
    st.write(f"Paragraphs detected: {features.paragraph_count}")
    st.write(f"Sentences detected: {features.sentence_count}")
    st.write(f"Words detected: {features.word_count}")
    st.text(text)
