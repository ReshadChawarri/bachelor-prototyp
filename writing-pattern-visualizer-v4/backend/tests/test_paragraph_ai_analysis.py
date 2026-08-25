from __future__ import annotations

import os
import unittest

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import AppSettings
from app.main import app
from app.paragraph_ai_analysis import (
    OpenAIResponsesParagraphClient,
    PARAGRAPH_ANALYSIS_INSTRUCTIONS,
    PARAGRAPH_ANALYSIS_VERSION,
    ParagraphAIAnalysis,
    ParagraphAIAnalysisService,
    ParagraphAIConfigurationError,
    ParagraphAIInvalidResponseError,
    ParagraphAnalysisRequest,
    ParagraphAnalysisResponse,
    build_paragraph_analysis_prompt,
)


def valid_analysis() -> ParagraphAIAnalysis:
    return ParagraphAIAnalysis(
        paragraphRole={
            "label": "claim_argument",
            "rationale": "The paragraph states a central position about the topic.",
        },
        rhetoricalMoves=[
            {"label": "claim", "rationale": "It presents the main position."},
            {"label": "support", "rationale": "It adds a reason for the claim."},
        ],
        coherence={
            "level": "moderate",
            "rationale": "The idea is understandable, with one loose connection near the end.",
        },
        academicTone={
            "level": "strong",
            "rationale": "The wording is formal and discipline-neutral.",
        },
        observation="The paragraph presents a clear claim. One connection near the end could be easier to trace.",
    )


def request_payload(**overrides) -> dict:
    payload = {
        "documentId": "local-draft",
        "revision": 12,
        "requestId": "ai-12-1",
        "language": "English",
        "paragraph": {
            "paragraphId": "p-1",
            "text": "Privacy concerns influence how students describe data practices in academic writing.",
        },
        "context": {
            "nearestHeading": "1 Introduction",
            "previousParagraph": "The previous paragraph introduces the topic.",
            "nextParagraph": "The next paragraph narrows the argument.",
        },
    }
    payload.update(overrides)
    return payload


class FakeParagraphAIService:
    def __init__(self):
        self.requests: list[ParagraphAnalysisRequest] = []

    def analyze(self, request: ParagraphAnalysisRequest) -> ParagraphAnalysisResponse:
        self.requests.append(request)
        return ParagraphAnalysisResponse(
            documentId=request.documentId,
            revision=request.revision,
            requestId=request.requestId,
            paragraphId=request.paragraph.paragraphId,
            model="gpt-5.6-luna",
            analysisVersion=PARAGRAPH_ANALYSIS_VERSION,
            analysis=valid_analysis(),
        )


class FakeResponses:
    def __init__(self, parsed):
        self.parsed = parsed
        self.calls: list[dict] = []

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        return type("FakeResponse", (), {"output_parsed": self.parsed, "usage": {"total_tokens": 42}})()


class FakeOpenAIClient:
    def __init__(self, parsed):
        self.responses = FakeResponses(parsed)


class ParagraphAIAnalysisEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def tearDown(self) -> None:
        if hasattr(app.state, "paragraph_ai_analysis_service"):
            delattr(app.state, "paragraph_ai_analysis_service")

    def test_valid_paragraph_request_returns_structured_response(self):
        fake_service = FakeParagraphAIService()
        app.state.paragraph_ai_analysis_service = fake_service

        response = self.client.post("/api/ai/analyze-paragraph", json=request_payload())

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["documentId"], "local-draft")
        self.assertEqual(body["revision"], 12)
        self.assertEqual(body["requestId"], "ai-12-1")
        self.assertEqual(body["paragraphId"], "p-1")
        self.assertEqual(body["model"], "gpt-5.6-luna")
        self.assertEqual(body["analysisVersion"], "paragraph-v1")
        self.assertEqual(body["analysis"]["paragraphRole"]["label"], "claim_argument")
        self.assertEqual(fake_service.requests[0].context.nearestHeading, "1 Introduction")

    def test_context_is_optional(self):
        fake_service = FakeParagraphAIService()
        app.state.paragraph_ai_analysis_service = fake_service

        payload = request_payload()
        payload.pop("context")
        response = self.client.post("/api/ai/analyze-paragraph", json=payload)

        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(fake_service.requests[0].context.nearestHeading)

    def test_empty_or_too_short_paragraph_is_not_sent_to_openai(self):
        response = self.client.post(
            "/api/ai/analyze-paragraph",
            json=request_payload(paragraph={"paragraphId": "p-empty", "text": "Too short."}),
        )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "Add more text to analyze this paragraph.")

    def test_missing_required_identifiers_are_rejected(self):
        payload = request_payload()
        payload.pop("documentId")

        response = self.client.post("/api/ai/analyze-paragraph", json=payload)

        self.assertEqual(response.status_code, 422)

    def test_invalid_language_value_is_rejected(self):
        response = self.client.post("/api/ai/analyze-paragraph", json=request_payload(language="Spanish"))

        self.assertEqual(response.status_code, 422)

    def test_missing_api_key_returns_controlled_configuration_error(self):
        original_key = os.environ.pop("OPENAI_API_KEY", None)
        try:
            response = self.client.post("/api/ai/analyze-paragraph", json=request_payload())
        finally:
            if original_key is not None:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"], "AI analysis is not configured.")


