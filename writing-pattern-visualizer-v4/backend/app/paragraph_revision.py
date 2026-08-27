from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import logging
import re
import time
from typing import Literal, Protocol

from pydantic import Field, ValidationError, field_validator, model_validator

from .config import AppSettings, get_settings
from .paragraph_ai_analysis import (
    Language,
    ParagraphAIAnalysisError,
    ParagraphAIConfigurationError,
    ParagraphAIInsufficientTextError,
    ParagraphAIInvalidResponseError,
    ParagraphAIUpstreamError,
    ParagraphContext,
    SelectedParagraph,
    StrictModel,
    ensure_analyzable_text,
    exception_class_name,
    extract_openai_error_code,
    extract_openai_error_type,
    extract_upstream_status,
    sanitize_error_message,
)


logger = logging.getLogger(__name__)

PARAGRAPH_REVISION_VERSION = "paragraph-revision-v1"
MIN_LENGTH_ADJUSTMENT_WORDS = 20
MIN_LENGTH_ADJUSTMENT_RATIO = 0.5
MAX_LENGTH_ADJUSTMENT_RATIO = 1.75
LENGTH_TARGET_TOLERANCE_PERCENT = 0.05
LENGTH_TARGET_TOLERANCE_MIN_WORDS = 6
SENTENCE_REVISION_WORD_DRIFT_RATIO = 0.35
SENTENCE_REVISION_MIN_WORD_DRIFT = 12
SENTENCE_SHORT_MAX_WORDS = 7
SENTENCE_MEDIUM_MAX_WORDS = 20
SENTENCE_LONG_MAX_WORDS = 30
SENTENCE_CATEGORIES = ("Short", "Medium", "Long", "Very long")
SENTENCE_RANGE_LABELS: dict[str, str] = {
    "Short": "1-7 words",
    "Medium": "8-20 words",
    "Long": "21-30 words",
    "Very long": "31+ words",
}
COMMON_SENTENCE_ABBREVIATIONS = [
    "e.g.",
    "i.e.",
    "etc.",
    "fig.",
    "dr.",
    "mr.",
    "mrs.",
    "ms.",
    "prof.",
    "vs.",
    "cf.",
    "no.",
]
ABBREVIATION_DOT_PLACEHOLDER = "<DOT>"
SENTENCE_PATTERN = re.compile(r"[^.!?]+(?:[.!?]+[\"')\]]*)+|[^.!?]+$")

ParagraphRevisionAction = Literal[
    "improve_clarity",
    "improve_academic_tone",
    "improve_transition",
    "adjust_paragraph_length",
    "improve_sentence_length",
]

ACTION_LABELS: dict[str, str] = {
    "improve_clarity": "Improve clarity",
    "improve_academic_tone": "Improve academic tone",
    "improve_transition": "Improve transition / coherence",
    "adjust_paragraph_length": "Adjust paragraph length",
    "improve_sentence_length": "Improve sentence length",
}

ACTION_INSTRUCTIONS: dict[str, str] = {
    "improve_clarity": """
Improve clarity by simplifying sentence structure where useful, reducing redundancy, clarifying referents,
and improving logical ordering inside the target paragraph.
Do not simplify away substantive meaning, remove evidence or citations, or introduce new claims.
""".strip(),
    "improve_academic_tone": """
Improve academic tone by making wording more formal, precise, and discipline-neutral where useful.
Do not make the paragraph artificially complex, do not automatically convert sentences to passive voice,
and do not strengthen claims beyond the original.
""".strip(),
    "improve_transition": """
Improve transitions and coherence within the target paragraph and, where directly supported, its connection to
the supplied context. Do not invent argumentative relationships, add evidence, or rewrite neighboring paragraphs.
""".strip(),
    "adjust_paragraph_length": """
Adjust the target paragraph toward the requested word count while preserving its substantive meaning.
The target is approximate, not a command to damage grammar or remove essential content.
If shortening, tighten redundant wording and overlapping phrasing while preserving evidence, citations, qualifiers,
numbers, and factual claims.
If lengthening, clarify existing ideas and make supported relationships more explicit. Do not invent examples,
evidence, citations, statistics, arguments, results, or factual details to reach the target.
""".strip(),
    "improve_sentence_length": """
Improve readability by making the target paragraph's sentence structure more concise.
Shorten unnecessarily long sentences, split overloaded sentences where appropriate, reduce excessive clause nesting,
clarify referents, and preserve logical connections between sentences.
The goal is sentence restructuring, not a paragraph-length rewrite. Keep the overall paragraph content and length
reasonably similar unless small wording changes naturally occur.
""".strip(),
}

