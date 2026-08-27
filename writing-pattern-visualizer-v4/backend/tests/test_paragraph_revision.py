from __future__ import annotations

import unittest

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import AppSettings
from app.main import app
from app.paragraph_revision import (
    ACTION_LABELS,
    LENGTH_TARGET_TOLERANCE_MIN_WORDS,
    OpenAIResponsesParagraphRevisionClient,
    PARAGRAPH_REVISION_INSTRUCTIONS,
    PARAGRAPH_REVISION_VERSION,
    SENTENCE_REVISION_WORD_DRIFT_RATIO,
    LengthAdjustmentMetadata,
    ParagraphRevisionGuardrailError,
    ParagraphRevisionRequest,
    ParagraphRevisionResponse,
    ParagraphRevisionService,
    ParagraphRevisionTargetError,
    ParagraphRevisionSuggestion,
    build_paragraph_revision_prompt,
    count_revision_words,
    is_within_length_target_tolerance,
    length_target_bounds,
    sentence_length_metrics,
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


def length_adjustment_text() -> str:
    return (
        "This paragraph describes how participants interpreted privacy notices in the study and explains why "
        "interface wording shaped their expectations about data practices, consent, and platform accountability "
        "during the evaluation."
    )


def sentence_revision_text() -> str:
    return (
        "In 2024, the study examined privacy notices because students encountered multiple interface explanations "
        "that described data collection, consent, and platform accountability in a single dense sequence, which made "
        "the relationship between wording, trust, and academic reflection difficult to inspect [1, 5]. "
        "This second sentence is also very long because it connects observed behavior, the interpretation of "
        "institutional policies, and implications for writing support tools without giving the reader a clear pause "
        "between those ideas."
    )


def sentence_revision_suggestion_text() -> str:
    return (
        "In 2024, the study examined privacy notices because students encountered multiple interface explanations "
        "about data collection, consent, and platform accountability [1, 5]. "
        "These explanations made the relationship between wording, trust, and academic reflection difficult to inspect. "
        "The second point connects observed behavior with interpretations of institutional policies. "
        "It also links those interpretations to implications for writing support tools."
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
            length=LengthAdjustmentMetadata(
                originalWordCount=28,
                targetWordCount=request.targetWordCount,
                revisedWordCount=24,
                withinTolerance=True,
            )
            if request.action == "adjust_paragraph_length"
            else None,
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
                payload = request_payload(action=action)
                if action == "adjust_paragraph_length":
                    payload = request_payload(
                        action=action,
                        targetWordCount=24,
                        paragraph={"paragraphId": "p-1", "text": length_adjustment_text()},
                    )
                response = self.client.post("/api/ai/suggest-revision", json=payload)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["action"], action)

    def test_length_adjustment_requires_target_word_count(self):
        response = self.client.post(
            "/api/ai/suggest-revision",
            json=request_payload(action="adjust_paragraph_length", paragraph={"paragraphId": "p-1", "text": length_adjustment_text()}),
        )

        self.assertEqual(response.status_code, 422)

    def test_non_length_action_rejects_target_word_count(self):
        response = self.client.post("/api/ai/suggest-revision", json=request_payload(targetWordCount=24))

        self.assertEqual(response.status_code, 422)

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

    def test_length_adjustment_prompt_includes_target_policy_and_direction(self):
        request = ParagraphRevisionRequest.model_validate(
            request_payload(
                action="adjust_paragraph_length",
                targetWordCount=24,
                paragraph={"paragraphId": "p-1", "text": length_adjustment_text()},
            )
        )

        prompt = build_paragraph_revision_prompt(request)

        self.assertIn("Adjust paragraph length", prompt.user_message)
        self.assertIn("Target word count: approximately 24 words", prompt.user_message)
        self.assertIn("Requested direction: shorten", prompt.user_message)
        self.assertIn("Do not invent examples", PARAGRAPH_REVISION_INSTRUCTIONS + prompt.user_message)

    def test_sentence_length_prompt_includes_sentence_policy(self):
        request = ParagraphRevisionRequest.model_validate(
            request_payload(
                action="improve_sentence_length",
                paragraph={"paragraphId": "p-1", "text": sentence_revision_text()},
            )
        )

        prompt = build_paragraph_revision_prompt(request)

        self.assertIn("Improve sentence length", prompt.user_message)
        self.assertIn("Original average sentence length", prompt.user_message)
        self.assertIn("Do not chase an ideal sentence length", prompt.user_message)
        self.assertIn("Only rewrite the TARGET PARAGRAPH", PARAGRAPH_REVISION_INSTRUCTIONS)

    def test_length_adjustment_response_contains_computed_word_counts(self):
        request = ParagraphRevisionRequest.model_validate(
            request_payload(
                action="adjust_paragraph_length",
                targetWordCount=24,
                paragraph={"paragraphId": "p-1", "text": length_adjustment_text()},
            )
        )
        suggestion = ParagraphRevisionSuggestion(
            revisedText=(
                "This paragraph explains how participants interpreted privacy notices and why interface wording shaped "
                "their expectations about data practices, consent, and platform accountability."
            ),
            summary="Condenses redundant phrasing while preserving the paragraph's core meaning.",
        )
        service = ParagraphRevisionService(
            settings=AppSettings(openai_api_key="sk-test", openai_model="gpt-custom"),
            client=OpenAIResponsesParagraphRevisionClient(
                settings=AppSettings(openai_api_key="sk-test", openai_model="gpt-custom"),
                raw_client=FakeOpenAIClient(suggestion),
            ),
        )

        response = service.suggest_revision(request)

        self.assertIsNotNone(response.length)
        self.assertEqual(response.length.originalWordCount, count_revision_words(length_adjustment_text()))
        self.assertEqual(response.length.targetWordCount, 24)
        self.assertEqual(response.length.revisedWordCount, count_revision_words(suggestion.revisedText))
        self.assertEqual(response.length.withinTolerance, is_within_length_target_tolerance(response.length.revisedWordCount, 24))

    def test_length_adjustment_reports_missed_target_without_trusting_model(self):
        request = ParagraphRevisionRequest.model_validate(
            request_payload(
                action="adjust_paragraph_length",
                targetWordCount=20,
                paragraph={"paragraphId": "p-1", "text": length_adjustment_text()},
            )
        )
        suggestion = ParagraphRevisionSuggestion(
            revisedText=length_adjustment_text(),
            summary="Keeps the paragraph mostly unchanged.",
        )
        service = ParagraphRevisionService(
            settings=AppSettings(openai_api_key="sk-test", openai_model="gpt-custom"),
            client=OpenAIResponsesParagraphRevisionClient(
                settings=AppSettings(openai_api_key="sk-test", openai_model="gpt-custom"),
                raw_client=FakeOpenAIClient(suggestion),
            ),
        )

        response = service.suggest_revision(request)

        self.assertIsNotNone(response.length)
        self.assertFalse(response.length.withinTolerance)

    def test_extreme_length_target_is_rejected_before_model_call(self):
        request = ParagraphRevisionRequest.model_validate(
            request_payload(
                action="adjust_paragraph_length",
                targetWordCount=500,
                paragraph={"paragraphId": "p-1", "text": length_adjustment_text()},
            )
        )
        fake_raw_client = FakeOpenAIClient(valid_suggestion())
        service = ParagraphRevisionService(
            settings=AppSettings(openai_api_key="sk-test", openai_model="gpt-custom"),
            client=OpenAIResponsesParagraphRevisionClient(
                settings=AppSettings(openai_api_key="sk-test", openai_model="gpt-custom"),
                raw_client=fake_raw_client,
            ),
        )

        with self.assertRaises(ParagraphRevisionTargetError):
            service.suggest_revision(request)

        self.assertEqual(fake_raw_client.responses.calls, [])

    def test_length_target_policy_bounds_and_tolerance_are_centralized(self):
        minimum, maximum = length_target_bounds(80)

        self.assertEqual(minimum, 40)
        self.assertEqual(maximum, 140)
        self.assertEqual(LENGTH_TARGET_TOLERANCE_MIN_WORDS, 6)
        self.assertTrue(is_within_length_target_tolerance(116, 120))
        self.assertTrue(is_within_length_target_tolerance(126, 120))
        self.assertFalse(is_within_length_target_tolerance(130, 120))

    def test_sentence_length_response_contains_computed_sentence_metrics(self):
        request = ParagraphRevisionRequest.model_validate(
            request_payload(
                action="improve_sentence_length",
                paragraph={"paragraphId": "p-1", "text": sentence_revision_text()},
            )
        )
        suggestion = ParagraphRevisionSuggestion(
            revisedText=sentence_revision_suggestion_text(),
            summary="Splits overloaded sentences while preserving the paragraph's argument.",
        )
        service = ParagraphRevisionService(
            settings=AppSettings(openai_api_key="sk-test", openai_model="gpt-custom"),
            client=OpenAIResponsesParagraphRevisionClient(
                settings=AppSettings(openai_api_key="sk-test", openai_model="gpt-custom"),
                raw_client=FakeOpenAIClient(suggestion),
            ),
        )

        response = service.suggest_revision(request)

        self.assertIsNotNone(response.sentence)
        self.assertEqual(response.sentence.originalSentenceCount, 2)
        self.assertGreater(response.sentence.revisedSentenceCount, response.sentence.originalSentenceCount)
        self.assertLess(response.sentence.revisedAverageSentenceLength, response.sentence.originalAverageSentenceLength)
        self.assertEqual(response.sentence.originalDistribution[-1].category, "Very long")

    def test_sentence_length_revision_rejects_unchanged_sentence_structure(self):
        request = ParagraphRevisionRequest.model_validate(
            request_payload(
                action="improve_sentence_length",
                paragraph={"paragraphId": "p-1", "text": sentence_revision_text()},
            )
        )
        service = ParagraphRevisionService(
            settings=AppSettings(openai_api_key="sk-test", openai_model="gpt-custom"),
            client=OpenAIResponsesParagraphRevisionClient(
                settings=AppSettings(openai_api_key="sk-test", openai_model="gpt-custom"),
                raw_client=FakeOpenAIClient(
                    ParagraphRevisionSuggestion(
                        revisedText=sentence_revision_text(),
                        summary="Keeps the sentence structure unchanged.",
                    )
                ),
            ),
        )

        with self.assertRaises(ParagraphRevisionGuardrailError):
            service.suggest_revision(request)

    def test_sentence_length_revision_rejects_excessive_paragraph_word_drift(self):
        request = ParagraphRevisionRequest.model_validate(
            request_payload(
                action="improve_sentence_length",
                paragraph={"paragraphId": "p-1", "text": sentence_revision_text()},
            )
        )
        service = ParagraphRevisionService(
            settings=AppSettings(openai_api_key="sk-test", openai_model="gpt-custom"),
            client=OpenAIResponsesParagraphRevisionClient(
                settings=AppSettings(openai_api_key="sk-test", openai_model="gpt-custom"),
                raw_client=FakeOpenAIClient(
                    ParagraphRevisionSuggestion(
                        revisedText="In 2024, privacy notices shaped student interpretation [1, 5].",
                        summary="Over-compresses the paragraph.",
                    )
                ),
            ),
        )

        with self.assertRaises(ParagraphRevisionGuardrailError):
            service.suggest_revision(request)

    def test_sentence_metrics_use_documented_thresholds_and_word_drift_policy(self):
        metrics = sentence_length_metrics("One two three. " + " ".join(f"word{i}" for i in range(31)) + ".")

        self.assertEqual(metrics.distribution["Short"], 1)
        self.assertEqual(metrics.distribution["Very long"], 1)
        self.assertEqual(SENTENCE_REVISION_WORD_DRIFT_RATIO, 0.35)

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

    def test_length_shortening_keeps_existing_protected_tokens(self):
        original = 'In 2024, "privacy fatigue" affected 42% of users [1, 5] according to DOI 10.1145/1234567.'
        revised = 'In 2024, "privacy fatigue" affected 42% of users [1, 5], DOI 10.1145/1234567.'

        validate_revision_guardrails(original, revised)

    def test_lengthening_cannot_introduce_citation(self):
        with self.assertRaises(ParagraphRevisionGuardrailError):
            validate_revision_guardrails("The result shaped the argument.", "The result shaped the argument [99].")


if __name__ == "__main__":
    unittest.main()