class ParagraphAIAnalysisServiceTests(unittest.TestCase):
    def test_configured_model_is_used(self):
        request = ParagraphAnalysisRequest.model_validate(request_payload())
        fake_raw_client = FakeOpenAIClient(valid_analysis())
        client = OpenAIResponsesParagraphClient(
            settings=AppSettings(openai_api_key="sk-test", openai_model="gpt-custom"),
            raw_client=fake_raw_client,
        )
        service = ParagraphAIAnalysisService(
            settings=AppSettings(openai_api_key="sk-test", openai_model="gpt-custom"),
            client=client,
        )

        response = service.analyze(request)

        self.assertEqual(response.model, "gpt-custom")
        self.assertEqual(fake_raw_client.responses.calls[0]["model"], "gpt-custom")
        self.assertIs(fake_raw_client.responses.calls[0]["text_format"], ParagraphAIAnalysis)

    def test_prompt_separates_target_paragraph_from_context(self):
        request = ParagraphAnalysisRequest.model_validate(request_payload())

        prompt = build_paragraph_analysis_prompt(request)

        self.assertIn("Analyze only the TARGET PARAGRAPH", PARAGRAPH_ANALYSIS_INSTRUCTIONS)
        self.assertIn("TARGET PARAGRAPH", prompt.user_message)
        self.assertIn("CONTEXT ONLY", prompt.user_message)
        self.assertIn("PREVIOUS PROSE PARAGRAPH", prompt.user_message)
        self.assertIn("NEXT PROSE PARAGRAPH", prompt.user_message)
        self.assertIn(request.paragraph.text, prompt.user_message)

    def test_valid_structured_model_result_validates(self):
        analysis = ParagraphAIAnalysis.model_validate(valid_analysis().model_dump())

        self.assertEqual(analysis.paragraphRole.label, "claim_argument")
        self.assertEqual(analysis.coherence.level, "moderate")

    def test_invalid_enum_is_rejected(self):
        data = valid_analysis().model_dump()
        data["coherence"]["level"] = "8.4/10"

        with self.assertRaises(ValidationError):
            ParagraphAIAnalysis.model_validate(data)

    def test_missing_field_is_rejected(self):
        data = valid_analysis().model_dump()
        data.pop("observation")

        with self.assertRaises(ValidationError):
            ParagraphAIAnalysis.model_validate(data)

    def test_malformed_model_response_becomes_controlled_error(self):
        request = ParagraphAnalysisRequest.model_validate(request_payload())
        client = OpenAIResponsesParagraphClient(
            settings=AppSettings(openai_api_key="sk-test", openai_model="gpt-5.6-luna"),
            raw_client=FakeOpenAIClient({"paragraphRole": {"label": "not-a-role"}}),
        )

        with self.assertRaises(ParagraphAIInvalidResponseError):
            client.analyze(request, "gpt-5.6-luna")

    def test_missing_api_key_is_not_returned_to_api_consumers(self):
        service = ParagraphAIAnalysisService(settings=AppSettings(openai_api_key=None, openai_model="gpt-5.6-luna"))

        with self.assertRaises(ParagraphAIConfigurationError) as exc:
            service.analyze(ParagraphAnalysisRequest.model_validate(request_payload()))

        self.assertNotIn("sk-", str(exc.exception))


if __name__ == "__main__":
    unittest.main()