PARAGRAPH_REVISION_INSTRUCTIONS = """
You are generating one optional paragraph-level revision suggestion for an academic writing prototype.

Only rewrite the TARGET PARAGRAPH.
Adjacent paragraphs and headings are CONTEXT ONLY and must not be rewritten.

The revision must preserve the target paragraph's substantive meaning.
Do not invent facts, evidence, references, citations, statistics, sources, participant details, results, or causal claims.
Do not add unsupported certainty.
Preserve existing citations, numbers, years, percentages, URLs, DOIs, email addresses, and quoted material.
Do not introduce citations that were not present in the target paragraph.
Do not silently paraphrase text inside explicit quotation marks.
Generate exactly one revised paragraph and one short summary of the language/organization change.
Use the required structured schema.
""".strip()

PROTECTED_PATTERNS: dict[str, re.Pattern[str]] = {
    "square citations": re.compile(r"\[[0-9A-Za-z][^\[\]\n]{0,80}\]"),
    "author-year citations": re.compile(r"\([A-ZÄÖÜ][^()\n]{1,90},\s*\d{4}[a-z]?(?:,\s*p+\.\s*\d+)?\)"),
    "urls": re.compile(r"\b(?:https?://|www\.)[^\s)]+", re.IGNORECASE),
    "dois": re.compile(r"\b(?:doi:\s*)?10\.\d{4,9}/[^\s)]+", re.IGNORECASE),
    "emails": re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b"),
    "numbers": re.compile(r"(?<![\w])\d+(?:[.,]\d+)?%?"),
    "straight double quotes": re.compile(r'"[^"\n]+"'),
    "straight single quotes": re.compile(r"'[^'\n]+'"),
    "curly double quotes": re.compile(r"“[^”\n]+”"),
    "curly single quotes": re.compile(r"‘[^’\n]+’"),
    "german quotes": re.compile(r"„[^“\n]+“"),
}


class ParagraphRevisionRequest(StrictModel):
    documentId: str = Field(min_length=1)
    revision: int = Field(ge=0)
    requestId: str = Field(min_length=1)
    language: Language = "English"
    action: ParagraphRevisionAction
    sourceContentHash: str = Field(min_length=1)
    targetWordCount: int | None = Field(default=None, ge=1)
    paragraph: SelectedParagraph
    context: ParagraphContext = Field(default_factory=ParagraphContext)

    @model_validator(mode="after")
    def validate_target_for_action(self) -> "ParagraphRevisionRequest":
        if self.action == "adjust_paragraph_length" and self.targetWordCount is None:
            raise ValueError("targetWordCount is required for paragraph length adjustment.")
        if self.action != "adjust_paragraph_length" and self.targetWordCount is not None:
            raise ValueError("targetWordCount is only supported for paragraph length adjustment.")
        return self


class ParagraphRevisionSuggestion(StrictModel):
    revisedText: str = Field(min_length=1, max_length=8000)
    summary: str = Field(min_length=1, max_length=220)

    @field_validator("revisedText", "summary")
    @classmethod
    def reject_blank_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Text must not be blank.")
        return value.strip()


class LengthAdjustmentMetadata(StrictModel):
    originalWordCount: int = Field(ge=0)
    targetWordCount: int = Field(ge=1)
    revisedWordCount: int = Field(ge=0)
    withinTolerance: bool


class SentenceDistributionCount(StrictModel):
    category: str
    count: int = Field(ge=0)
    rangeLabel: str


class SentenceLengthRevisionMetadata(StrictModel):
    originalSentenceCount: int = Field(ge=0)
    revisedSentenceCount: int = Field(ge=0)
    originalAverageSentenceLength: float = Field(ge=0)
    revisedAverageSentenceLength: float = Field(ge=0)
    originalDistribution: list[SentenceDistributionCount]
    revisedDistribution: list[SentenceDistributionCount]


