"""Small, dependency-free helpers for preparing uploaded text."""

from __future__ import annotations

import re


def split_paragraphs(text: str) -> list[str]:
    """Return non-empty paragraphs separated by one or more blank lines."""
    return [part.strip() for part in re.split(r"\n\s*\n", text.strip()) if part.strip()]


def split_sentences(text: str) -> list[str]:
    """Split text at common sentence-ending punctuation.

    This intentionally transparent heuristic is sufficient for the MVP and keeps
    all processing local. It is not intended to replace linguistic tokenization.
    """
    normalized = re.sub(r"\s+", " ", text.strip())
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+", normalized) if part.strip()]


def words(text: str) -> list[str]:
    """Return word-like tokens, retaining contractions and hyphenated words."""
    return re.findall(r"\b[\w]+(?:[-'][\w]+)*\b", text, flags=re.UNICODE)


def count_words(text: str) -> int:
    """Count word-like tokens in *text*."""
    return len(words(text))


def is_probable_heading(text: str) -> bool:
    """Detect short heading-like blocks so they do not skew paragraph metrics."""
    cleaned = re.sub(r"\s+", " ", text.strip())
    return 0 < count_words(cleaned) <= 6 and not re.search(r"[.!?]", cleaned)


def content_paragraphs(text: str) -> list[str]:
    """Return paragraphs that appear to contain prose rather than only headings."""
    return [paragraph for paragraph in split_paragraphs(text) if not is_probable_heading(paragraph)]
