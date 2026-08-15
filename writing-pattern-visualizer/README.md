# Writing Pattern Visualizer

Version 3 evaluation-ready prototype for an HCI / Information Visualization bachelor thesis.

The app helps students provide an academic text, inspect interpretable writing-pattern visualizations, and reflect on their own writing behavior. It is designed for exploration and self-reflection, not grading, correction, scoring, rewriting, plagiarism checking, or text generation.

Research question:

```text
How can an interactive visualization interface help students explore and reflect on individual writing patterns in academic texts?
```

## Version 3 Features

- Three input options: `.txt` upload, direct text input, and optional sample text
- Explicit `Analyze Text` button to avoid live analysis while users type
- Manual language selection for English and German
- Rule-based English and German transition marker categories
- Transition totals, category counts, and individual marker frequencies
- English and German academic section heading detection
- Overview metrics for words, sentences, paragraphs, averages, transitions, and detected sections
- Interactive Plotly charts for sentence, paragraph, transition, and section patterns
- Highlighted text view for section headings, transition markers, shorter sentences, and longer sentences
- Neutral rule-based writing profile
- Feature-specific reflection prompts
- Fully local, deterministic, transparent analysis

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

Open the local address printed by Streamlit. Choose a language, provide text through one of the input options, and click **Analyze Text**.

## Evaluation Use

V3 is intended as the stable prototype for a qualitative user study. A participant can provide an academic text, inspect descriptive visualizations, connect charts back to highlighted text passages, and answer reflection prompts. The prototype does not judge the text and should be presented as a reflection aid rather than an assessment tool.

## Documentation

See [PROTOTYPE_V3.md](PROTOTYPE_V3.md) for the final evaluation-ready feature overview, analysis rules, limitations, and evaluation notes.

## Project Structure

```text
writing-pattern-visualizer/
├── app.py
├── requirements.txt
├── README.md
├── PROTOTYPE_V3.md
├── sample_texts/
│   └── example_academic_text.txt
├── src/
│   ├── __init__.py
│   ├── feature_extraction.py
│   ├── input_handling.py
│   ├── preprocessing.py
│   ├── reflection_prompts.py
│   ├── section_detection.py
│   ├── text_highlighting.py
│   ├── visualizations.py
│   └── writing_profile.py
└── docs/
    └── prototype_log.md
```

## Scope Limits

- No external API
- No language model
- No grammar or spelling correction
- No plagiarism checking
- No rewriting
- No quality scores or grades
- Plain text only
