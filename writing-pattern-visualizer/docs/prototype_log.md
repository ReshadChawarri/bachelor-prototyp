# Prototype log

## MVP Version 1

### Goal

Explore how an interactive visualization interface can help students notice and reflect on individual structural patterns in academic texts. The prototype is a descriptive reflection tool, not an assessment or writing assistant.

### Implemented features

- UTF-8 `.txt` upload and a bundled sample-text option
- Local paragraph, sentence, and word preprocessing
- Overview counts and average-length metrics
- Plotly sentence-distribution, paragraph-length, and transition-frequency charts
- Optional table containing the five longest sentences
- Neutral rule-based writing profile
- Contextual and collected reflection questions

### Design rationale

The interface follows the analysis journey from input and overview to increasingly specific structural views. Every chart includes a plain-language explanation so non-technical students can interpret its marks. Questions below the charts encourage students to connect visible patterns to their intentions rather than treating a metric as a prescription. The profile uses explicit thresholds and avoids evaluative labels.

The prototype deliberately uses transparent heuristics rather than advanced NLP. Paragraphs are separated by blank lines, sentences by terminal punctuation followed by whitespace, and words by a small regular expression. Academic transitions are counted from a predefined list. All analysis is local; no external API or language model is used.

### Limitations

- Sentence boundaries may be imperfect around abbreviations, initials, and unusual punctuation.
- The transition list is intentionally small and cannot represent every relationship between ideas.
- Counts reveal surface structure but not meaning, argument quality, or author intention.
- Version 1 accepts plain-text input only and analyzes one document at a time.
- Rule thresholds are exploratory design choices, not academic-writing standards.

### Next steps

- Conduct usability sessions with students and revise labels and reflection prompts.
- Explore selectable sections and sentence-level highlighting linked to charts.
- Test accessible color, keyboard navigation, and screen-reader descriptions.
- Let users compare two of their own texts without introducing scores or rankings.
- Evaluate whether users can accurately interpret each visualization.