class ParagraphRevisionResponse(StrictModel):
    documentId: str
    sourceRevision: int
    requestId: str
    paragraphId: str
    sourceContentHash: str
    action: ParagraphRevisionAction
    model: str
    revisionVersion: str
    suggestion: ParagraphRevisionSuggestion
    length: LengthAdjustmentMetadata | None = None
    sentence: SentenceLengthRevisionMetadata | None = None


@dataclass(frozen=True)
class RevisionPromptPayload:
    system_instructions: str
    user_message: str


class ParagraphRevisionClient(Protocol):
    def suggest_revision(self, request: ParagraphRevisionRequest, model: str) -> ParagraphRevisionSuggestion:
        ...


class ParagraphRevisionGuardrailError(ParagraphAIAnalysisError):
    user_message = "The suggested revision could not be safely validated. No changes were made."
    status_code = 422


class ParagraphRevisionTargetError(ParagraphAIAnalysisError):
    user_message = "The requested target length is outside the supported range for this paragraph."
    status_code = 422


class OpenAIResponsesParagraphRevisionClient:
    def __init__(self, settings: AppSettings | None = None, raw_client: object | None = None):
        self.settings = settings or get_settings()
        self.raw_client = raw_client

    def suggest_revision(self, request: ParagraphRevisionRequest, model: str) -> ParagraphRevisionSuggestion:
        prompt = build_paragraph_revision_prompt(request)
        started_at = time.perf_counter()
        try:
            client = self.raw_client or self._openai_client()
        except ParagraphAIConfigurationError as exc:
            log_paragraph_revision_failure("client_initialization", exc, model, self.settings)
            raise
        except Exception as exc:  # pragma: no cover - defensive guard for SDK initialization details.
            log_paragraph_revision_failure("client_initialization", exc, model, self.settings)
            raise ParagraphAIUpstreamError() from exc

        try:
            response = client.responses.parse(
                model=model,
                input=[
                    {"role": "system", "content": prompt.system_instructions},
                    {"role": "user", "content": prompt.user_message},
                ],
                text_format=ParagraphRevisionSuggestion,
            )
        except ValidationError as exc:
            log_paragraph_revision_failure("structured_outputs_parse", exc, model, self.settings)
            raise ParagraphAIInvalidResponseError() from exc
        except Exception as exc:  # pragma: no cover - concrete SDK errors vary by installed version.
            log_paragraph_revision_failure("responses_api_request", exc, model, self.settings)
            raise ParagraphAIUpstreamError() from exc

        parsed = getattr(response, "output_parsed", None)
        try:
            suggestion = (
                parsed
                if isinstance(parsed, ParagraphRevisionSuggestion)
                else ParagraphRevisionSuggestion.model_validate(parsed)
            )
        except ValidationError as exc:
            log_paragraph_revision_failure("application_response_validation", exc, model, self.settings)
            raise ParagraphAIInvalidResponseError() from exc

        usage = getattr(response, "usage", None)
        logger.info(
            "paragraph_revision_succeeded paragraph_id=%s action=%s model=%s latency_ms=%d usage=%s",
            request.paragraph.paragraphId,
            request.action,
            model,
            round((time.perf_counter() - started_at) * 1000),
            usage,
        )
        return suggestion

    def _openai_client(self):
        if not self.settings.openai_api_key:
            raise ParagraphAIConfigurationError()
        try:
            from openai import OpenAI
        except ImportError as exc:  # pragma: no cover - dependency presence is checked by packaging.
            raise ParagraphAIConfigurationError("OpenAI SDK is not installed.") from exc

        return OpenAI(api_key=self.settings.openai_api_key)


