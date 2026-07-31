# Writing Pattern Visualizer

Version 2 MVP prototype for an HCI / Information Visualization bachelor thesis.

The app helps students upload an academic `.txt` file and explore interpretable writing patterns through a reflection-oriented dashboard. It is designed for exploration and self-reflection, not grading, correction, scoring, or text generation.

Research question:

```text
How can an interactive visualization interface help students explore and reflect on individual writing patterns in academic texts?
```

## Version 2 Features

- Local `.txt` upload and an included academic sample text
- Word, sentence, paragraph, transition, and detected-section counts
- Average and per-unit sentence/paragraph lengths
- Interactive Plotly charts for sentence, paragraph, transition, and section patterns
- Common academic section heading detection
- Section overview with word count, paragraph count, and relative length
- Text highlighting for transition words, very short sentences, and very long sentences
- Expanded editable academic transition list
- Neutral rule-based writing profile
- Feature-specific reflection prompts below the visualizations
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

Open the local address printed by Streamlit, upload a `.txt` file, or select the included sample text.

## How Analysis Works

The application uses regular-expression heuristics to identify words, sentence-ending punctuation, blank-line-separated paragraphs, and common academic section headings. Transition terms come from a visible constant in `src/feature_extraction.py`; pandas prepares chart data and Plotly renders it.

Section detection is based on explicit heading lines such as Abstract, Introduction, Methodology, Results, Discussion, Conclusion, and References. Text highlighting uses fixed thresholds: fewer than 8 words for very short sentences and more than 30 words for very long sentences.

These simple rules keep the prototype local, deterministic, transparent, and interpretable. The prototype does not evaluate whether the text is good or bad.

## Project Structure

```text
writing-pattern-visualizer/
├── app.py
├── requirements.txt
├── README.md
├── sample_texts/
│   └── example_academic_text.txt
├── src/
│   ├── __init__.py
│   ├── feature_extraction.py
│   ├── preprocessing.py
│   ├── reflection_prompts.py
│   ├── section_detection.py
│   ├── text_highlighting.py
│   ├── visualizations.py
│   └── writing_profile.py
└── docs/
    └── prototype_log.md
```

## Limitations

- Plain text upload does not preserve rich document formatting from Word or PDF files.
- Heading detection depends on explicit heading lines and can miss unconventional section labels.
- Sentence splitting may be affected by abbreviations, decimal numbers, citations, and missing punctuation.
- Transition word frequency does not determine whether a transition is rhetorically effective.
- Highlighting is threshold-based and descriptive; it does not identify errors or quality problems.
