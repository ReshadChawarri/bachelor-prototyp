from __future__ import annotations

import json
import tempfile
from pathlib import Path
import unittest

from fastapi.testclient import TestClient

from app.main import app
from app import study


class StudyModeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        self.tempdir = tempfile.TemporaryDirectory()
        self.materials_dir = Path(self.tempdir.name) / "study-materials"
        self.data_dir = Path(self.tempdir.name) / "study-data"
        self.materials_dir.mkdir(parents=True)
        (self.materials_dir / "text-x.txt").write_text("Text X\n\n1 Introduction\n\nAlpha beta gamma.", encoding="utf-8")
        (self.materials_dir / "text-y.txt").write_text("Text Y\n\n1 Background\n\nDelta epsilon zeta.", encoding="utf-8")
        self.original_materials_dir = study.STUDY_MATERIALS_DIR
        self.original_data_dir = study.STUDY_DATA_DIR
        self.original_log_dir = study.STUDY_LOG_DIR
        self.original_revised_text_dir = study.STUDY_REVISED_TEXT_DIR
        study.STUDY_MATERIALS_DIR = self.materials_dir
        study.STUDY_DATA_DIR = self.data_dir
        study.STUDY_LOG_DIR = self.data_dir / "logs"
        study.STUDY_REVISED_TEXT_DIR = self.data_dir / "revised-texts"

    def tearDown(self) -> None:
        study.STUDY_MATERIALS_DIR = self.original_materials_dir
        study.STUDY_DATA_DIR = self.original_data_dir
        study.STUDY_LOG_DIR = self.original_log_dir
        study.STUDY_REVISED_TEXT_DIR = self.original_revised_text_dir
        self.tempdir.cleanup()

    def test_start_task_validates_participant_and_writes_task_started_once(self):
        response = self.client.post(
            "/api/study/tasks/start",
            json={"participantId": "P03", "condition": "A", "textId": "X", "taskOrder": 1},
        )

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["task"]["participantId"], "P03")
        self.assertEqual(body["task"]["condition"], "A")
        self.assertEqual(body["task"]["textId"], "X")
        self.assertEqual(body["task"]["taskOrder"], 1)
        self.assertEqual(body["task"]["studyVersion"], "1.0")
        self.assertEqual(body["studyText"], "Text X\n\n1 Introduction\n\nAlpha beta gamma.")

        events = self.read_events(body["task"])
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["sequenceNumber"], 1)
        self.assertEqual(events[0]["event"], "task_started")
        self.assertEqual(events[0]["payload"], {})

    def test_invalid_participant_id_is_rejected(self):
        response = self.client.post(
            "/api/study/tasks/start",
            json={"participantId": "Alice", "condition": "A", "textId": "X", "taskOrder": 1},
        )

        self.assertEqual(response.status_code, 422)

    def test_logs_monotonic_metadata_and_rejects_ai_events_in_condition_a(self):
        task = self.start_task(condition="A")

        event_response = self.client.post(
            "/api/study/events",
            json={
                "task": task,
                "sequenceNumber": 2,
                "event": "analytics_section_expanded",
                "payload": {"section": "transition_words"},
            },
        )

        self.assertEqual(event_response.status_code, 200, event_response.text)
        ai_response = self.client.post(
            "/api/study/events",
            json={
                "task": task,
                "sequenceNumber": 3,
                "event": "revision_requested",
                "payload": {"paragraphId": "p-1", "action": "improve_clarity"},
            },
        )

        self.assertEqual(ai_response.status_code, 422)
        events = self.read_events(task)
        self.assertEqual([event["sequenceNumber"] for event in events], [1, 2])
        self.assertEqual(events[1]["participantId"], "P03")
        self.assertEqual(events[1]["condition"], "A")
        self.assertEqual(events[1]["textId"], "X")
        self.assertEqual(events[1]["taskOrder"], 1)

        out_of_order = self.client.post(
            "/api/study/events",
            json={
                "task": task,
                "sequenceNumber": 2,
                "event": "analytics_section_expanded",
                "payload": {"section": "repetition"},
            },
        )
        self.assertEqual(out_of_order.status_code, 422)

    def test_event_payload_values_are_schema_checked(self):
        task = self.start_task(condition="B")

        invalid_section = self.client.post(
            "/api/study/events",
            json={
                "task": task,
                "sequenceNumber": 2,
                "event": "analytics_section_expanded",
                "payload": {"section": "whole_document_ai"},
            },
        )
        self.assertEqual(invalid_section.status_code, 422)

        invalid_action = self.client.post(
            "/api/study/events",
            json={
                "task": task,
                "sequenceNumber": 2,
                "event": "revision_requested",
                "payload": {"paragraphId": "p-1", "action": "freeform_rewrite"},
            },
        )
        self.assertEqual(invalid_action.status_code, 422)

        invalid_failure = self.client.post(
            "/api/study/events",
            json={
                "task": task,
                "sequenceNumber": 2,
                "event": "revision_failed",
                "payload": {"paragraphId": "p-1", "action": "improve_clarity", "category": "raw_exception"},
            },
        )
        self.assertEqual(invalid_failure.status_code, 422)

    def test_payload_rejects_full_text_and_prompt_keys(self):
        task = self.start_task(condition="B")

        response = self.client.post(
            "/api/study/events",
            json={
                "task": task,
                "sequenceNumber": 2,
                "event": "revision_requested",
                "payload": {"paragraphId": "p-1", "paragraphText": "Full paragraph must not be logged."},
            },
        )

        self.assertEqual(response.status_code, 422)

    def test_finish_saves_final_text_and_summary_events(self):
        task = self.start_task(condition="B", text_id="Y", task_order=2)

        self.client.post(
            "/api/study/events",
            json={
                "task": task,
                "sequenceNumber": 2,
                "event": "revision_requested",
                "payload": {"paragraphId": "p-1", "action": "improve_transition"},
            },
        )
        response = self.client.post(
            "/api/study/tasks/finish",
            json={
                "task": task,
                "summarySequenceNumber": 3,
                "finishedSequenceNumber": 4,
                "finalText": "Final revised study text.",
                "summary": {
                    "initialWordCount": 3,
                    "finalWordCount": 4,
                    "changedParagraphCount": 1,
                    "addedWordEstimate": 1,
                    "removedWordEstimate": 0,
                },
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(Path(body["finalTextPath"]).exists())
        self.assertEqual(Path(body["finalTextPath"]).read_text(encoding="utf-8"), "Final revised study text.")
        events = self.read_events(task)
        self.assertEqual([event["event"] for event in events], [
            "task_started",
            "revision_requested",
            "task_revision_summary",
            "task_finished",
        ])
        self.assertEqual([event["sequenceNumber"] for event in events], [1, 2, 3, 4])
        self.assertEqual(events[2]["payload"]["changedParagraphCount"], 1)
        self.assertNotIn("finalText", events[2]["payload"])

        double_finish = self.client.post(
            "/api/study/tasks/finish",
            json={
                "task": task,
                "summarySequenceNumber": 5,
                "finishedSequenceNumber": 6,
                "finalText": "Second write.",
                "summary": {
                    "initialWordCount": 3,
                    "finalWordCount": 2,
                    "changedParagraphCount": 1,
                },
            },
        )
        self.assertEqual(double_finish.status_code, 409)

    def start_task(self, condition: str = "A", text_id: str = "X", task_order: int = 1) -> dict:
        response = self.client.post(
            "/api/study/tasks/start",
            json={"participantId": "P03", "condition": condition, "textId": text_id, "taskOrder": task_order},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["task"]

    def read_events(self, task: dict) -> list[dict]:
        context = study.StudyTaskContext.model_validate(task)
        log_path = study.study_log_path(context)
        return [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]


if __name__ == "__main__":
    unittest.main()
