"""HTML highlighting for visible writing-pattern exploration."""

from __future__ import annotations

import html
import re

from .feature_extraction import transition_terms_for_language
from .preprocessing import count_words, split_paragraphs, split_sentences
from .section_detection import is_academic_heading


SHORT_SENTENCE_LIMIT = 8
LONG_SENTENCE_LIMIT = 30


def highlighted_text_html(text: str, language: str = "English") -> str:
    """Return a scrollable HTML block with descriptive highlights."""
    blocks: list[str] = []
    for paragraph in split_paragraphs(text):
        if is_academic_heading(paragraph, language):
            blocks.append(f'<p class="highlight-heading">{html.escape(paragraph)}</p>')
            continue

        sentences = [
            highlight_sentence(sentence, language)
            for sentence in split_sentences(paragraph)
        ]
        if sentences:
            blocks.append(f'<p class="highlight-paragraph">{" ".join(sentences)}</p>')

    if not blocks:
        blocks.append('<p class="highlight-paragraph">No text available for highlighting.</p>')

    return HIGHLIGHT_STYLE + '<div class="highlight-box">' + "\n".join(blocks) + "</div>"


def highlight_sentence(sentence: str, language: str = "English") -> str:
    """Highlight one sentence based on length and transition-marker matches."""
    escaped = html.escape(sentence)
    with_transitions = transition_pattern(language).sub(
        r'<span class="transition-word">\1</span>',
        escaped,
    )
    word_count = count_words(sentence)

    if word_count < SHORT_SENTENCE_LIMIT:
        return f'<span class="short-sentence">{with_transitions}</span>'
    if word_count > LONG_SENTENCE_LIMIT:
        return f'<span class="long-sentence">{with_transitions}</span>'
    return with_transitions


def transition_pattern(language: str) -> re.Pattern[str]:
    """Build a language-aware transition pattern, preferring longer phrases."""
    terms = sorted(transition_terms_for_language(language), key=len, reverse=True)
    phrase_patterns = [
        r"\s+".join(re.escape(part) for part in term.split())
        for term in terms
    ]
    return re.compile(
        r"(?<![\w-])(" + "|".join(phrase_patterns) + r")(?![\w-])",
        flags=re.IGNORECASE,
    )


HIGHLIGHT_STYLE = """
<style>
.highlight-box {
    max-height: 520px;
    overflow-y: auto;
    border: 1px solid #d9dee7;
    border-radius: 8px;
    padding: 1rem 1.1rem;
    background: #ffffff;
}
.highlight-heading {
    margin: 1.1rem 0 0.35rem;
    font-weight: 700;
    color: #263445;
    background: #f0ecff;
    border-left: 4px solid #7b61ff;
    padding: 0.25rem 0.5rem;
}
.highlight-paragraph {
    margin: 0 0 1rem;
    line-height: 1.75;
}
.transition-word {
    background: #dff3e6;
    border: 1px solid #9ed2b0;
    border-radius: 4px;
    padding: 0.05rem 0.22rem;
    font-weight: 650;
}
.short-sentence {
    background: #e8f2ff;
    border-bottom: 2px solid #5d8fd6;
    border-radius: 4px;
    padding: 0.06rem 0.18rem;
}
.long-sentence {
    background: #fff1d9;
    border-bottom: 2px solid #c98922;
    border-radius: 4px;
    padding: 0.06rem 0.18rem;
}
</style>
"""
