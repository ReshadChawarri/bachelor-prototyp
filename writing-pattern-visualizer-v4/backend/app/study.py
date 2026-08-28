from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path
import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from .config import BACKEND_ROOT


STUDY_VERSION = "1.0"
V4_ROOT = BACKEND_ROOT.parent
STUDY_MATERIALS_DIR = V4_ROOT / "study-materials"
STUDY_DATA_DIR = BACKEND_ROOT / "study-data"
STUDY_LOG_DIR = STUDY_DATA_DIR / "logs"
STUDY_REVISED_TEXT_DIR = STUDY_DATA_DIR / "revised-texts"

ParticipantId = str
StudyCondition = Literal["A", "B"]
StudyTextId = Literal["X", "Y"]
StudyTaskOrder = Literal[1, 2]

StudyEventType = Literal[
    "task_started",
    "task_revision_summary",
    "task_finished",
    "analytics_section_expanded",
    "transition_highlight_applied",
    "repetition_highlight_applied",
    "paragraph_navigation_used",
    "structure_navigation_used",
    "ai_analysis_completed",
    "ai_analysis_viewed",
    "revision_requested",
    "revision_generated",
    "revision_failed",
    "revision_accepted",
    "revision_rejected",
]

AI_ONLY_EVENTS = {
    "ai_analysis_completed",
    "ai_analysis_viewed",
    "revision_requested",
    "revision_generated",
    "revision_failed",
    "revision_accepted",
    "revision_rejected",
}

ALLOWED_ANALYTICS_SECTIONS = {
    "paragraph_length",
    "sentence_length",
    "transition_words",
    "repetition",
    "document_structure",
}

ALLOWED_REVISION_ACTIONS = {
    "improve_clarity",
    "improve_academic_tone",
    "improve_transition",
    "adjust_paragraph_length",
    "improve_sentence_length",
}

ALLOWED_FAILURE_CATEGORIES = {
    "timeout",
    "rate_limit",
    "authentication",
    "validation",
    "network",
    "stale",
    "unknown",
}

FORBIDDEN_PAYLOAD_KEYS = {
    "apiKey",
    "api_key",
    "prompt",
    "systemPrompt",
    "developerPrompt",
    "fullPrompt",
    "response",
    "rawResponse",
    "modelResponse",
    "paragraphText",
    "sourceText",
    "selectedText",
    "previousParagraph",
    "nextParagraph",
    "revisedText",
    "finalText",
    "text",
    "context",
    "stack",
    "traceback",
}


class StudyTaskConfig(BaseModel):
    participantId: ParticipantId = Field(min_length=3, max_length=8)
    condition: StudyCondition
    textId: StudyTextId
    taskOrder: StudyTaskOrder

    @field_validator("participantId")
    @classmethod
    def validate_participant_id(cls, value: str) -> str:
        if not re.fullmatch(r"P\d{2,}", value):
            raise ValueError("Participant ID must use the format P01, P02, P03, ...")
        return value


class StudyTaskContext(StudyTaskConfig):
    sessionId: str = Field(min_length=1)
    studyVersion: Literal["1.0"] = STUDY_VERSION


class StudyTaskStartResponse(BaseModel):
    task: StudyTaskContext
    studyText: str
    filename: str


class StudyEventRequest(BaseModel):
    task: StudyTaskContext
    sequenceNumber: int = Field(ge=2)
    event: StudyEventType
    payload: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_event_scope(self) -> "StudyEventRequest":
        validate_event_allowed_for_condition(self.task.condition, self.event)
        validate_payload_is_sanitized(self.payload)
        validate_event_payload(self.event, self.payload)
        return self


class StudyEventResponse(BaseModel):
    ok: bool
    sequenceNumber: int


class TaskRevisionSummary(BaseModel):
    initialWordCount: int = Field(ge=0)
    finalWordCount: int = Field(ge=0)
    changedParagraphCount: int = Field(ge=0)
    addedWordEstimate: int | None = Field(default=None, ge=0)
    removedWordEstimate: int | None = Field(default=None, ge=0)


class StudyTaskFinishRequest(BaseModel):
    task: StudyTaskContext
    summarySequenceNumber: int = Field(ge=2)
    finishedSequenceNumber: int = Field(ge=3)
    finalText: str = Field(max_length=500_000)
    summary: TaskRevisionSummary

    @model_validator(mode="after")
    def validate_sequence_order(self) -> "StudyTaskFinishRequest":
        if self.finishedSequenceNumber <= self.summarySequenceNumber:
            raise ValueError("finishedSequenceNumber must be greater than summarySequenceNumber.")
        return self


class StudyTaskFinishResponse(BaseModel):
    ok: bool
    finalTextPath: str
    logPath: str


def start_study_task(config: StudyTaskConfig) -> StudyTaskStartResponse:
    text_path = study_text_path(config.textId)
    if not text_path.exists():
        raise StudyDataError(f"Study text {config.textId} is not available.")

    study_text = text_path.read_text(encoding="utf-8")
    task = StudyTaskContext(
        participantId=config.participantId,
        condition=config.condition,
        textId=config.textId,
        taskOrder=config.taskOrder,
        sessionId=create_session_id(config.participantId),
        studyVersion=STUDY_VERSION,
    )
    write_study_event(task, 1, "task_started", {})
    return StudyTaskStartResponse(task=task, studyText=study_text, filename=text_path.name)


def log_study_event(request: StudyEventRequest) -> StudyEventResponse:
    write_study_event(request.task, request.sequenceNumber, request.event, request.payload)
    return StudyEventResponse(ok=True, sequenceNumber=request.sequenceNumber)


