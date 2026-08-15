# Prototype V3

## Project Goal

Writing Pattern Visualizer is an HCI / Information Visualization prototype for exploring individual writing patterns in academic texts. It supports reflection by showing selected structural and rhetorical surface patterns in a transparent, rule-based way.

The prototype does not grade, correct, rewrite, or generate text. It does not use external APIs, language models, grammar correction, spelling correction, plagiarism checking, or quality scoring.

## How To Run

```bash
cd writing-pattern-visualizer
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
streamlit run app.py
```

## What Changed From V2 To V3

- Added direct text input with a Streamlit text area.
- Added an explicit `Analyze Text` button so analysis does not update while the user is typing.
- Added input priority: direct text, uploaded `.txt`, then selected sample text.
- Added manual language selection for English and German.
- Added categorized English and German transition marker lists.
- Added transition counts by category and individual marker frequencies.
- Expanded academic section heading detection for English and German.
- Improved highlighting so detected section headings can be highlighted.
- Added language-aware reflection prompts.
- Updated the interface order for evaluation use.

## Final V3 Feature List

- Input and language selection
- Overview metrics
- Sentence length visualization
- Paragraph length visualization
- Transition marker category visualization
- Individual transition marker frequency visualization
- Section structure table and chart
- Highlighted text view
- Rule-based writing profile
- Reflection prompts

## Input Options

Users can provide text in three ways:

1. Paste or write text directly into a text area.
2. Upload a `.txt` file.
3. Select the included sample academic text.

The app only analyzes text after the user clicks **Analyze Text**. If multiple sources are available, direct text has priority, then uploaded text, then the sample.

## Language Support

The user manually selects English or German. There is no automatic language detection.

The selected language affects:

- transition marker analysis
- academic section heading detection
- reflection prompts

## Transition Word Analysis

Transition markers are detected with predefined rule-based category lists for English and German. Categories include addition, contrast, cause and result, examples, sequence, summary, and clarification.

Matching is case-insensitive. Multi-word phrases are supported. Longer phrases are matched before shorter phrases to reduce partial or duplicate counting. German umlauts are handled through normal UTF-8 text processing and Unicode-aware regular expressions.

The app shows:

- total transition count
- transition counts by category
- individual transition word or phrase frequencies

## Section Detection

Academic section detection uses explicit line-based heading rules. It supports common English and German section headings with or without numbering, such as:

- `1 Introduction`
- `1.1 Background`
- `2. Methode`
- `3 Ergebnisse`

Detected sections are summarized with word counts, paragraph counts, and relative length. If no headings are detected, the app explains that this may happen when the text does not contain explicit section headings.

## Visualizations

V3 includes:

- overview metric cards
- sentence length histogram
- paragraph length bar chart
- transition category chart
- individual transition marker chart
- section length chart when sections are detected
- highlighted text view

All visualizations are descriptive and intended as starting points for reflection.

## Reflection Prompts

Reflection prompts are connected to the displayed features. They ask users to observe patterns in sentence length, paragraph length, transition usage, section structure, highlighted text, and overall writing behavior.

The prompts are not prescriptive. They do not tell users what to change.

## Writing Profile

The writing profile is rule-based and neutral. It describes selected tendencies such as:

- sentence length tendency
- sentence length variation
- paragraph compactness
- paragraph variation
- transition marker category distribution
- section heading presence

It does not produce a score or grade.

## Evaluation Use

V3 is intended as the stable version for a qualitative user study. A student can provide an academic text, inspect visualizations, connect metrics back to highlighted text passages, and answer reflection prompts without being positioned as correct or incorrect by the system.

The prototype can be used in an evaluation session to observe:

- whether students understand the visualizations
- which patterns they notice
- how they interpret highlighted text
- whether prompts support reflection
- where explanations or interaction design need refinement

## Limitations

- The prototype only supports plain text.
- Sentence splitting uses punctuation heuristics and can be affected by abbreviations, citations, or unusual formatting.
- Section detection depends on explicit heading lines.
- Transition marker lists are incomplete and approximate.
- Transition counts do not capture rhetorical effectiveness or meaning.
- Highlighting is threshold-based and descriptive.
- The prototype analyzes one text at a time.
