from __future__ import annotations

import unittest

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import AppSettings
from app.main import app
from app.paragraph_revision import (
    ACTION_LABELS,
    OpenAIResponsesParagraphRevisionClient,
    PARAGRAPH_REVISION_INSTRUCTIONS,
    PARAGRAPH_REVISION_VERSION,
    ParagraphRevisionGuardrailError,
    ParagraphRevisionRequest,
    ParagraphRevisionResponse,
    ParagraphRevisionService,
    ParagraphRevisionSuggestion,
    build_paragraph_revision_prompt,
    validate_revision_guardrails,
)


def request_payload(**overrides) -> dict:
    payload = {
        "documentId": "local-draft",
        "revision": 51,
        "requestId": "rev-51-1",
        "language": "English",
        "action": "improve_clarity",
        "sourceContentHash": "source-hash-1",
        "paragraph": {
            "paragraphId": "p-1",
            "text": "In 2024, the study found that 42% of participants changed their privacy settings [1, 5].",
        },
        "context": {
            "nearestHeading": "4.2 Implications",
            "previousParagraph": "The previous paragraph describes the empirical setting.",
            "nextParagraph": "The next paragraph discusses broader implications.",
        },
    }
    payload.update(overrides)
    return payload


def valid_suggestion() -> ParagraphRevisionSuggestion:
    return ParagraphRevisionSuggestion(
        revisedText="In 2024, the study found that 42% of participants changed their privacy settings [1, 5].",
        summary="Clarifies the sentence while preserving the citation and numeric values.",
    )


class FakeParagraphRevisionService:
    def __init__(self):
        self.requests: list[ParagraphRevisionRequest] = []

    def suggest_revision(self, request: ParagraphRevisionRequest) -> ParagraphRevisionResponse:
        self.requests.append(request)
        return ParagraphRevisionResponse(
            documentId=request.documentId,
            sourceRevision=request.revision,
            requestId=request.requestId,
            paragraphId=request.paragraph.paragraphId,
            sourceContentHash=request.sourceContentHash,
            action=request.action,
            model="gpt-5.6-luna",
            revisionVersion=PARAGRAPH_REVISION_VERSION,
            suggestion=valid_suggestion(),
        )


class FakeResponses:
    def __init__(self, parsed):
        self.parsed = parsed
        self.calls: list[dict] = []

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        return type("FakeResponse", (), {"output_parsed": self.parsed, "usage": {"total_tokens": 38}})()


class FakeOpenAIClient:
    def __init__(self, parsed):
        self.responses = FakeResponses(parsed)


class ParagraphRevisionEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def tearDown(self) -> None:
        if hasattr(app.state, "paragraph_revision_service"):
            delattr(app.state, "paragraph_revision_service")

    def test_valid_revision_request_returns_structured_suggestion(self):
        fake_service = FakeParagraphRevisionService()
        app.state.paragraph_revision_service = fake_service

        response = self.client.post("/api/ai/suggest-revision", json=request_payload())

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["documentId"], "local-draft")
        self.assertEqual(body["sourceRevision"], 51)
        self.assertEqual(body["requestId"], "rev-51-1")
        self.assertEqual(body["paragraphId"], "p-1")
        self.assertEqual(body["sourceContentHash"], "source-hash-1")
        self.assertEqual(body["action"], "improve_clarity")
        self.assertEqual(body["revisionVersion"], "paragraph-revision-v1")
        self.assertEqual(fake_service.requests[0].context.nearestHeading, "4.2 Implications")

    def test_supported_actions_are_accepted(self):
        fake_service = FakeParagraphRevisionService()
        app.state.paragraph_revision_service = fake_service

        for action in ACTION_LABELS:
            with self.subTest(action=action):
                response = self.client.post("/api/ai/suggest-revision", json=request_payload(action=action))
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["action"], action)

    def test_invalid_action_is_rejected(self):
        response = self.client.post("/api/ai/suggest-revision", json=request_payload(action="rewrite_everything"))

        self.assertEqual(response.status_code, 422)

    def test_missing_paragraph_is_rejected(self):
        payload = request_payload()
        payload.pop("paragraph")

        response = self.client.post("/api/ai/suggest-revision", json=payload)

        self.assertEqual(response.status_code, 422)