def finish_study_task(request: StudyTaskFinishRequest) -> StudyTaskFinishResponse:
    log_path = study_log_path(request.task)
    final_text_path = study_final_text_path(request.task)
    if final_text_path.exists():
        raise StudyDataError("This study task has already been finished.")

    write_study_event(
        request.task,
        request.summarySequenceNumber,
        "task_revision_summary",
        request.summary.model_dump(exclude_none=True),
    )
    final_text_path.parent.mkdir(parents=True, exist_ok=True)
    final_text_path.write_text(request.finalText, encoding="utf-8")
    write_study_event(request.task, request.finishedSequenceNumber, "task_finished", {})
    return StudyTaskFinishResponse(ok=True, finalTextPath=str(final_text_path), logPath=str(log_path))


def write_study_event(
    task: StudyTaskContext,
    sequence_number: int,
    event: StudyEventType,
    payload: dict[str, Any],
) -> None:
    validate_event_allowed_for_condition(task.condition, event)
    validate_payload_is_sanitized(payload)
    validate_event_payload(event, payload)
    log_path = study_log_path(task)
    validate_sequence_is_monotonic(log_path, sequence_number)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "timestamp": datetime.now().astimezone().isoformat(timespec="milliseconds"),
        "sequenceNumber": sequence_number,
        "participantId": task.participantId,
        "sessionId": task.sessionId,
        "condition": task.condition,
        "textId": task.textId,
        "taskOrder": task.taskOrder,
        "studyVersion": task.studyVersion,
        "event": event,
        "payload": payload,
    }
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def validate_sequence_is_monotonic(log_path: Path, sequence_number: int) -> None:
    if not log_path.exists():
        return

    last_sequence_number: int | None = None
    for line in log_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        raw_sequence_number = record.get("sequenceNumber")
        if isinstance(raw_sequence_number, int):
            last_sequence_number = raw_sequence_number

    if last_sequence_number is not None and sequence_number <= last_sequence_number:
        raise ValueError("Study event sequence numbers must increase monotonically.")


def validate_event_allowed_for_condition(condition: StudyCondition, event: StudyEventType) -> None:
    if condition == "A" and event in AI_ONLY_EVENTS:
        raise ValueError("AI events are only valid for Condition B.")


def validate_payload_is_sanitized(payload: dict[str, Any]) -> None:
    forbidden_key = find_forbidden_payload_key(payload)
    if forbidden_key:
        raise ValueError(f"Study event payload contains forbidden key: {forbidden_key}")


def validate_event_payload(event: StudyEventType, payload: dict[str, Any]) -> None:
    if event == "analytics_section_expanded":
        require_allowed_value(payload, "section", ALLOWED_ANALYTICS_SECTIONS, event)
    elif event == "transition_highlight_applied":
        require_non_empty_string(payload, "category", event)
    elif event == "repetition_highlight_applied":
        require_non_empty_string(payload, "term", event)
    elif event == "paragraph_navigation_used":
        require_non_empty_string(payload, "paragraphId", event)
    elif event == "structure_navigation_used":
        require_non_empty_string(payload, "headingId", event)
    elif event in {"ai_analysis_completed", "ai_analysis_viewed"}:
        require_non_empty_string(payload, "paragraphId", event)
    elif event in {"revision_requested", "revision_generated", "revision_failed", "revision_accepted", "revision_rejected"}:
        require_non_empty_string(payload, "paragraphId", event)
        require_allowed_value(payload, "action", ALLOWED_REVISION_ACTIONS, event)
        if event == "revision_failed":
            require_allowed_value(payload, "category", ALLOWED_FAILURE_CATEGORIES, event)


def require_non_empty_string(payload: dict[str, Any], key: str, event: StudyEventType) -> None:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Study event {event} requires payload.{key}.")


def require_allowed_value(payload: dict[str, Any], key: str, allowed_values: set[str], event: StudyEventType) -> None:
    value = payload.get(key)
    if value not in allowed_values:
        raise ValueError(f"Study event {event} has unsupported payload.{key}.")


def find_forbidden_payload_key(value: Any) -> str | None:
    if isinstance(value, dict):
        for key, nested_value in value.items():
            if key in FORBIDDEN_PAYLOAD_KEYS:
                return key
            nested = find_forbidden_payload_key(nested_value)
            if nested:
                return nested
    elif isinstance(value, list):
        for item in value:
            nested = find_forbidden_payload_key(item)
            if nested:
                return nested
    return None


def study_text_path(text_id: StudyTextId) -> Path:
    filename = "text-x.txt" if text_id == "X" else "text-y.txt"
    return STUDY_MATERIALS_DIR / filename


def study_log_path(task: StudyTaskContext) -> Path:
    return STUDY_LOG_DIR / f"{safe_task_stem(task)}_events.jsonl"


def study_final_text_path(task: StudyTaskContext) -> Path:
    return STUDY_REVISED_TEXT_DIR / f"{safe_task_stem(task)}_final.txt"


def safe_task_stem(task: StudyTaskContext) -> str:
    return f"{task.participantId}_{task.condition}_{task.textId}_task{task.taskOrder}_{safe_session_id(task.sessionId)}"


def safe_session_id(session_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "-", session_id).strip("-")


def create_session_id(participant_id: ParticipantId) -> str:
    timestamp = datetime.now().astimezone().strftime("%Y%m%d-%H%M%S-%f")
    return f"S-{participant_id}-{timestamp}"


class StudyDataError(RuntimeError):
    pass
