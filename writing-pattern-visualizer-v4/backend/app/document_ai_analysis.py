from __future__ import annotations

from dataclasses import dataclass
import hashlib
import logging
import re
import time
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from .config import AppSettings, get_settings
from .document_analytics import normalize_heading_level, normalize_language
from .paragraph_ai_analysis import (
    AcademicToneLevel,
    CoherenceLevel,
    ParagraphAIAnalysisError,
    ParagraphAIConfigurationError,
    ParagraphAIInvalidResponseError,
    ParagraphAIUpstreamError,
    ParagraphRoleLabel,
    RhetoricalMoveLabel,
    log_paragraph_ai_failure,
    meaningful_word_count,
)


logger = logging.getLogger(__name__)

DOCUMENT_ANALYSIS_VERSION = "document-v1"
MAX_DOCUMENT_AI_INPUT_CHARS = 24000
MAX_DOCUMENT_AI_PARAGRAPHS = 80

DocumentAIBlockType = Literal["heading", "paragraph"]
Language = Literal["English", "German", "en", "de"]

DOCUMENT_ANALYSIS_INSTRUCTIONS = """
You are analyzing academic writing for an HCI writing-pattern visualization prototype.

Analyze only the supplied DOCUMENT BLOCKS.
Do not rewrite the document.
Do not invent information, evidence, citations, references, statistics, sources, or factual claims.
Do not infer references or verify citations unless source content is supplied.
Do not grade the student and do not assign numeric writing quality scores.
Use uncertainty when evidence is insufficient.
Paragraph roles must refer only to supplied paragraph IDs.
Never create new paragraph IDs.
Rhetorical move counts mean the number of analyzed paragraphs in which a move occurs.
Keep rationales concise and grounded in observable document-level patterns.
Use the required structured schema.
""".strip()


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DocumentAnalysisBlock(StrictModel):
    type: DocumentAIBlockType
    text: str = ""
    order: int = 0
    nodeId: str | None = None
    paragraphId: str | None = None
    headingLevel: int | None = None
    displayIndex: int | None = None
    blockType: str | None = None


class DocumentAnalysisRequest(StrictModel):
    documentId: str = Field(min_length=1)
    revision: int = Field(ge=0)
    requestId: str = Field(min_length=1)
    language: Language = "English"
    blocks: list[DocumentAnalysisBlock] = Field(default_factory=list)


class DocumentParagraphRole(StrictModel):
    paragraphId: str = Field(min_length=1)
    role: ParagraphRoleLabel
    rationale: str | None = Field(default=None, max_length=220)


class RhetoricalMoveDistribution(StrictModel):
    label: RhetoricalMoveLabel
    count: int = Field(ge=0)
    paragraphIds: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def count_matches_unique_paragraphs(self):
        unique_ids = list(dict.fromkeys(self.paragraphIds))
        if len(unique_ids) != len(self.paragraphIds):
            raise ValueError("paragraphIds must not contain duplicates")
        if self.count != len(unique_ids):
            raise ValueError("count must equal the number of unique paragraphIds")
        return self


class DocumentCoherenceAssessment(StrictModel):
    level: CoherenceLevel
    rationale: str = Field(min_length=1, max_length=620)


class DocumentToneAssessment(StrictModel):
    level: AcademicToneLevel
    rationale: str = Field(min_length=1, max_length=620)


class DocumentAIAnalysis(StrictModel):
    paragraphRoles: list[DocumentParagraphRole] = Field(default_factory=list)
    rhetoricalMoves: list[RhetoricalMoveDistribution] = Field(default_factory=list)
    coherence: DocumentCoherenceAssessment
    academicTone: DocumentToneAssessment
    observation: str = Field(min_length=1, max_length=720)


class DocumentAnalysisResponse(StrictModel):
    documentId: str
    revision: int
    requestId: str
    model: str
    analysisVersion: str
    analyzedParagraphCount: int
    analysis: DocumentAIAnalysis


class DocumentAITooLargeError(ParagraphAIAnalysisError):
    user_message = "This document is too large for full AI analysis. Analyze a shorter document or reduce the content."
    status_code = 413


class DocumentAIInsufficientTextError(ParagraphAIAnalysisError):
    user_message = "Add prose text to analyze this document."
    status_code = 422


@dataclass(frozen=True)
class DocumentPromptPayload:
    system_instructions: str
    user_message: str