class ParagraphRevisionServiceTests(unittest.TestCase):
    def test_configured_model_is_used(self):
        request = ParagraphRevisionRequest.model_validate(request_payload())
        fake_raw_client = FakeOpenAIClient(valid_suggestion())
        client = OpenAIResponsesParagraphRevisionClient(
            settings=AppSettings(openai_api_key="sk-test", openai_model="gpt-custom"),
            raw_client=fake_raw_client,
        )
        service = ParagraphRevisionService(
            settings=AppSettings(openai_api_key="sk-test", openai_model="gpt-custom"),
            client=client,
        )

        response = service.suggest_revision(request)

        self.assertEqual(response.model, "gpt-custom")
        self.assertEqual(fake_raw_client.responses.calls[0]["model"], "gpt-custom")
        self.assertIs(fake_raw_client.responses.calls[0]["text_format"], ParagraphRevisionSuggestion)

    def test_prompt_separates_target_paragraph_from_context(self):
        request = ParagraphRevisionRequest.model_validate(request_payload(action="improve_transition"))

        prompt = build_paragraph_revision_prompt(request)

        self.assertIn("Only rewrite the TARGET PARAGRAPH", PARAGRAPH_REVISION_INSTRUCTIONS)
        self.assertIn("TARGET PARAGRAPH", prompt.user_message)
        self.assertIn("CONTEXT ONLY", prompt.user_message)
        self.assertIn("Improve transition / coherence", prompt.user_message)
        self.assertIn(request.paragraph.text, prompt.user_message)

    def test_valid_structured_revision_validates(self):
        suggestion = ParagraphRevisionSuggestion.model_validate(valid_suggestion().model_dump())

        self.assertIn("42%", suggestion.revisedText)

    def test_missing_revised_text_is_rejected(self):
        with self.assertRaises(ValidationError):
            ParagraphRevisionSuggestion.model_validate({"summary": "Short summary."})

    def test_blank_revision_is_rejected(self):
        with self.assertRaises(ValidationError):
            ParagraphRevisionSuggestion.model_validate({"revisedText": "   ", "summary": "Short summary."})


class ParagraphRevisionGuardrailTests(unittest.TestCase):
    def test_preserves_citations_numbers_urls_dois_quotes_and_emails(self):
        original = (
            'In 2024, "privacy fatigue" affected 42% of users [1, 5]. '
            "The dataset is described at https://example.org/data and DOI 10.1145/1234567. "
            "Contact m.hamid@campus.lmu.de for questions."
        )
        revised = (
            'In 2024, "privacy fatigue" affected 42% of users [1, 5]. '
            "The dataset is available at https://example.org/data and DOI 10.1145/1234567. "
            "Questions can be sent to m.hamid@campus.lmu.de."
        )

        validate_revision_guardrails(original, revised)

    def test_removed_square_citation_is_rejected(self):
        with self.assertRaises(ParagraphRevisionGuardrailError):
            validate_revision_guardrails("This claim is supported [15].", "This claim is supported.")

    def test_introduced_square_citation_is_rejected(self):
        with self.assertRaises(ParagraphRevisionGuardrailError):
            validate_revision_guardrails("This claim is supported.", "This claim is supported [16].")

    def test_changed_percentage_is_rejected(self):
        with self.assertRaises(ParagraphRevisionGuardrailError):
            validate_revision_guardrails("The value was 42%.", "The value was 43%.")

    def test_changed_year_is_rejected(self):
        with self.assertRaises(ParagraphRevisionGuardrailError):
            validate_revision_guardrails("The study was conducted in 2024.", "The study was conducted in 2025.")

    def test_changed_doi_is_rejected(self):
        with self.assertRaises(ParagraphRevisionGuardrailError):
            validate_revision_guardrails("The article has DOI 10.1145/1234567.", "The article has DOI 10.1145/7654321.")

    def test_changed_url_is_rejected(self):
        with self.assertRaises(ParagraphRevisionGuardrailError):
            validate_revision_guardrails("See https://example.org/data.", "See https://example.com/data.")

    def test_changed_quoted_text_is_rejected(self):
        with self.assertRaises(ParagraphRevisionGuardrailError):
            validate_revision_guardrails('The participant said "I felt observed".', 'The participant said "I felt tracked".')


if __name__ == "__main__":
    unittest.main()
