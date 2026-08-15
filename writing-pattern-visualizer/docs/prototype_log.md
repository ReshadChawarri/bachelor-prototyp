# Prototype Log

## MVP Version 1

### Goal

Explore how an interactive visualization interface can help students notice and reflect on individual structural patterns in academic texts. The prototype is a descriptive reflection tool, not an assessment or writing assistant.

### Implemented Features

- UTF-8 `.txt` upload and a bundled sample-text option
- Local paragraph, sentence, and word preprocessing
- Overview counts and average-length metrics
- Plotly sentence-distribution, paragraph-length, and transition-frequency charts
- Optional table containing the five longest sentences
- Neutral rule-based writing profile
- Contextual and collected reflection questions

### Limitations

- The interface was closer to a basic metrics dashboard than a guided reflection tool.
- Section structure was not detected.
- Visual patterns were separated from the original text.
- Reflection prompts were present but not closely tied to every visualization.

## Prototype Version 2

Date: 2026-08-01

### Goal Of This Iteration

V2 improves the prototype from a basic metrics dashboard into a more reflection-oriented visualization interface. The goal is to help students connect abstract metrics with visible writing patterns and guided reflection questions.

### Implemented Features

- Restructured the Streamlit app into clearer sections: Introduction, Upload Academic Text, Writing Overview, Sentence Structure, Paragraph Structure, Transition Words, Section Structure, Text Highlighting, Personal Writing Profile, and Reflection Questions.
- Expanded the writing overview with transition count and detected section count.
- Added local academic section detection for common headings such as Abstract, Introduction, Methodology, Results, Discussion, Conclusion, and References.
- Added a section overview table with section title, word count, paragraph count, and relative length.
- Added a section word count bar chart.
- Added text highlighting for predefined academic transition words, very short sentences, and very long sentences.
- Expanded the predefined transition word and phrase list.
- Improved transition analysis with total detected transitions, top detected transitions, and a frequency chart.
- Improved the rule-based writing profile with observations about sentence tendency, sentence variation, paragraph compactness, paragraph variation, transition usage, and section structure.
- Added feature-specific reflection prompts below sentence, paragraph, transition, section, and highlighting views.
- Added a new sample text with explicit academic section headings.

### Design Rationale

The V2 design treats the app as a reflection dashboard rather than a technical NLP tool. Each visualization is paired with a short explanation and prompts that ask students to interpret what they see. This supports the thesis focus on interpretability and reflection rather than automated evaluation.

The highlighted text view connects dashboard-level patterns back to the original writing. This helps students inspect whether long sentences, short sentences, and transitions appear in specific parts of the text.

### Technical Notes

- All analysis remains local and deterministic.
- No external APIs or language models are used.
- Section detection uses line-based regular expressions over common academic headings.
- Transition detection uses an editable list in `src/feature_extraction.py`.
- Text highlighting uses fixed thresholds: fewer than 8 words for very short sentences and more than 30 words for very long sentences.
- Plotly is used for the main charts, with pandas used to prepare chart data.

### Limitations

- Plain text upload does not preserve rich document formatting from Word or PDF files.
- Heading detection depends on explicit heading lines and can miss unconventional section labels.
- Sentence splitting may be affected by abbreviations, decimal numbers, citations, and missing punctuation.
- Transition word frequency does not determine whether a transition is rhetorically effective.
- Highlighting is threshold-based and descriptive; it does not identify errors or quality problems.

### Next Steps

- Add optional per-section transition counts.
- Add controls for changing short and long sentence thresholds.
- Add exportable reflection notes.
- Add support for comparing two drafts of the same text.
- Test the interface with students and refine explanations based on observed interpretation difficulties.

## Prototype Version 3

Date: 2026-08-15

### Goal Of This Iteration

V3 prepares the prototype as the final evaluation-ready version for a qualitative user study. The interface should allow students to provide a text, run the analysis intentionally, inspect visualizations, connect patterns back to the text, and reflect without feeling judged by the system.

### Implemented Features

- Added three input options: direct text input, `.txt` upload, and optional sample text.
- Added an explicit `Analyze Text` button to avoid live analysis while users type.
- Added manual language selection for English and German.
- Added categorized English and German transition marker lists.
- Added transition counts by category and individual marker frequencies.
- Added English and German academic section heading detection.
- Improved heading detection for numbered headings such as `1 Introduction`, `1.1 Background`, and `2. Methode`.
- Improved highlighted text view with section heading, transition marker, shorter sentence, and longer sentence highlights.
- Added language-aware reflection prompts.
- Updated the writing profile to describe transition category distribution and section heading presence.
- Added `PROTOTYPE_V3.md` as the evaluation-ready documentation.

### Design Rationale

The explicit analysis button gives participants control and prevents the interface from reacting continuously while they are still composing or pasting text. Manual language selection keeps the system transparent and avoids implying automatic language understanding.

Transition markers are grouped by rhetorical function so users can reflect on types of connections rather than only individual words. Highlighting connects abstract chart values back to concrete text passages while avoiding error-oriented language.

### Technical Notes

- All analysis remains local and rule-based.
- Transition detection uses predefined English and German dictionaries in `src/feature_extraction.py`.
- Multi-word transition phrases are matched before shorter phrases to reduce duplicate counting.
- Section detection uses language-specific heading lists in `src/section_detection.py`.
- Reflection prompts are selected from language-specific prompt sets in `src/reflection_prompts.py`.

### Limitations

- The prototype still uses plain-text input only.
- Transition lists are approximate and incomplete.
- Sentence splitting is heuristic.
- Section detection depends on explicit heading lines.
- The prototype does not infer meaning, argument quality, or rhetorical effectiveness.

### Next Steps

- Run qualitative user sessions with students.
- Observe whether participants understand the language selector and input priority.
- Collect feedback on chart labels, highlighting colors, and reflection prompts.
- Decide whether future versions need exportable reflection notes or draft comparison.
