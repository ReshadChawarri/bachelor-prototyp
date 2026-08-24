from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

from app.main import app


def block(
    block_id: str,
    text: str,
    order: int,
    *,
    block_type: str = "paragraph",
    node_type: str = "paragraph",
    heading_level: int | None = None,
) -> dict:
    data = {
        "id": block_id,
        "type": node_type,
        "blockType": block_type,
        "order": order,
        "text": text,
    }
    if heading_level is not None:
        data["headingLevel"] = heading_level
    return data


def request_payload(
    blocks: list[dict],
    *,
    language: str = "English",
    revision: int = 42,
    request_id: str = "request-1",
) -> dict:
    return {
        "documentId": "local-test-document",
        "revision": revision,
        "requestId": request_id,
        "language": language,
        "blocks": blocks,
    }


class DocumentAnalyticsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def analyze(self, blocks: list[dict], **overrides):
        response = self.client.post("/api/analytics/document", json=request_payload(blocks, **overrides))
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_transition_words_empty_when_no_transitions_are_present(self):
        result = self.analyze([block("p1", "This paragraph describes a draft without listed markers.", 0)])

        self.assertEqual(result["transitions"]["total"], 0)
        self.assertEqual(result["transitions"]["categories"], [])
        self.assertEqual(result["transitions"]["terms"], [])

    def test_transition_words_count_one_english_category(self):
        result = self.analyze([block("p1", "However, this point remains visible. However, the count repeats.", 0)])

        self.assertEqual(result["transitions"]["total"], 2)
        self.assertEqual(result["transitions"]["categories"], [{"name": "Contrast", "count": 2}])
        self.assertEqual(result["transitions"]["terms"][0], {"term": "however", "category": "Contrast", "count": 2})

    def test_transition_words_count_multiple_english_categories(self):
        result = self.analyze(
            [
                block(
                    "p1",
                    "However, students compare drafts. Therefore, they inspect patterns. For example, they review transitions.",
                    0,
                )
            ]
        )

        categories = {item["name"]: item["count"] for item in result["transitions"]["categories"]}
        self.assertEqual(result["transitions"]["total"], 3)
        self.assertEqual(categories["Contrast"], 1)
        self.assertEqual(categories["Cause and result"], 1)
        self.assertEqual(categories["Example and specification"], 1)

    def test_transition_words_support_german_categories(self):
        result = self.analyze(
            [block("p1", "Jedoch bleibt der Fokus lokal. Daher ist die Analyse nachvollziehbar.", 0)],
            language="German",
        )

        categories = {item["name"]: item["count"] for item in result["transitions"]["categories"]}
        self.assertEqual(result["language"], "German")
        self.assertEqual(result["transitions"]["total"], 2)
        self.assertEqual(categories["Contrast"], 1)
        self.assertEqual(categories["Cause and result"], 1)

    def test_transition_words_exclude_headings_and_non_prose_blocks(self):
        result = self.analyze(
            [
                block("h1", "However", 0, block_type="heading", node_type="heading", heading_level=1),
                block("p1", "However, this prose paragraph is included.", 1),
                block("m1", "Therefore, metadata is excluded.", 2, block_type="metadata"),
                block("c1", "For example, this caption is excluded.", 3, block_type="caption"),
            ]
        )

        self.assertEqual(result["transitions"]["total"], 1)
        self.assertEqual(result["transitions"]["terms"], [{"term": "however", "category": "Contrast", "count": 1}])

    def test_repetition_normalizes_casing_and_excludes_stopwords(self):
        result = self.analyze(
            [
                block(
                    "p1",
                    "Writing writing WRITING the the and and privacy Privacy users users users.",
                    0,
                )
            ]
        )

        terms = {item["term"]: item["count"] for item in result["repetition"]["terms"]}
        self.assertEqual(terms["writing"], 3)
        self.assertEqual(terms["privacy"], 2)
        self.assertEqual(terms["users"], 3)
        self.assertNotIn("the", terms)
        self.assertNotIn("and", terms)

    def test_repetition_returns_empty_for_empty_or_short_text(self):
        result = self.analyze([block("p1", "A tiny text.", 0)])

        self.assertEqual(result["repetition"]["terms"], [])

    def test_repetition_excludes_non_prose_blocks(self):
        result = self.analyze(
            [
                block("p1", "Privacy appears in prose once.", 0),
                block("t1", "privacy privacy privacy", 1, block_type="table"),
                block("f1", "privacy privacy", 2, block_type="figure"),
            ]
        )

        self.assertEqual(result["repetition"]["terms"], [])

    def test_document_structure_uses_explicit_tiptap_headings_in_order(self):
        result = self.analyze(
            [
                block("h1", "Abstract", 0, block_type="heading", node_type="heading", heading_level=2),
                block("p1", "Introduction", 1),
                block("h2", "1 Introduction", 2, block_type="heading", node_type="heading", heading_level=1),
                block("h3", "2.1 Participants", 3, block_type="heading", node_type="heading", heading_level=2),
            ]
        )

        self.assertEqual(result["structure"]["source"], "explicit")
        self.assertEqual(
            result["structure"]["headings"],
            [
                {"text": "Abstract", "level": 2, "nodeId": "h1", "paragraphId": "h1"},
                {"text": "1 Introduction", "level": 1, "nodeId": "h2", "paragraphId": "h2"},
                {"text": "2.1 Participants", "level": 2, "nodeId": "h3", "paragraphId": "h3"},
            ],
        )

    def test_document_structure_returns_none_without_headings(self):
        result = self.analyze([block("p1", "This paragraph has no academic heading.", 0)])

        self.assertEqual(result["structure"], {"source": "none", "headings": []})

    def test_document_structure_uses_v3_fallback_when_no_explicit_headings_exist(self):
        result = self.analyze(
            [
                block("p1", "1 Introduction", 0),
                block("p2", "This paragraph belongs to the introduction.", 1),
                block("p3", "2.1 Methodology", 2),
            ]
        )

        self.assertEqual(result["structure"]["source"], "heuristic")
        self.assertEqual(
            result["structure"]["headings"],
            [
                {"text": "1 Introduction", "level": 1, "nodeId": None, "paragraphId": "p1"},
                {"text": "2.1 Methodology", "level": 2, "nodeId": None, "paragraphId": "p3"},
            ],
        )

    def test_response_includes_request_revision_and_request_id(self):
        result = self.analyze(
            [block("p1", "Therefore, revision metadata remains round-tripped.", 0)],
            revision=140,
            request_id="analytics-140-1",
        )

        self.assertEqual(result["documentId"], "local-test-document")
        self.assertEqual(result["revision"], 140)
        self.assertEqual(result["requestId"], "analytics-140-1")


if __name__ == "__main__":
    unittest.main()
