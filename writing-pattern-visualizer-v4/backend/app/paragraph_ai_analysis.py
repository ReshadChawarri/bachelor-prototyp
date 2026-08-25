from __future__ import annotations

from dataclasses import dataclass
import hashlib
import logging
import re
import time
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .config import AppSettings, get_settings


logger = logging.getLogger(__name__)

PARAGRAPH_ANALYSIS_VERSION = "paragraph-v1"
MIN_ANALYZABLE_WORDS = 4
SECRET_PATTERN = re.compile(r"\bsk-[A-Za-z0-9_-]*")

ParagraphRoleLabel = Literal[
    "background_context",
    "purpose_aim",
    "claim_argument",
    "evidence_example",
    "method_procedure",
    "result_finding",
    "interpretation_discussion",
    "limitation",
    "transition",
    "conclusion",
    "other",
    "uncertain",
]

RhetoricalMoveLabel = Literal[
    "background",
    "problem",
    "purpose",
    "claim",
    "support",
    "example",
    "contrast",
    "method",
    "result",
    "interpretation",
    "limitation",
    "implication",
    "transition",
    "conclusion",
]

CoherenceLevel = Literal["strong", "moderate", "needs_attention", "insufficient_context"]
AcademicToneLevel = Literal["strong", "moderate", "needs_attention", "insufficient_text"]
Language = Literal["English", "German", "en", "de"]

WORD_PATTERN = re.compile(r"[\w]+(?:[-'][\w]+)*", flags=re.UNICODE)

PARAGRAPH_ANALYSIS_INSTRUCTIONS = """
You are analyzing academic writing for an HCI writing-pattern visualization prototype.

Analyze only the TARGET PARAGRAPH.
Adjacent paragraphs and headings are CONTEXT ONLY.

Do not rewrite the text.
Do not invent information, evidence, citations, references, statistics, sources, or factual claims.
Do not silently correct factual claims.
Do not assess whether cited sources support claims unless the source content is supplied.
Do not claim certainty about author intent.
Use uncertainty when evidence is insufficient.
Keep rationales concise and grounded in observable textual characteristics.
Use the required structured schema.
""".strip()


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SelectedParagraph(StrictModel):
    paragraphId: str = Field(min_length=1)
    text: str = ""


class ParagraphContext(StrictModel):
    nearestHeading: str | None = None
    previousParagraph: str | None = None
    nextParagraph: str | None = None


class ParagraphAnalysisRequest(StrictModel):
    documentId: str = Field(min_length=1)
    revision: int = Field(ge=0)
    requestId: str = Field(min_length=1)
    language: Language = "English"
    paragraph: SelectedParagraph
    context: ParagraphContext = Field(default_factory=ParagraphContext)


class ParagraphRole(StrictModel):
    label: ParagraphRoleLabel
    rationale: str = Field(min_length=1, max_length=360)


class RhetoricalMove(StrictModel):
    label: RhetoricalMoveLabel
    rationale: str = Field(min_length=1, max_length=300)


class QualitativeCoherenceAssessment(StrictModel):
    level: CoherenceLevel
    rationale: str = Field(min_length=1, max_length=420)


class QualitativeToneAssessment(StrictModel):
    level: AcademicToneLevel
    rationale: str = Field(min_length=1, max_length=420)


class ParagraphAIAnalysis(StrictModel):
    paragraphRole: ParagraphRole
    rhetoricalMoves: list[RhetoricalMove] = Field(default_factory=list, max_length=5)
    coherence: QualitativeCoherenceAssessment
    academicTone: QualitativeToneAssessment
    observation: str = Field(min_length=1, max_length=520)


class ParagraphAnalysisResponse(StrictModel):
    documentId: str
    revision: int
    requestId: str
    paragraphId: str
    model: str
    analysisVersion: str
    analysis: ParagraphAIAnalysis


@dataclass(frozen=True)
class AnalysisPromptPayload:
    system_instructions: str
    user_message: str


