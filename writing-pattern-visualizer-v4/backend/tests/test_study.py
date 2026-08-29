from __future__ import annotations

import json
import tempfile
from pathlib import Path
import unittest

from fastapi.testclient import TestClient

from app.main import app
from app import study


class RemoteStudyModeTests(unittest.TestCase):
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
        self.original_assignment_dir = study.STUDY_ASSIGNMENT_DIR
        self.original_log_dir = study.STUDY_LOG_DIR
        self.original_revised_text_dir = study.STUDY_REVISED_TEXT_DIR
        study.STUDY_MATERIALS_DIR = self.materials_dir
        study.STUDY_DATA_DIR = self.data_dir
        study.STUDY_ASSIGNMENT_DIR = self.data_dir / "assignments"
        study.STUDY_LOG_DIR = self.data_dir / "logs"
        study.STUDY_REVISED_TEXT_DIR = self.data_dir / "revised-texts"

    def tearDown(self) -> None:
        study.STUDY_MATERIALS_DIR = self.original_materials_dir
        study.STUDY_DATA_DIR = self.original_data_dir
        study.STUDY_ASSIGNMENT_DIR = self.original_assignment_dir
        study.STUDY_LOG_DIR = self.original_log_dir
        study.STUDY_REVISED_TEXT_DIR = self.original_revised_text_dir
        self.tempdir.cleanup()

    def test_cli_assignment_generation_creates_unpredictable_task_links(self):
        links = study.create_counterbalanced_study_links(
            participant_id="P03",
            task1_condition="A",
            task1_text="Y",
            task2_condition="B",
            task2_text="X",
            base_url="https://study.example",
        )

        self.assertEqual(len(links), 2)
        self.assertNotEqual(links[0].token, links[1].token)
        self.assertRegex(links[0].token, r"^t_[A-Za-z0-9_-]{16,}$")
        self.assertNotIn("P03", links[0].token)
        self.assertEqual(links[0].url, f"https://study.example/study/{links[0].token}")
        self.assertTrue(Path(links[0].assignmentPath).exists())

    def test_valid_unused_token_hides_assignment_until_start(self):
        assignment = self.create_assignment(condition="B", text_id="Y", task_order=2)

        response = self.client.get(f"/api/study/tasks/{assignment.token}")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"status": "unused", "task": None, "studyText": None, "filename": None})
        self.assertNotIn("P03", response.text)
        self.assertNotIn("condition", response.text.lower())

    def test_random_invalid_token_is_rejected(self):
        response = self.client.get("/api/study/tasks/t_randomInvalidToken99")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "This study link is not valid.")

    def test_start_task_writes_task_started_once_and_does_not_return_participant_metadata(self):
        assignment = self.create_assignment(condition="A", text_id="X", task_order=1)

        first = self.client.post(f"/api/study/tasks/{assignment.token}/start")
        second = self.client.post(f"/api/study/tasks/{assignment.token}/start")

        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.status_code, 200, second.text)
        body = first.json()
        self.assertEqual(body["task"]["condition"], "A")
        self.assertEqual(body["task"]["status"], "active")
        self.assertEqual(body["task"]["token"], assignment.token)
        self.assertEqual(body["studyText"], "Text X\n\n1 Introduction\n\nAlpha beta gamma.")
        self.assertNotIn("participantId", json.dumps(body))
        self.assertNotIn("textId", json.dumps(body))
        self.assertNotIn("taskOrder", json.dumps(body))

        stored = study.read_assignment(assignment.token)
        self.assertEqual(stored.status, "active")
        events = self.read_events(stored)
        self.assertEqual([event["event"] for event in events], ["task_started"])
        self.assertEqual(events[0]["sequenceNumber"], 1)
        self.assertEqual(events[0]["participantId"], "P03")
        self.assertEqual(events[0]["condition"], "A")
        self.assertEqual(events[0]["textId"], "X")
        self.assertEqual(events[0]["taskOrder"], 1)

    def test_client_cannot_change_assignment_metadata(self):
        assignment = self.create_assignment(condition="A", text_id="Y", task_order=1)
        self.client.post(f"/api/study/tasks/{assignment.token}/start")

        response = self.client.post(
            f"/api/study/tasks/{assignment.token}/events?condition=B&participantId=P99",
            json={
                "eventId": "ev_analytics_0001",
                "sequenceNumber": 2,
                "event": "analytics_section_expanded",
                "payload": {"section": "transition_words"},
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        stored = study.read_assignment(assignment.token)
        events = self.read_events(stored)
        self.assertEqual(events[1]["participantId"], "P03")
        self.assertEqual(events[1]["condition"], "A")
        self.assertEqual(events[1]["textId"], "Y")

    def test_events_are_idempotent_and_ai_events_are_rejected_in_condition_a(self):
        assignment = self.create_assignment(condition="A")
        self.client.post(f"/api/study/tasks/{assignment.token}/start")

        payload = {
            "eventId": "ev_expand_0001",
            "sequenceNumber": 2,
            "event": "analytics_section_expanded",
            "payload": {"section": "repetition"},
        }
        first = self.client.post(f"/api/study/tasks/{assignment.token}/events", json=payload)
        duplicate = self.client.post(f"/api/study/tasks/{assignment.token}/events", json=payload)
        ai_response = self.client.post(
            f"/api/study/tasks/{assignment.token}/events",
            json={
                "eventId": "ev_revision_0001",
                "sequenceNumber": 3,
                "event": "revision_requested",
                "payload": {"paragraphId": "p-1", "action": "improve_clarity"},
            },
        )
        out_of_order = self.client.post(
            f"/api/study/tasks/{assignment.token}/events",
            json={
                "eventId": "ev_expand_0002",
                "sequenceNumber": 2,
                "event": "analytics_section_expanded",
                "payload": {"section": "sentence_length"},
            },
        )

        self.assertEqual(first.status_code, 200, first.text)
        self.assertFalse(first.json()["duplicate"])
        self.assertEqual(duplicate.status_code, 200, duplicate.text)
        self.assertTrue(duplicate.json()["duplicate"])
        self.assertEqual(ai_response.status_code, 422)
        self.assertEqual(out_of_order.status_code, 422)

        stored = study.read_assignment(assignment.token)
        events = self.read_events(stored)
        self.assertEqual([event["sequenceNumber"] for event in events], [1, 2])

    def test_condition_b_allows_ai_events_with_sanitized_payloads(self):
        assignment = self.create_assignment(condition="B")
        self.client.post(f"/api/study/tasks/{assignment.token}/start")

        response = self.client.post(
            f"/api/study/tasks/{assignment.token}/events",
            json={
                "eventId": "ev_revision_0001",
                "sequenceNumber": 2,
                "event": "revision_requested",
                "payload": {"paragraphId": "p-1", "action": "adjust_paragraph_length", "targetWordCount": 120},
            },
        )
        unsafe = self.client.post(
            f"/api/study/tasks/{assignment.token}/events",
            json={
                "eventId": "ev_revision_0002",
                "sequenceNumber": 3,
                "event": "revision_generated",
                "payload": {
                    "paragraphId": "p-1",
                    "action": "improve_clarity",
                    "revisedText": "Do not log full generated text.",
                },
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(unsafe.status_code, 422)

    def test_finish_saves_final_text_and_marks_token_completed(self):
        assignment = self.create_assignment(condition="B", text_id="Y", task_order=2)
        self.client.post(f"/api/study/tasks/{assignment.token}/start")
        self.client.post(
            f"/api/study/tasks/{assignment.token}/events",
            json={
                "eventId": "ev_revision_0001",
                "sequenceNumber": 2,
                "event": "revision_accepted",
                "payload": {"paragraphId": "p-1", "action": "improve_transition"},
            },
        )

        response = self.client.post(
            f"/api/study/tasks/{assignment.token}/finish",
            json={
                "summaryEventId": "ev_summary_0001",
                "finishedEventId": "ev_finished_0001",
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
        duplicate_finish = self.client.post(
            f"/api/study/tasks/{assignment.token}/finish",
            json={
                "summaryEventId": "ev_summary_0001",
                "finishedEventId": "ev_finished_0001",
                "summarySequenceNumber": 3,
                "finishedSequenceNumber": 4,
                "finalText": "Final revised study text.",
                "summary": {
                    "initialWordCount": 3,
                    "finalWordCount": 4,
                    "changedParagraphCount": 1,
                },
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(duplicate_finish.status_code, 200, duplicate_finish.text)
        self.assertEqual(response.json(), {"ok": True, "status": "completed"})
        self.assertEqual(duplicate_finish.json(), {"ok": True, "status": "completed"})

        stored = study.read_assignment(assignment.token)
        self.assertEqual(stored.status, "completed")
        final_text_path = study.study_final_text_path(study.task_context_from_assignment(stored))
        self.assertTrue(final_text_path.exists())
        self.assertEqual(final_text_path.read_text(encoding="utf-8"), "Final revised study text.")
        status = self.client.get(f"/api/study/tasks/{assignment.token}")
        self.assertEqual(status.json(), {"status": "completed", "task": None, "studyText": None, "filename": None})
        restart = self.client.post(f"/api/study/tasks/{assignment.token}/start")
        self.assertEqual(restart.status_code, 409)

        events = self.read_events(stored)
        self.assertEqual(
            [event["event"] for event in events],
            ["task_started", "revision_accepted", "task_revision_summary", "task_finished"],
        )
        self.assertEqual([event["sequenceNumber"] for event in events], [1, 2, 3, 4])
        self.assertNotIn("finalText", events[2]["payload"])

    def test_two_participants_are_isolated(self):
        first = self.create_assignment(participant_id="P01", condition="A", token="t_participantOne123456")
        second = self.create_assignment(participant_id="P02", condition="B", token="t_participantTwo123456")

        self.client.post(f"/api/study/tasks/{first.token}/start")
        self.client.post(f"/api/study/tasks/{second.token}/start")
        self.client.post(
            f"/api/study/tasks/{first.token}/events",
            json={
                "eventId": "ev_first_0001",
                "sequenceNumber": 2,
                "event": "analytics_section_expanded",
                "payload": {"section": "paragraph_length"},
            },
        )
        self.client.post(
            f"/api/study/tasks/{second.token}/events",
            json={
                "eventId": "ev_second_0001",
                "sequenceNumber": 2,
                "event": "ai_analysis_completed",
                "payload": {"paragraphId": "p-2"},
            },
        )

        first_events = self.read_events(study.read_assignment(first.token))
        second_events = self.read_events(study.read_assignment(second.token))
        self.assertEqual(first_events[0]["participantId"], "P01")
        self.assertEqual(second_events[0]["participantId"], "P02")
        self.assertEqual(first_events[1]["event"], "analytics_section_expanded")
        self.assertEqual(second_events[1]["event"], "ai_analysis_completed")

    def create_assignment(
        self,
        participant_id: str = "P03",
        condition: str = "A",
        text_id: str = "X",
        task_order: int = 1,
        token: str | None = None,
    ) -> study.RemoteStudyAssignment:
        return study.create_remote_study_assignment(
            study.StudyTaskConfig(
                participantId=participant_id,
                condition=condition,  # type: ignore[arg-type]
                textId=text_id,  # type: ignore[arg-type]
                taskOrder=task_order,  # type: ignore[arg-type]
            ),
            token=token,
        )

    def read_events(self, assignment: study.RemoteStudyAssignment) -> list[dict]:
        context = study.task_context_from_assignment(assignment)
        log_path = study.study_log_path(context)
        return [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]


if __name__ == "__main__":
    unittest.main()
