"""Streamlit entry point for the Writing Pattern Visualizer V3 prototype."""

from __future__ import annotations

from pathlib import Path

import streamlit as st

from src.feature_extraction import (
    transition_categories_for_language,
    extract_features,
)
from src.input_handling import resolve_input_text
from src.reflection_prompts import prompts_for, show_prompts
from src.section_detection import detect_sections, section_headings_for_language
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
    transition_category_figure,
    transition_category_table,
    transition_figure,
    transition_table,
)
from src.writing_profile import generate_profile


PROJECT_DIR = Path(__file__).parent
SAMPLE_PATH = PROJECT_DIR / "sample_texts" / "example_academic_text.txt"
LANGUAGES = ("English", "German")


st.set_page_config(page_title="Writing Pattern Visualizer", page_icon="W", layout="wide")


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
        .legend-heading {
            background: #f0ecff;
            border-left: 4px solid #7b61ff;
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
            <span class="legend-chip legend-heading">detected section headings</span>
            <span class="legend-chip legend-transition">transition markers</span>
            <span class="legend-chip legend-short">shorter sentences</span>
            <span class="legend-chip legend-long">longer sentences</span>
        </div>
        """,
        unsafe_allow_html=True,
    )


def show_transition_lists(language: str) -> None:
    """Display the selected language's rule-based transition categories."""
    for category, terms in transition_categories_for_language(language).items():
        st.markdown(f"**{category}:** {', '.join(terms)}")


def show_section_heading_list(language: str) -> None:
    """Display the selected language's rule-based heading list."""
    st.write(", ".join(section_headings_for_language(language)))


def store_analysis_payload(
    text: str,
    language: str,
    source_label: str,
) -> None:
    st.session_state.analysis_payload = {
        "text": text,
        "language": language,
        "source_label": source_label,
    }


if "analysis_payload" not in st.session_state:
    st.session_state.analysis_payload = None


with st.sidebar:
    st.header("Prototype V3")
    st.write("Evaluation-ready reflection dashboard for academic writing patterns.")
    st.divider()
    st.markdown("**Local analysis**")
    st.write("No external APIs, language models, grading, rewriting, or automatic correction.")
    st.markdown("**Highlight thresholds**")
    st.write(f"Shorter sentences: fewer than {SHORT_SENTENCE_LIMIT} words.")
    st.write(f"Longer sentences: more than {LONG_SENTENCE_LIMIT} words.")


st.title("Writing Pattern Visualizer")
st.caption("Version 3 evaluation-ready prototype for academic writing reflection")


st.header("1. Input and Language Selection")
st.write(
    "This prototype does not grade, correct, or rewrite the text. It visualizes "
    "selected writing patterns to support reflection."
)
selected_language = st.selectbox(
    "Manual language selection",
    LANGUAGES,
    help=(
        "This is a manual setting. The prototype does not automatically detect the "
        "language of the text."
    ),
)
st.caption(
    "The selected language affects transition marker analysis, academic section "
    "heading detection, and reflection prompts."
)

direct_text = st.text_area(
    "Paste or write text directly",
    height=220,
    placeholder="Paste an academic text here...",
)
uploaded_file = st.file_uploader("Upload a .txt file", type=["txt"])
use_sample = st.checkbox("Use sample academic text if no direct or uploaded text is provided")

st.caption(
    "Input priority: 1. direct text input, 2. uploaded .txt file, 3. selected sample text."
)

if st.button("Analyze Text", type="primary"):
    text_to_analyze, source_label, input_error = resolve_input_text(
        direct_text=direct_text,
        uploaded_file=uploaded_file,
        use_sample=use_sample,
        sample_path=SAMPLE_PATH,
    )
    if input_error:
        st.warning(input_error)
        st.session_state.analysis_payload = None
    elif not text_to_analyze.strip():
        st.warning("The selected input is empty. Add text before running the analysis.")
        st.session_state.analysis_payload = None
    else:
        store_analysis_payload(text_to_analyze, selected_language, source_label)
        st.success("Text analysis is ready below.")

payload = st.session_state.analysis_payload
if not payload:
    st.info("Choose an input source and click Analyze Text to display the dashboard.")
    st.stop()
    raise SystemExit

text = payload["text"]
language = payload["language"]
st.caption(
    f"Current analysis uses {payload['source_label']} with language set to {language}. "
    "Click Analyze Text again after changing input or language."
)

features = extract_features(text, language)
sections = detect_sections(text, language)
profile = generate_profile(features, sections)


st.header("2. Overview Metrics")
st.write(
    "These metrics provide a first overview of the text structure. They are descriptive "
    "and should be used as starting points for reflection."
)
show_overview(features, section_count=len(sections))


st.header("3. Sentence Length Patterns")
st.write(
    "This visualization shows how sentence lengths are distributed. The dotted reference "
    "lines mark the transparent thresholds used for highlighting shorter and longer sentences."
)
if features.sentence_lengths:
    st.plotly_chart(sentence_length_figure(features), use_container_width=True)
    with st.expander("View the five longest detected sentences"):
        st.dataframe(longest_sentences_table(features), hide_index=True, width="stretch")
else:
    st.info("No sentence lengths could be calculated from the current text.")
show_prompts(prompts_for(language, "sentence"))


st.header("4. Paragraph Length Patterns")
st.write(
    "This visualization shows the word count of each detected content paragraph. It can "
    "make compact and extended paragraph patterns visible without evaluating them."
)
if features.paragraph_lengths:
    st.plotly_chart(paragraph_length_figure(features), use_container_width=True)
else:
    st.info("No content paragraphs could be detected from the current text.")
show_prompts(prompts_for(language, "paragraph"))


st.header("5. Transition Word Usage")
st.write(
    "Transition markers are detected using predefined rule-based lists. The analysis is "
    "approximate and does not represent a complete linguistic interpretation of the text."
)
st.metric("Detected transition markers", features.transition_count)
if features.transition_frequencies:
    st.subheader("Transition Categories")
    st.dataframe(transition_category_table(features), hide_index=True, width="stretch")
    st.plotly_chart(transition_category_figure(features), use_container_width=True)

    st.subheader("Individual Transition Markers")
    st.dataframe(transition_table(features), hide_index=True, width="stretch")
    st.plotly_chart(transition_figure(features), use_container_width=True)
else:
    st.info(
        "No transition markers from the predefined list were detected. This can happen "
        "with short texts, different wording, or texts that use implicit connections."
    )
with st.expander("View selected transition marker lists"):
    show_transition_lists(language)
show_prompts(prompts_for(language, "transition"))


st.header("6. Section Structure")
st.write(
    "This view detects explicit academic section headings with transparent line-based rules. "
    "Numbered headings such as 1 Introduction, 1.1 Background, or 2. Methode can be detected."
)
if sections:
    st.dataframe(section_table(sections), hide_index=True, width="stretch")
    st.plotly_chart(section_length_figure(sections), use_container_width=True)
else:
    st.info(
        "No academic section headings were detected. This may happen if the text does "
        "not contain explicit section headings."
    )
with st.expander("View selected academic section heading list"):
    show_section_heading_list(language)
show_prompts(prompts_for(language, "section"))


st.header("7. Highlighted Text View")
st.write(
    "Highlighting is used to connect abstract metrics back to concrete parts of the text. "
    "It is not an error marker."
)
show_highlight_legend()
with st.expander("View highlighted text", expanded=True):
    st.markdown(highlighted_text_html(text, language), unsafe_allow_html=True)
show_prompts(prompts_for(language, "highlighting"))


st.header("8. Writing Profile")
st.write(
    "The writing profile summarizes selected tendencies with rule-based statements. "
    "It does not produce a score or grade."
)
for observation in profile:
    st.markdown(f"- {observation}")


st.header("9. Reflection Prompts")
st.write(
    "Use these questions to connect the visual patterns to your own writing process and intentions."
)
for prompt in prompts_for(language, "general"):
    st.markdown(f"- {prompt}")


with st.expander("View analyzed plain text"):
    st.write(f"Paragraphs detected: {features.paragraph_count}")
    st.write(f"Sentences detected: {features.sentence_count}")
    st.write(f"Words detected: {features.word_count}")
    st.text(text)