class ParagraphAIClient(Protocol):
    def analyze(self, request: ParagraphAnalysisRequest, model: str) -> ParagraphAIAnalysis:
        ...


class ParagraphAIAnalysisError(Exception):
    user_message = "AI analysis is temporarily unavailable."
    status_code = 503

    def __init__(self, message: str | None = None):
        super().__init__(message or self.user_message)


class ParagraphAIConfigurationError(ParagraphAIAnalysisError):
    user_message = "AI analysis is not configured."
    status_code = 503


class ParagraphAIInvalidResponseError(ParagraphAIAnalysisError):
    user_message = "AI analysis returned an invalid structured response."
    status_code = 502


class ParagraphAIInsufficientTextError(ParagraphAIAnalysisError):
    user_message = "Add more text to analyze this paragraph."
    status_code = 422


class ParagraphAIUpstreamError(ParagraphAIAnalysisError):
    user_message = "AI analysis is temporarily unavailable."
    status_code = 503


class OpenAIResponsesParagraphClient:
    def __init__(self, settings: AppSettings | None = None, raw_client: object | None = None):
        self.settings = settings or get_settings()
        self.raw_client = raw_client

    def analyze(self, request: ParagraphAnalysisRequest, model: str) -> ParagraphAIAnalysis:
        prompt = build_paragraph_analysis_prompt(request)
        started_at = time.perf_counter()
        try:
            client = self.raw_client or self._openai_client()
        except ParagraphAIConfigurationError as exc:
            log_paragraph_ai_failure("client_initialization", exc, model, self.settings)
            raise
        except Exception as exc:  # pragma: no cover - defensive guard for SDK initialization details.
            log_paragraph_ai_failure("client_initialization", exc, model, self.settings)
            raise ParagraphAIUpstreamError() from exc

        try:
            response = client.responses.parse(
                model=model,
                input=[
                    {"role": "system", "content": prompt.system_instructions},
                    {"role": "user", "content": prompt.user_message},
                ],
                text_format=ParagraphAIAnalysis,
            )
        except ValidationError as exc:
            log_paragraph_ai_failure("structured_outputs_parse", exc, model, self.settings)
            raise ParagraphAIInvalidResponseError() from exc
        except Exception as exc:  # pragma: no cover - concrete SDK errors vary by installed version.
            log_paragraph_ai_failure("responses_api_request", exc, model, self.settings)
            raise ParagraphAIUpstreamError() from exc

        parsed = getattr(response, "output_parsed", None)
        try:
            analysis = parsed if isinstance(parsed, ParagraphAIAnalysis) else ParagraphAIAnalysis.model_validate(parsed)
        except ValidationError as exc:
            log_paragraph_ai_failure("application_response_validation", exc, model, self.settings)
            raise ParagraphAIInvalidResponseError() from exc

        usage = getattr(response, "usage", None)
        logger.info(
            "paragraph_ai_analysis_succeeded paragraph_id=%s model=%s latency_ms=%d usage=%s",
            request.paragraph.paragraphId,
            model,
            round((time.perf_counter() - started_at) * 1000),
            usage,
        )
        return analysis

    def _openai_client(self):
        if not self.settings.openai_api_key:
            raise ParagraphAIConfigurationError()
        try:
            from openai import OpenAI
        except ImportError as exc:  # pragma: no cover - dependency presence is checked by packaging.
            raise ParagraphAIConfigurationError("OpenAI SDK is not installed.") from exc

        return OpenAI(api_key=self.settings.openai_api_key)