class ParagraphRevisionService:
    def __init__(self, settings: AppSettings | None = None, client: ParagraphRevisionClient | None = None):
        self.settings = settings or get_settings()
        self.client = client or OpenAIResponsesParagraphRevisionClient(self.settings)

    def suggest_revision(self, request: ParagraphRevisionRequest) -> ParagraphRevisionResponse:
        ensure_analyzable_text(request.paragraph.text)
        length_metadata: LengthAdjustmentMetadata | None = None
        sentence_metadata: SentenceLengthRevisionMetadata | None = None
        original_word_count = count_revision_words(request.paragraph.text)
        if request.action == "adjust_paragraph_length":
            ensure_supported_length_target(original_word_count, request.targetWordCount)

        logger.info(
            "paragraph_revision_started paragraph_id=%s action=%s model=%s revision=%s",
            request.paragraph.paragraphId,
            request.action,
            self.settings.openai_model,
            request.revision,
        )
        suggestion = self.client.suggest_revision(request, self.settings.openai_model)
        validate_revision_guardrails(request.paragraph.text, suggestion.revisedText)
        if request.action == "adjust_paragraph_length":
            revised_word_count = count_revision_words(suggestion.revisedText)
            target_word_count = request.targetWordCount
            if target_word_count is None:
                raise ParagraphRevisionTargetError("Missing target word count.")
            length_metadata = LengthAdjustmentMetadata(
                originalWordCount=original_word_count,
                targetWordCount=target_word_count,
                revisedWordCount=revised_word_count,
                withinTolerance=is_within_length_target_tolerance(revised_word_count, target_word_count),
            )
        if request.action == "improve_sentence_length":
            sentence_metadata = validate_sentence_length_revision(request.paragraph.text, suggestion.revisedText)
        return ParagraphRevisionResponse(
            documentId=request.documentId,
            sourceRevision=request.revision,
            requestId=request.requestId,
            paragraphId=request.paragraph.paragraphId,
            sourceContentHash=request.sourceContentHash,
            action=request.action,
            model=self.settings.openai_model,
            revisionVersion=PARAGRAPH_REVISION_VERSION,
            suggestion=suggestion,
            length=length_metadata,
            sentence=sentence_metadata,
        )


def build_paragraph_revision_prompt(request: ParagraphRevisionRequest) -> RevisionPromptPayload:
    language_instruction = {
        "German": "Write the revised paragraph and summary in German.",
        "de": "Write the revised paragraph and summary in German.",
    }.get(request.language, "Write the revised paragraph and summary in English.")

    action_instruction = ACTION_INSTRUCTIONS[request.action]
    action_label = ACTION_LABELS[request.action]
    length_instruction = build_length_adjustment_prompt_fragment(request)
    sentence_instruction = build_sentence_length_prompt_fragment(request)

    user_message = f"""
DOCUMENT LANGUAGE
{request.language}

LANGUAGE POLICY
{language_instruction}

REQUESTED ACTION
{action_label}

ACTION-SPECIFIC INSTRUCTIONS
{action_instruction}

LENGTH TARGET
{length_instruction}

SENTENCE STRUCTURE TARGET
{sentence_instruction}

NEAREST HEADING (CONTEXT ONLY)
{request.context.nearestHeading or "[none supplied]"}

PREVIOUS PROSE PARAGRAPH (CONTEXT ONLY)
{request.context.previousParagraph or "[none supplied]"}

TARGET PARAGRAPH
{request.paragraph.text}

NEXT PROSE PARAGRAPH (CONTEXT ONLY)
{request.context.nextParagraph or "[none supplied]"}

Return exactly one structured revision suggestion for the TARGET PARAGRAPH.
""".strip()

    return RevisionPromptPayload(
        system_instructions=PARAGRAPH_REVISION_INSTRUCTIONS,
        user_message=user_message,
    )


def validate_revision_guardrails(original_text: str, revised_text: str) -> None:
    if not revised_text.strip():
        raise ParagraphRevisionGuardrailError("Revision is empty.")
    try:
        ensure_analyzable_text(revised_text)
    except ParagraphAIInsufficientTextError as exc:
        raise ParagraphRevisionGuardrailError("Revision is too short.") from exc

    for label, pattern in PROTECTED_PATTERNS.items():
        original = protected_counter(pattern, original_text)
        revised = protected_counter(pattern, revised_text)
        if original != revised:
            raise ParagraphRevisionGuardrailError(f"Protected {label} changed.")


def count_revision_words(text: str) -> int:
    return len(re.findall(r"[\w]+(?:[-'][\w]+)*", text.strip(), flags=re.UNICODE))


