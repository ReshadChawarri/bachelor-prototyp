"""Reflection questions that invite interpretation rather than correction."""

from __future__ import annotations

import streamlit as st


ENGLISH_PROMPTS = {
    "sentence": (
        "Do longer sentences appear in specific parts of the text?",
        "Does the sentence rhythm feel consistent or varied?",
        "How might the sentence length pattern influence how the text is read?",
    ),
    "paragraph": (
        "Are some paragraphs much longer or shorter than others?",
        "Does the paragraph structure support the flow of the argument?",
        "Where does the text move through compact or extended paragraphs?",
    ),
    "transition": (
        "Which types of transitions appear most often?",
        "Do the transitions support the logical connections between ideas?",
        "Are transitions concentrated in particular parts of the text?",
    ),
    "section": (
        "Does the distribution across sections match the intended structure of the text?",
        "Are some sections noticeably longer or shorter than expected?",
        "Which detected sections would you inspect more closely?",
    ),
    "highlighting": (
        "What patterns become visible when looking directly at the highlighted text?",
        "Do long or short sentences cluster in specific parts of the text?",
        "Do transition markers appear where you expected them?",
    ),
    "general": (
        "Which pattern surprised you most?",
        "Is there any part of the text you would inspect more closely after seeing these visualizations?",
        "How do the visible patterns relate to your intended academic writing style?",
    ),
}

GERMAN_PROMPTS = {
    "sentence": (
        "Tauchen längere Sätze in bestimmten Teilen des Textes auf?",
        "Wirkt der Satzrhythmus eher gleichmäßig oder abwechslungsreich?",
        "Wie könnte das Muster der Satzlängen das Lesen des Textes beeinflussen?",
    ),
    "paragraph": (
        "Sind einige Absätze deutlich länger oder kürzer als andere?",
        "Wie unterstützt die Absatzstruktur den Verlauf der Argumentation?",
        "Wo arbeitet der Text eher mit kompakten oder ausführlicheren Absätzen?",
    ),
    "transition": (
        "Welche Arten von Übergängen treten am häufigsten auf?",
        "Machen die Übergänge logische Verbindungen zwischen Ideen sichtbar?",
        "Sind Übergänge in bestimmten Teilen des Textes konzentriert?",
    ),
    "section": (
        "Passt die Verteilung der Abschnitte zur beabsichtigten Struktur des Textes?",
        "Sind einige Abschnitte auffällig länger oder kürzer als erwartet?",
        "Welche erkannten Abschnitte würdest du genauer betrachten?",
    ),
    "highlighting": (
        "Welche Muster werden sichtbar, wenn du den hervorgehobenen Text direkt betrachtest?",
        "Bündeln sich lange oder kurze Sätze in bestimmten Teilen des Textes?",
        "Erscheinen Übergangsmarker dort, wo du sie erwartet hast?",
    ),
    "general": (
        "Welches Muster hat dich am meisten überrascht?",
        "Gibt es eine Textstelle, die du nach den Visualisierungen genauer ansehen würdest?",
        "Wie passen die sichtbaren Muster zu deinem beabsichtigten akademischen Schreibstil?",
    ),
}


def prompts_for(language: str, prompt_key: str) -> tuple[str, ...]:
    """Return feature-specific prompts for the selected language."""
    prompt_sets = GERMAN_PROMPTS if language == "German" else ENGLISH_PROMPTS
    return prompt_sets[prompt_key]


def show_prompts(prompts: tuple[str, ...]) -> None:
    """Render a compact set of reflection prompts."""
    st.markdown("**Reflection prompts**")
    for prompt in prompts:
        st.markdown(f"- {prompt}")