def log_paragraph_ai_failure(stage: str, exc: Exception, model: str, settings: AppSettings) -> None:
    logger.warning(
        "paragraph_ai_analysis_failed stage=%s exception_class=%s upstream_status=%s "
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


def exception_class_name(exc: Exception) -> str:
    return f"{exc.__class__.__module__}.{exc.__class__.__name__}"


def extract_upstream_status(exc: Exception) -> object:
    status = getattr(exc, "status_code", None)
    if status is not None:
        return status

    response = getattr(exc, "response", None)
    return getattr(response, "status_code", None)


def extract_openai_error_code(exc: Exception) -> object:
    code = getattr(exc, "code", None)
    if code is not None:
        return code

    return extract_openai_error_field(exc, "code")


def extract_openai_error_type(exc: Exception) -> object:
    error_type = getattr(exc, "type", None)
    if error_type is not None:
        return error_type

    return extract_openai_error_field(exc, "type")


def extract_openai_error_field(exc: Exception, field: str) -> object:
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        error = body.get("error", body)
        if isinstance(error, dict):
            return error.get(field)

    response = getattr(exc, "response", None)
    try:
        payload = response.json() if response is not None else None
    except Exception:  # pragma: no cover - defensive only for non-JSON upstream responses.
        return None

    if isinstance(payload, dict):
        error = payload.get("error", payload)
        if isinstance(error, dict):
            return error.get(field)
    return None


def sanitize_error_message(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        return f"{exc.error_count()} structured validation error(s)."

    message = str(exc).replace("\n", " ").strip()
    message = SECRET_PATTERN.sub("[redacted-api-key]", message)
    return message[:600]


class ParagraphAIAnalysisService:
    def __init__(self, settings: AppSettings | None = None, client: ParagraphAIClient | None = None):
        self.settings = settings or get_settings()
        self.client = client or OpenAIResponsesParagraphClient(self.settings)

    def analyze(self, request: ParagraphAnalysisRequest) -> ParagraphAnalysisResponse:
        ensure_analyzable_text(request.paragraph.text)
        logger.info(
            "paragraph_ai_analysis_started paragraph_id=%s model=%s revision=%s",
            request.paragraph.paragraphId,
            self.settings.openai_model,
            request.revision,
        )
        analysis = self.client.analyze(request, self.settings.openai_model)
        return ParagraphAnalysisResponse(
            documentId=request.documentId,
            revision=request.revision,
            requestId=request.requestId,
            paragraphId=request.paragraph.paragraphId,
            model=self.settings.openai_model,
            analysisVersion=PARAGRAPH_ANALYSIS_VERSION,
            analysis=analysis,
        )


def ensure_analyzable_text(text: str) -> None:
    if meaningful_word_count(text) < MIN_ANALYZABLE_WORDS:
        raise ParagraphAIInsufficientTextError()


def meaningful_word_count(text: str) -> int:
    return len(WORD_PATTERN.findall(text.strip()))


def analysis_cache_key(request: ParagraphAnalysisRequest, model: str) -> str:
    payload = "\n".join(
        [
            model,
            PARAGRAPH_ANALYSIS_VERSION,
            request.language,
            request.paragraph.paragraphId,
            request.paragraph.text,
            request.context.nearestHeading or "",
            request.context.previousParagraph or "",
            request.context.nextParagraph or "",
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_paragraph_analysis_prompt(request: ParagraphAnalysisRequest) -> AnalysisPromptPayload:
    language_instruction = {
        "German": "Write rationales and the observation in German.",
        "de": "Write rationales and the observation in German.",
    }.get(request.language, "Write rationales and the observation in English.")

    user_message = f"""
DOCUMENT LANGUAGE
{request.language}

LANGUAGE POLICY
{language_instruction}

NEAREST HEADING (CONTEXT ONLY)
{request.context.nearestHeading or "[none supplied]"}

PREVIOUS PROSE PARAGRAPH (CONTEXT ONLY)
{request.context.previousParagraph or "[none supplied]"}

TARGET PARAGRAPH
{request.paragraph.text}

NEXT PROSE PARAGRAPH (CONTEXT ONLY)
{request.context.nextParagraph or "[none supplied]"}

Return exactly one structured analysis for the TARGET PARAGRAPH.
""".strip()

    return AnalysisPromptPayload(
        system_instructions=PARAGRAPH_ANALYSIS_INSTRUCTIONS,
        user_message=user_message,
    )