def length_target_bounds(original_word_count: int) -> tuple[int, int]:
    minimum = max(MIN_LENGTH_ADJUSTMENT_WORDS, round(original_word_count * MIN_LENGTH_ADJUSTMENT_RATIO))
    maximum = max(minimum, round(original_word_count * MAX_LENGTH_ADJUSTMENT_RATIO))
    return minimum, maximum


def ensure_supported_length_target(original_word_count: int, target_word_count: int | None) -> None:
    if target_word_count is None:
        raise ParagraphRevisionTargetError("Missing target word count.")
    if original_word_count < MIN_LENGTH_ADJUSTMENT_WORDS:
        raise ParagraphRevisionTargetError("Paragraph is too short for length adjustment.")
    minimum, maximum = length_target_bounds(original_word_count)
    if target_word_count < minimum or target_word_count > maximum:
        raise ParagraphRevisionTargetError(
            f"Target {target_word_count} is outside supported range {minimum}-{maximum}."
        )
    if target_word_count == original_word_count:
        raise ParagraphRevisionTargetError("Target matches the current paragraph length.")


def length_tolerance_margin(target_word_count: int) -> int:
    return max(LENGTH_TARGET_TOLERANCE_MIN_WORDS, round(target_word_count * LENGTH_TARGET_TOLERANCE_PERCENT))


def is_within_length_target_tolerance(revised_word_count: int, target_word_count: int) -> bool:
    margin = length_tolerance_margin(target_word_count)
    return abs(revised_word_count - target_word_count) <= margin


def build_length_adjustment_prompt_fragment(request: ParagraphRevisionRequest) -> str:
    if request.action != "adjust_paragraph_length":
        return "[not applicable]"

    original_word_count = count_revision_words(request.paragraph.text)
    target_word_count = request.targetWordCount or 0
    direction = "shorten" if target_word_count < original_word_count else "lengthen"
    margin = length_tolerance_margin(target_word_count)
    minimum, maximum = length_target_bounds(original_word_count)

    return (
        f"Original word count: {original_word_count}. "
        f"Target word count: approximately {target_word_count} words. "
        f"Acceptable tolerance: plus or minus {margin} words. "
        f"Requested direction: {direction}. "
        f"Supported target range for this paragraph: {minimum}-{maximum} words. "
        "Do not claim exactness; produce the safest revision near the target while preserving meaning."
    )


def build_sentence_length_prompt_fragment(request: ParagraphRevisionRequest) -> str:
    if request.action != "improve_sentence_length":
        return "[not applicable]"

    original = sentence_length_metrics(request.paragraph.text)
    very_long = distribution_count(original, "Very long")
    long = distribution_count(original, "Long")
    return (
        f"Original sentence count: {original.sentence_count}. "
        f"Original average sentence length: {original.average_sentence_length:.1f} words. "
        f"Long sentences: {long}. Very long sentences: {very_long}. "
        "Make sentence structure more concise where useful, especially by splitting overloaded long sentences. "
        "Do not chase an ideal sentence length, do not fragment already clear prose, and do not optimize total paragraph word count."
    )


@dataclass(frozen=True)
class SentenceLengthMetrics:
    sentence_count: int
    average_sentence_length: float
    distribution: dict[str, int]
    word_count: int


def sentence_length_metrics(text: str) -> SentenceLengthMetrics:
    sentences = split_revision_sentences(text)
    sentence_word_counts = [count_revision_words(sentence) for sentence in sentences]
    distribution = {category: 0 for category in SENTENCE_CATEGORIES}
    for word_count in sentence_word_counts:
        distribution[categorize_revision_sentence(word_count)] += 1

    total_words = sum(sentence_word_counts)
    return SentenceLengthMetrics(
        sentence_count=len(sentence_word_counts),
        average_sentence_length=total_words / len(sentence_word_counts) if sentence_word_counts else 0,
        distribution=distribution,
        word_count=count_revision_words(text),
    )


