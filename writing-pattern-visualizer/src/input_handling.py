"""Input loading helpers for the Streamlit prototype."""

from __future__ import annotations

from pathlib import Path
from typing import Any


def read_uploaded_file(uploaded_file: Any) -> tuple[str | None, str | None]:
    """Read plain-text uploads with fallbacks for common text encodings."""
    raw_bytes = uploaded_file.getvalue()
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return raw_bytes.decode(encoding), None
        except UnicodeDecodeError:
            continue
    return None, "The uploaded file could not be decoded as plain text."


def resolve_input_text(
    direct_text: str,
    uploaded_file: Any,
    use_sample: bool,
    sample_path: Path,
) -> tuple[str, str, str | None]:
    """Apply the V3 input priority: direct text, uploaded file, then sample."""
    if direct_text.strip():
        return direct_text, "direct text input", None

    if uploaded_file is not None:
        uploaded_text, error = read_uploaded_file(uploaded_file)
        if error:
            return "", "uploaded file", error
        return uploaded_text or "", f"uploaded file: {uploaded_file.name}", None

    if use_sample:
        return sample_path.read_text(encoding="utf-8"), "sample academic text", None

    return "", "no input", "Provide text with one of the input options before analyzing."