class DocumentAIClient(Protocol):
    def analyze(self, request: DocumentAnalysisRequest, model: str) -> DocumentAIAnalysis:
        ...


class OpenAIResponsesDocumentClient:
    def __init__(self, settings: AppSettings | None = None, raw_client: object | None = None):
        self.settings = settings or get_settings()
        self.raw_client = raw_client

    def analyze(self, request: DocumentAnalysisRequest, model: str) -> DocumentAIAnalysis:
        prompt = build_document_analysis_prompt(request)
        started_at = time.perf_counter()
        try:
            client = self.raw_client or self._openai_client()
        except ParagraphAIConfigurationError as exc:
            log_paragraph_ai_failure("document_client_initialization", exc, model, self.settings)
            raise
        except Exception as exc:  # pragma: no cover - defensive guard for SDK initialization details.
            log_paragraph_ai_failure("document_client_initialization", exc, model, self.settings)
            raise ParagraphAIUpstreamError() from exc

        try:
            response = client.responses.parse(
                model=model,
                input=[
                    {"role": "system", "content": prompt.system_instructions},
                    {"role": "user", "content": prompt.user_message},
                ],
                text_format=DocumentAIAnalysis,
            )
        except ValidationError as exc:
            log_paragraph_ai_failure("document_structured_outputs_parse", exc, model, self.settings)
            raise ParagraphAIInvalidResponseError() from exc
        except Exception as exc:  # pragma: no cover - concrete SDK errors vary by installed version.
            log_paragraph_ai_failure("document_responses_api_request", exc, model, self.settings)
            raise ParagraphAIUpstreamError() from exc

        parsed = getattr(response, "output_parsed", None)
        try:
            analysis = parsed if isinstance(parsed, DocumentAIAnalysis) else DocumentAIAnalysis.model_validate(parsed)
        except ValidationError as exc:
            log_paragraph_ai_failure("document_application_response_validation", exc, model, self.settings)
            raise ParagraphAIInvalidResponseError() from exc

        usage = getattr(response, "usage", None)
        logger.info(
            "document_ai_analysis_succeeded model=%s revision=%s latency_ms=%d usage=%s",
            model,
            request.revision,
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


class DocumentAIAnalysisService:
    def __init__(self, settings: AppSettings | None = None, client: DocumentAIClient | None = None):
        self.settings = settings or get_settings()
        self.client = client or OpenAIResponsesDocumentClient(self.settings)

    def analyze(self, request: DocumentAnalysisRequest) -> DocumentAnalysisResponse:
        prepared_request = prepare_document_analysis_request(request)
        prose_paragraph_ids = prose_paragraph_ids_for_request(prepared_request)
        if not prose_paragraph_ids:
            raise DocumentAIInsufficientTextError()

        logger.info(
            "document_ai_analysis_started model=%s revision=%s paragraphs=%d",
            self.settings.openai_model,
            prepared_request.revision,
            len(prose_paragraph_ids),
        )
        analysis = self.client.analyze(prepared_request, self.settings.openai_model)
        validate_document_ai_analysis(analysis, prose_paragraph_ids)
        return DocumentAnalysisResponse(
            documentId=prepared_request.documentId,
            revision=prepared_request.revision,
            requestId=prepared_request.requestId,
            model=self.settings.openai_model,
            analysisVersion=DOCUMENT_ANALYSIS_VERSION,
            analyzedParagraphCount=len(prose_paragraph_ids),
            analysis=analysis,
        )


def prepare_document_analysis_request(request: DocumentAnalysisRequest) -> DocumentAnalysisRequest:
    blocks = relevant_document_blocks(request.blocks)
    prepared = request.model_copy(update={"blocks": blocks})
    ensure_document_within_budget(prepared)
    return prepared


def relevant_document_blocks(blocks: list[DocumentAnalysisBlock]) -> list[DocumentAnalysisBlock]:
    relevant_blocks: list[DocumentAnalysisBlock] = []
    display_index = 0
    for order, block in enumerate(sorted(blocks, key=lambda item: item.order)):
        text = normalize_text(block.text)
        if not text:
            continue

        if is_heading_block(block):
            relevant_blocks.append(
                block.model_copy(
                    update={
                        "type": "heading",
                        "text": text,
                        "order": order,
                        "nodeId": block.nodeId or block.paragraphId,
                        "headingLevel": normalize_heading_level(block.headingLevel),
                    }
                )
            )
            continue

        if is_prose_block(block) and block.paragraphId:
            display_index += 1
            relevant_blocks.append(
                block.model_copy(
                    update={
                        "type": "paragraph",
                        "text": text,
                        "order": order,
                        "paragraphId": block.paragraphId,
                        "displayIndex": block.displayIndex or display_index,
                    }
                )
            )

    return relevant_blocks


def is_heading_block(block: DocumentAnalysisBlock) -> bool:
    return block.type == "heading" or block.blockType == "heading"


def is_prose_block(block: DocumentAnalysisBlock) -> bool:
    return block.type == "paragraph" and (block.blockType in (None, "paragraph"))


def prose_paragraph_ids_for_request(request: DocumentAnalysisRequest) -> list[str]:
    ids: list[str] = []
    for block in request.blocks:
        if block.type == "paragraph" and block.paragraphId:
            ids.append(block.paragraphId)
    return ids


def ensure_document_within_budget(request: DocumentAnalysisRequest) -> None:
    prose_count = len(prose_paragraph_ids_for_request(request))
    if prose_count > MAX_DOCUMENT_AI_PARAGRAPHS:
        raise DocumentAITooLargeError()

    if document_input_character_count(request.blocks) > MAX_DOCUMENT_AI_INPUT_CHARS:
        raise DocumentAITooLargeError()


def document_input_character_count(blocks: list[DocumentAnalysisBlock]) -> int:
    return sum(len(block.text) for block in blocks)


def validate_document_ai_analysis(analysis: DocumentAIAnalysis, expected_paragraph_ids: list[str]) -> None:
    expected_ids = set(expected_paragraph_ids)
    role_ids = [role.paragraphId for role in analysis.paragraphRoles]
    if len(role_ids) != len(set(role_ids)):
        raise ParagraphAIInvalidResponseError("Document analysis returned duplicate paragraph role IDs.")
    if set(role_ids) != expected_ids:
        raise ParagraphAIInvalidResponseError("Document analysis returned missing or unknown paragraph role IDs.")

    for move in analysis.rhetoricalMoves:
        if not set(move.paragraphIds).issubset(expected_ids):
            raise ParagraphAIInvalidResponseError("Document analysis returned an unknown paragraph ID for a move.")
    move_labels = [move.label for move in analysis.rhetoricalMoves]
    if len(move_labels) != len(set(move_labels)):
        raise ParagraphAIInvalidResponseError("Document analysis returned duplicate rhetorical move labels.")


def build_document_analysis_prompt(request: DocumentAnalysisRequest) -> DocumentPromptPayload:
    language = normalize_language(request.language)
    language_instruction = {
        "German": "Write rationales and the observation in German.",
    }.get(language, "Write rationales and the observation in English.")

    block_lines = [format_document_block(block) for block in request.blocks]
    user_message = f"""
DOCUMENT LANGUAGE
{language}

LANGUAGE POLICY
{language_instruction}

COUNTING SEMANTICS
For rhetoricalMoves, count means the number of analyzed prose paragraphs in which that move occurs.
Each move's paragraphIds list must contain each contributing paragraph ID once.

DOCUMENT BLOCKS
{chr(10).join(block_lines)}

Return exactly one structured analysis for the supplied document.
Return one paragraph role for every supplied prose paragraph ID and do not create new IDs.
""".strip()

    return DocumentPromptPayload(
        system_instructions=DOCUMENT_ANALYSIS_INSTRUCTIONS,
        user_message=user_message,
    )


def format_document_block(block: DocumentAnalysisBlock) -> str:
    if block.type == "heading":
        node_id = block.nodeId or "unknown-heading"
        return f"[HEADING nodeId={node_id} level={block.headingLevel or 1}] {block.text}"

    paragraph_id = block.paragraphId or "unknown-paragraph"
    display_label = f"P{block.displayIndex}" if block.displayIndex else "P?"
    return f"[PARAGRAPH {display_label} paragraphId={paragraph_id}] {block.text}"


def document_analysis_cache_key(request: DocumentAnalysisRequest, model: str) -> str:
    payload = "\n".join(
        [
            model,
            DOCUMENT_ANALYSIS_VERSION,
            normalize_language(request.language),
            *[
                f"{block.type}:{block.nodeId or ''}:{block.paragraphId or ''}:{block.headingLevel or ''}:"
                f"{block.displayIndex or ''}:{block.text}"
                for block in relevant_document_blocks(request.blocks)
            ],
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()
