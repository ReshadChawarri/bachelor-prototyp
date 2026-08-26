from __future__ import annotations

import unittest

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import AppSettings
from app.document_ai_analysis import (
    DOCUMENT_ANALYSIS_INSTRUCTIONS,
    DOCUMENT_ANALYSIS_VERSION,
    DocumentAIAnalysis,
    DocumentAIAnalysisService,
    DocumentAITooLargeError,
    DocumentAnalysisRequest,
    DocumentAnalysisResponse,
    OpenAIResponsesDocumentClient,
    build_document_analysis_prompt,
    document_analysis_cache_key,
    prepare_document_analysis_request,
    validate_document_ai_analysis,
)
from app.main import app
from app.paragraph_ai_analysis import (
    ParagraphAIConfigurationError,
    ParagraphAIInvalidResponseError,
    ParagraphAIUpstreamError,
)


def block(block_id: str, text: str, order: int, **overrides) -> dict:
    payload = {
        "type": "paragraph",
        "blockType": "paragraph",
        "paragraphId": block_id,
        "order": order,
        "text": text,
    }
    payload.update(overrides)
    return payload


def request_payload(**overrides) -> dict:
    payload = {
        "documentId": "local-draft",
        "revision": 22,
        "requestId": "doc-ai-22-1",
        "language": "English",
        "blocks": [
            block("h-1", "1 Introduction", 0, type="heading", blockType="heading", nodeId="h-1", headingLevel=1),
            block("p-1", "Privacy concerns shape the background of this academic argument.", 1),
            block("p-2", "The method compares student reflections across two writing sessions.", 2),
            block("cap-1", "Figure 1: Imported document overview.", 3, blockType="caption"),
            block("meta-1", "LMU Munich", 4, blockType="metadata"),
        ],
    }
    payload.update(overrides)
    return payload


def valid_document_analysis() -> DocumentAIAnalysis:
    return DocumentAIAnalysis(
        paragraphRoles=[
            {"paragraphId": "p-1", "role": "background_context", "rationale": "Introduces the document context."},
            {"paragraphId": "p-2", "role": "method_procedure", "rationale": "Describes the comparison procedure."},
        ],
        rhetoricalMoves=[
            {"label": "background", "count": 1, "paragraphIds": ["p-1"]},
            {"label": "method", "count": 1, "paragraphIds": ["p-2"]},
        ],
        coherence={
            "level": "moderate",
            "rationale": "The document progresses from background to method with limited section context.",
        },
        academicTone={
            "level": "strong",
            "rationale": "The wording is formal and discipline-neutral.",
        },
        observation="The document establishes context and method in a compact structure.",
    )


class FakeDocumentAIService:
    def __init__(self):
        self.requests: list[DocumentAnalysisRequest] = []

    def analyze(self, request: DocumentAnalysisRequest) -> DocumentAnalysisResponse:
        self.requests.append(request)
        return DocumentAnalysisResponse(
            documentId=request.documentId,
            revision=request.revision,
            requestId=request.requestId,
            model="gpt-5.6-luna",
            analysisVersion=DOCUMENT_ANALYSIS_VERSION,
            analyzedParagraphCount=2,
            analysis=valid_document_analysis(),
        )


class FakeResponses:
    def __init__(self, parsed):
        self.parsed = parsed
        self.calls: list[dict] = []

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        return type("FakeResponse", (), {"output_parsed": self.parsed, "usage": {"total_tokens": 99}})()


class FakeOpenAIClient:
    def __init__(self, parsed):
        self.responses = FakeResponses(parsed)


class FakeOpenAIUpstreamError(Exception):
    status_code = 429
    code = "rate_limit_exceeded"
    type = "rate_limit_error"


class FakeFailingResponses:
    def parse(self, **kwargs):
        raise FakeOpenAIUpstreamError("Rate limit while using sk-proj-test-secret")


class FakeFailingOpenAIClient:
    def __init__(self):
        self.responses = FakeFailingResponses()


class DocumentAIAnalysisEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def tearDown(self) -> None:
        if hasattr(app.state, "document_ai_analysis_service"):
            delattr(app.state, "document_ai_analysis_service")

    def test_valid_document_request_returns_structured_response(self):
        fake_service = FakeDocumentAIService()
        app.state.document_ai_analysis_service = fake_service

        response = self.client.post("/api/ai/analyze-document", json=request_payload())

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["documentId"], "local-draft")
        self.assertEqual(body["revision"], 22)
        self.assertEqual(body["requestId"], "doc-ai-22-1")
        self.assertEqual(body["analysisVersion"], "document-v1")
        self.assertEqual(body["analyzedParagraphCount"], 2)
        self.assertEqual(body["analysis"]["paragraphRoles"][0]["paragraphId"], "p-1")
        self.assertEqual(fake_service.requests[0].blocks[0].nodeId, "h-1")

    def test_missing_api_key_returns_controlled_configuration_error(self):
        service = DocumentAIAnalysisService(settings=AppSettings(openai_api_key=None, openai_model="gpt-5.6-luna"))

        with self.assertRaises(ParagraphAIConfigurationError):
            service.analyze(DocumentAnalysisRequest.model_validate(request_payload()))


class DocumentAIAnalysisServiceTests(unittest.TestCase):
    def test_prepared_request_includes_headings_and_prose_but_excludes_non_prose(self):
        request = DocumentAnalysisRequest.model_validate(request_payload())

        prepared = prepare_document_analysis_request(request)
        prompt = build_document_analysis_prompt(prepared)

        self.assertEqual([block.type for block in prepared.blocks], ["heading", "paragraph", "paragraph"])
        self.assertIn("[HEADING nodeId=h-1 level=1] 1 Introduction", prompt.user_message)
        self.assertIn("[PARAGRAPH P1 paragraphId=p-1]", prompt.user_message)
        self.assertIn("[PARAGRAPH P2 paragraphId=p-2]", prompt.user_message)
        self.assertNotIn("Figure 1", prompt.user_message)
        self.assertNotIn("LMU Munich", prompt.user_message)
        self.assertIn("Do not rewrite the document", DOCUMENT_ANALYSIS_INSTRUCTIONS)

    def test_configured_model_and_structured_schema_are_used(self):
        request = DocumentAnalysisRequest.model_validate(request_payload())
        fake_raw_client = FakeOpenAIClient(valid_document_analysis())
        client = OpenAIResponsesDocumentClient(
            settings=AppSettings(openai_api_key="sk-test", openai_model="gpt-custom"),
            raw_client=fake_raw_client,
        )
        service = DocumentAIAnalysisService(
            settings=AppSettings(openai_api_key="sk-test", openai_model="gpt-custom"),
            client=client,
        )

        response = service.analyze(request)

        self.assertEqual(response.model, "gpt-custom")
        self.assertEqual(response.analysisVersion, "document-v1")
        self.assertIs(fake_raw_client.responses.calls[0]["text_format"], DocumentAIAnalysis)

    def test_invalid_role_enum_is_rejected(self):
        data = valid_document_analysis().model_dump()
        data["paragraphRoles"][0]["role"] = "quality_score"

        with self.assertRaises(ValidationError):
            DocumentAIAnalysis.model_validate(data)

    def test_invalid_move_enum_is_rejected(self):
        data = valid_document_analysis().model_dump()
        data["rhetoricalMoves"][0]["label"] = "grammar"

        with self.assertRaises(ValidationError):
            DocumentAIAnalysis.model_validate(data)

    def test_malformed_coherence_or_tone_is_rejected(self):
        data = valid_document_analysis().model_dump()
        data["coherence"]["level"] = "8/10"

        with self.assertRaises(ValidationError):
            DocumentAIAnalysis.model_validate(data)

        data = valid_document_analysis().model_dump()
        data["academicTone"]["level"] = "insufficient_context"
        with self.assertRaises(ValidationError):
            DocumentAIAnalysis.model_validate(data)

    def test_missing_or_unknown_paragraph_ids_are_rejected(self):
        analysis = DocumentAIAnalysis.model_validate(
            {
                **valid_document_analysis().model_dump(),
                "paragraphRoles": [
                    {"paragraphId": "p-1", "role": "background_context"},
                    {"paragraphId": "p-unknown", "role": "method_procedure"},
                ],
            }
        )

        with self.assertRaises(ParagraphAIInvalidResponseError):
            validate_document_ai_analysis(analysis, ["p-1", "p-2"])

    def test_duplicate_paragraph_roles_are_rejected(self):
        analysis = DocumentAIAnalysis.model_validate(
            {
                **valid_document_analysis().model_dump(),
                "paragraphRoles": [
                    {"paragraphId": "p-1", "role": "background_context"},
                    {"paragraphId": "p-1", "role": "method_procedure"},
                ],
            }
        )

        with self.assertRaises(ParagraphAIInvalidResponseError):
            validate_document_ai_analysis(analysis, ["p-1", "p-2"])

    def test_move_distribution_count_semantics_are_paragraph_frequency(self):
        with self.assertRaises(ValidationError):
            DocumentAIAnalysis.model_validate(
                {
                    **valid_document_analysis().model_dump(),
                    "rhetoricalMoves": [
                        {"label": "claim", "count": 2, "paragraphIds": ["p-1"]},
                    ],
                }
            )

        with self.assertRaises(ValidationError):
            DocumentAIAnalysis.model_validate(
                {
                    **valid_document_analysis().model_dump(),
                    "rhetoricalMoves": [
                        {"label": "claim", "count": 2, "paragraphIds": ["p-1", "p-1"]},
                    ],
                }
            )

    def test_duplicate_move_labels_are_rejected(self):
        analysis = DocumentAIAnalysis.model_validate(
            {
                **valid_document_analysis().model_dump(),
                "rhetoricalMoves": [
                    {"label": "claim", "count": 1, "paragraphIds": ["p-1"]},
                    {"label": "claim", "count": 1, "paragraphIds": ["p-2"]},
                ],
            }
        )

        with self.assertRaises(ParagraphAIInvalidResponseError):
            validate_document_ai_analysis(analysis, ["p-1", "p-2"])

    def test_document_cache_key_reuses_same_content_and_changes_after_edit(self):
        request = DocumentAnalysisRequest.model_validate(request_payload())
        same_request = DocumentAnalysisRequest.model_validate(request_payload(requestId="doc-ai-22-2"))
        edited_request = DocumentAnalysisRequest.model_validate(
            request_payload(blocks=[*request_payload()["blocks"][:2], block("p-2", "Edited method paragraph.", 2)])
        )

        self.assertEqual(document_analysis_cache_key(request, "gpt-5.6-luna"), document_analysis_cache_key(same_request, "gpt-5.6-luna"))
        self.assertNotEqual(document_analysis_cache_key(request, "gpt-5.6-luna"), document_analysis_cache_key(edited_request, "gpt-5.6-luna"))

    def test_oversized_document_returns_controlled_error(self):
        long_text = "word " * 25000
        request = DocumentAnalysisRequest.model_validate(
            request_payload(blocks=[block("p-long", long_text, 0)])
        )

        with self.assertRaises(DocumentAITooLargeError):
            DocumentAIAnalysisService(
                settings=AppSettings(openai_api_key="sk-test", openai_model="gpt-5.6-luna"),
                client=OpenAIResponsesDocumentClient(
                    settings=AppSettings(openai_api_key="sk-test", openai_model="gpt-5.6-luna"),
                    raw_client=FakeOpenAIClient(valid_document_analysis()),
                ),
            ).analyze(request)

    def test_upstream_failure_logs_safe_diagnostic_details(self):
        request = DocumentAnalysisRequest.model_validate(request_payload())
        client = OpenAIResponsesDocumentClient(
            settings=AppSettings(openai_api_key="sk-test", openai_model="gpt-5.6-luna"),
            raw_client=FakeFailingOpenAIClient(),
        )

        with self.assertLogs("app.paragraph_ai_analysis", level="WARNING") as captured:
            with self.assertRaises(ParagraphAIUpstreamError):
                client.analyze(request, "gpt-5.6-luna")

        output = "\n".join(captured.output)
        self.assertIn("stage=document_responses_api_request", output)
        self.assertIn("upstream_status=429", output)
        self.assertIn("openai_error_code=rate_limit_exceeded", output)
        self.assertIn("openai_error_type=rate_limit_error", output)
        self.assertNotIn("sk-proj", output)


if __name__ == "__main__":
    unittest.main()
