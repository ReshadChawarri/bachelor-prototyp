# Writing Pattern Visualizer

An MVP Streamlit prototype for an HCI / Information Visualization bachelor thesis. It helps students explore structural patterns in academic text and reflect on their writing. It is deliberately descriptive: it does **not** grade, correct, score, or generate text.

## Features

- Local `.txt` upload and an included example
- Word, sentence, and paragraph counts
- Average and per-unit sentence/paragraph lengths
- Frequencies from a small, predefined academic transition list
- Interactive Plotly charts, a longest-sentences table, reflection questions, and a rule-based writing profile
- No external API and no language model

## Install

Python 3.10 or newer is recommended.

```bash
cd writing-pattern-visualizer
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
python -m pip install -r requirements.txt
```

## Run

```bash
streamlit run app.py
```

Open the local address printed by Streamlit, upload a UTF-8 `.txt` file, or select **Explore the example text**.

## How analysis works

The application uses regular-expression heuristics to identify words, sentence-ending punctuation, and blank-line-separated paragraphs. Transition terms come from a visible constant in `src/feature_extraction.py`; pandas prepares chart data and Plotly renders it. This simple approach keeps the prototype fast and interpretable, but abbreviations and unusual formatting can affect sentence boundaries.

## Project structure

Core preprocessing, extraction, chart rendering, profile logic, and reflection prompts are separated in `src/`. The sample input supports demonstrations, while `docs/prototype_log.md` records the prototype scope and design decisions.