def split_revision_sentences(text: str) -> list[str]:
    normalized = re.sub(r"\s+", " ", text.strip())
    if not normalized:
        return []

    protected = re.sub(r"(\d)\.(\d)", rf"\1{ABBREVIATION_DOT_PLACEHOLDER}\2", normalized)
    for abbreviation in COMMON_SENTENCE_ABBREVIATIONS:
        escaped = re.escape(abbreviation)
        protected = re.sub(
            escaped,
            lambda match: match.group(0).replace(".", ABBREVIATION_DOT_PLACEHOLDER),
            protected,
            flags=re.IGNORECASE,
        )

    matches = SENTENCE_PATTERN.findall(protected)
    return [
        sentence.replace(ABBREVIATION_DOT_PLACEHOLDER, ".").strip()
        for sentence in matches
        if count_revision_words(sentence.replace(ABBREVIATION_DOT_PLACEHOLDER, ".")) > 0
    ]


def categorize_revision_sentence(word_count: int) -> str:
    if word_count <= SENTENCE_SHORT_MAX_WORDS:
        return "Short"
    if word_count <= SENTENCE_MEDIUM_MAX_WORDS:
        return "Medium"
    if word_count <= SENTENCE_LONG_MAX_WORDS:
        return "Long"
    return "Very long"


def validate_sentence_length_revision(original_text: str, revised_text: str) -> SentenceLengthRevisionMetadata:
    original = sentence_length_metrics(original_text)
    revised = sentence_length_metrics(revised_text)

    if not has_sentence_structure_change(original, revised):
        raise ParagraphRevisionGuardrailError("Sentence structure did not change meaningfully.")
    if has_excessive_sentence_revision_word_drift(original.word_count, revised.word_count):
        raise ParagraphRevisionGuardrailError("Sentence revision changed paragraph length too much.")

    return SentenceLengthRevisionMetadata(
        originalSentenceCount=original.sentence_count,
        revisedSentenceCount=revised.sentence_count,
        originalAverageSentenceLength=round(original.average_sentence_length, 1),
        revisedAverageSentenceLength=round(revised.average_sentence_length, 1),
        originalDistribution=sentence_distribution_counts(original),
        revisedDistribution=sentence_distribution_counts(revised),
    )


def has_sentence_structure_change(original: SentenceLengthMetrics, revised: SentenceLengthMetrics) -> bool:
    original_long = distribution_count(original, "Long") + distribution_count(original, "Very long")
    revised_long = distribution_count(revised, "Long") + distribution_count(revised, "Very long")
    return (
        revised.average_sentence_length <= original.average_sentence_length - 1
        or revised_long < original_long
        or distribution_count(revised, "Very long") < distribution_count(original, "Very long")
        or (revised.sentence_count > original.sentence_count and revised.average_sentence_length < original.average_sentence_length)
    )


def has_excessive_sentence_revision_word_drift(original_word_count: int, revised_word_count: int) -> bool:
    allowed_drift = max(SENTENCE_REVISION_MIN_WORD_DRIFT, round(original_word_count * SENTENCE_REVISION_WORD_DRIFT_RATIO))
    return abs(revised_word_count - original_word_count) > allowed_drift


def sentence_distribution_counts(metrics: SentenceLengthMetrics) -> list[SentenceDistributionCount]:
    return [
        SentenceDistributionCount(
            category=category,
            count=metrics.distribution.get(category, 0),
            rangeLabel=SENTENCE_RANGE_LABELS[category],
        )
        for category in SENTENCE_CATEGORIES
    ]


def distribution_count(metrics: SentenceLengthMetrics, category: str) -> int:
    return metrics.distribution.get(category, 0)


def protected_counter(pattern: re.Pattern[str], text: str) -> Counter[str]:
    return Counter(match.strip() for match in pattern.findall(text))


def log_paragraph_revision_failure(stage: str, exc: Exception, model: str, settings: AppSettings) -> None:
    logger.warning(
        "paragraph_revision_failed stage=%s exception_class=%s upstream_status=%s "
        "openai_error_code=%s openai_error_type=%s message=%s model=%s api_key_configured=%s",
        stage,
        exception_class_name(exc),
        extract_upstream_status(exc),
        extract_openai_error_code(exc),
        extract_openai_error_type(exc),
        sanitize_error_message(exc),
        model,
        settings.ai_configured,
    )
