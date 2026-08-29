from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path
import re
import secrets
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from .config import BACKEND_ROOT, get_settings


STUDY_VERSION = "1.0"
V4_ROOT = BACKEND_ROOT.parent
STUDY_MATERIALS_DIR = V4_ROOT / "study-materials"
STUDY_DATA_DIR = get_settings().study_data_dir
STUDY_ASSIGNMENT_DIR = STUDY_DATA_DIR / "assignments"
STUDY_LOG_DIR = STUDY_DATA_DIR / "logs"
STUDY_REVISED_TEXT_DIR = STUDY_DATA_DIR / "revised-texts"

ParticipantId = str
StudyCondition = Literal["A", "B"]
StudyTextId = Literal["X", "Y"]
StudyTaskOrder = Literal[1, 2]
StudyTaskStatus = Literal["unused", "active", "completed"]

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

TOKEN_PATTERN = re.compile(r"^t_[A-Za-z0-9_-]{16,}$")
EVENT_ID_PATTERN = re.compile(r"^ev_[A-Za-z0-9_-]{8,}$")


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


class RemoteStudyAssignment(StudyTaskConfig):
    token: str
    status: StudyTaskStatus = "unused"
    studyVersion: Literal["1.0"] = STUDY_VERSION
    sessionId: str | None = None
    documentId: str | None = None
    createdAt: str
    startedAt: str | None = None
    completedAt: str | None = None

    @field_validator("token")
    @classmethod
    def validate_token(cls, value: str) -> str:
        if not TOKEN_PATTERN.fullmatch(value):
            raise ValueError("Study task token is invalid.")
        return value


class RemoteStudyClientTask(BaseModel):
    token: str
    status: Literal["active"] = "active"
    condition: StudyCondition
    documentId: str
    studyVersion: Literal["1.0"] = STUDY_VERSION


class RemoteStudyTaskStatusResponse(BaseModel):
    status: StudyTaskStatus
    task: RemoteStudyClientTask | None = None
    studyText: str | None = None
    filename: str | None = None


class RemoteStudyTaskStartResponse(BaseModel):
    task: RemoteStudyClientTask
    studyText: str
    filename: str


class RemoteStudyEventRequest(BaseModel):
    eventId: str
    sequenceNumber: int = Field(ge=2)
    event: StudyEventType
    payload: dict[str, Any] = Field(default_factory=dict)

    @field_validator("eventId")
    @classmethod
    def validate_event_id(cls, value: str) -> str:
        if not EVENT_ID_PATTERN.fullmatch(value):
            raise ValueError("Study event ID is invalid.")
        return value

    @model_validator(mode="after")
    def validate_payload(self) -> "RemoteStudyEventRequest":
        validate_payload_is_sanitized(self.payload)
        validate_event_payload(self.event, self.payload)
        return self


class StudyEventResponse(BaseModel):
    ok: bool
    eventId: str
    sequenceNumber: int
    duplicate: bool = False


class TaskRevisionSummary(BaseModel):
    initialWordCount: int = Field(ge=0)
    finalWordCount: int = Field(ge=0)
    changedParagraphCount: int = Field(ge=0)
    addedWordEstimate: int | None = Field(default=None, ge=0)
    removedWordEstimate: int | None = Field(default=None, ge=0)


class RemoteStudyTaskFinishRequest(BaseModel):
    summaryEventId: str
    finishedEventId: str
    summarySequenceNumber: int = Field(ge=2)
    finishedSequenceNumber: int = Field(ge=3)
    finalText: str = Field(max_length=500_000)
    summary: TaskRevisionSummary

    @field_validator("summaryEventId", "finishedEventId")
    @classmethod
    def validate_event_id(cls, value: str) -> str:
        if not EVENT_ID_PATTERN.fullmatch(value):
            raise ValueError("Study event ID is invalid.")
        return value

    @model_validator(mode="after")
    def validate_sequence_order(self) -> "RemoteStudyTaskFinishRequest":
        if self.finishedSequenceNumber <= self.summarySequenceNumber:
            raise ValueError("finishedSequenceNumber must be greater than summarySequenceNumber.")
        if self.finishedEventId == self.summaryEventId:
            raise ValueError("Finish event IDs must be distinct.")
        return self


class StudyTaskFinishResponse(BaseModel):
    ok: bool
    status: Literal["completed"] = "completed"


class StudyLinkAssignment(BaseModel):
    taskOrder: StudyTaskOrder
    token: str
    url: str
    assignmentPath: str


def create_remote_study_assignment(config: StudyTaskConfig, token: str | None = None) -> RemoteStudyAssignment:
    token = token or create_task_token()
    assignment = RemoteStudyAssignment(
        token=token,
        participantId=config.participantId,
        condition=config.condition,
        textId=config.textId,
        taskOrder=config.taskOrder,
        createdAt=current_timestamp(),
    )
    path = assignment_path(token)
    if path.exists():
        raise StudyDataError("A study assignment already exists for this token.")
    write_assignment(assignment)
    return assignment


def create_counterbalanced_study_links(
    participant_id: ParticipantId,
    task1_condition: StudyCondition,
    task1_text: StudyTextId,
    task2_condition: StudyCondition,
    task2_text: StudyTextId,
    base_url: str,
) -> list[StudyLinkAssignment]:
    assignments = [
        create_remote_study_assignment(
            StudyTaskConfig(
                participantId=participant_id,
                condition=task1_condition,
                textId=task1_text,
                taskOrder=1,
            )
        ),
        create_remote_study_assignment(
            StudyTaskConfig(
                participantId=participant_id,
                condition=task2_condition,
                textId=task2_text,
                taskOrder=2,
            )
        ),
    ]
    return [
        StudyLinkAssignment(
            taskOrder=assignment.taskOrder,
            token=assignment.token,
            url=study_url_for_token(base_url, assignment.token),
            assignmentPath=str(assignment_path(assignment.token)),
        )
        for assignment in assignments
    ]


def get_remote_study_task_status(token: str) -> RemoteStudyTaskStatusResponse:
    assignment = read_assignment(token)
    if assignment.status == "unused":
        return RemoteStudyTaskStatusResponse(status="unused")
    if assignment.status == "completed":
        return RemoteStudyTaskStatusResponse(status="completed")
    return active_task_response(assignment)


def start_remote_study_task(token: str) -> RemoteStudyTaskStartResponse:
    assignment = read_assignment(token)
    if assignment.status == "completed":
        raise StudyTaskCompletedError("This study task has already been completed.")

    if assignment.status == "unused":
        assignment.status = "active"
        assignment.sessionId = create_session_id(assignment.participantId)
        assignment.documentId = create_document_id()
        assignment.startedAt = current_timestamp()
        write_assignment(assignment)
        context = task_context_from_assignment(assignment)
        write_study_event(context, 1, "task_started", {}, event_id="ev_task_started")

    response = active_task_response(assignment)
    if response.task is None or response.studyText is None or response.filename is None:
        raise StudyDataError("Study task could not be started.")
    return RemoteStudyTaskStartResponse(task=response.task, studyText=response.studyText, filename=response.filename)


def log_remote_study_event(token: str, request: RemoteStudyEventRequest) -> StudyEventResponse:
    assignment = read_assignment(token)
    context = task_context_from_assignment(assignment)
    log_path = study_log_path(context)
    if event_id_exists(log_path, request.eventId):
        return StudyEventResponse(
            ok=True,
            eventId=request.eventId,
            sequenceNumber=request.sequenceNumber,
            duplicate=True,
        )
    if assignment.status != "active":
        raise StudyTaskStateError("This study task is not active.")

    appended = write_study_event(
        context,
        request.sequenceNumber,
        request.event,
        request.payload,
        event_id=request.eventId,
    )
    return StudyEventResponse(
        ok=True,
        eventId=request.eventId,
        sequenceNumber=request.sequenceNumber,
        duplicate=not appended,
    )


def finish_remote_study_task(token: str, request: RemoteStudyTaskFinishRequest) -> StudyTaskFinishResponse:
    assignment = read_assignment(token)
    context = task_context_from_assignment(assignment)
    log_path = study_log_path(context)
    final_text_path = study_final_text_path(context)

    if assignment.status == "completed":
        return StudyTaskFinishResponse(ok=True)
    if assignment.status != "active":
        raise StudyTaskStateError("This study task is not active.")

    write_study_event(
        context,
        request.summarySequenceNumber,
        "task_revision_summary",
        request.summary.model_dump(exclude_none=True),
        event_id=request.summaryEventId,
    )
    final_text_path.parent.mkdir(parents=True, exist_ok=True)
    final_text_path.write_text(request.finalText, encoding="utf-8")
    write_study_event(
        context,
        request.finishedSequenceNumber,
        "task_finished",
        {},
        event_id=request.finishedEventId,
    )
    assignment.status = "completed"
    assignment.completedAt = current_timestamp()
    write_assignment(assignment)
    return StudyTaskFinishResponse(ok=True)


def active_task_response(assignment: RemoteStudyAssignment) -> RemoteStudyTaskStatusResponse:
    if assignment.documentId is None or assignment.sessionId is None:
        raise StudyDataError("Active study task is missing session metadata.")

    text_path = study_text_path(assignment.textId)
    if not text_path.exists():
        raise StudyDataError(f"Study text {assignment.textId} is not available.")

    return RemoteStudyTaskStatusResponse(
        status="active",
        task=RemoteStudyClientTask(
            token=assignment.token,
            condition=assignment.condition,
            documentId=assignment.documentId,
            studyVersion=assignment.studyVersion,
        ),
        studyText=text_path.read_text(encoding="utf-8"),
        filename=text_path.name,
    )


def task_context_from_assignment(assignment: RemoteStudyAssignment) -> StudyTaskContext:
    if assignment.sessionId is None:
        raise StudyTaskStateError("Study task has not been started.")
    return StudyTaskContext(
        participantId=assignment.participantId,
        condition=assignment.condition,
        textId=assignment.textId,
        taskOrder=assignment.taskOrder,
        sessionId=assignment.sessionId,
        studyVersion=assignment.studyVersion,
    )


def write_study_event(
    task: StudyTaskContext,
    sequence_number: int,
    event: StudyEventType,
    payload: dict[str, Any],
    event_id: str | None = None,
) -> bool:
    validate_event_allowed_for_condition(task.condition, event)
    validate_payload_is_sanitized(payload)
    validate_event_payload(event, payload)
    log_path = study_log_path(task)
    if event_id is not None and event_id_exists(log_path, event_id):
        return False
    validate_sequence_is_monotonic(log_path, sequence_number)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "timestamp": current_timestamp(),
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
    if event_id is not None:
        record["eventId"] = event_id
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
    return True


def validate_sequence_is_monotonic(log_path: Path, sequence_number: int) -> None:
    if not log_path.exists():
        return

    last_sequence_number: int | None = None
    for record in read_jsonl_records(log_path):
        raw_sequence_number = record.get("sequenceNumber")
        if isinstance(raw_sequence_number, int):
            last_sequence_number = raw_sequence_number

    if last_sequence_number is not None and sequence_number <= last_sequence_number:
        raise ValueError("Study event sequence numbers must increase monotonically.")


def event_id_exists(log_path: Path, event_id: str) -> bool:
    if not log_path.exists():
        return False
    return any(record.get("eventId") == event_id for record in read_jsonl_records(log_path))


def read_jsonl_records(log_path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for line in log_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(record, dict):
            records.append(record)
    return records


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


def read_assignment(token: str) -> RemoteStudyAssignment:
    if not TOKEN_PATTERN.fullmatch(token):
        raise StudyTokenError("This study link is not valid.")
    path = assignment_path(token)
    if not path.exists():
        raise StudyTokenError("This study link is not valid.")
    return RemoteStudyAssignment.model_validate_json(path.read_text(encoding="utf-8"))


def write_assignment(assignment: RemoteStudyAssignment) -> None:
    path = assignment_path(assignment.token)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(".tmp")
    temporary_path.write_text(assignment.model_dump_json(indent=2), encoding="utf-8")
    temporary_path.replace(path)


def assignment_path(token: str) -> Path:
    if not TOKEN_PATTERN.fullmatch(token):
        raise StudyTokenError("This study link is not valid.")
    return STUDY_ASSIGNMENT_DIR / f"{token}.json"


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


def create_task_token() -> str:
    return f"t_{secrets.token_urlsafe(18)}"


def create_document_id() -> str:
    return f"doc_{secrets.token_urlsafe(12)}"


def create_session_id(participant_id: ParticipantId) -> str:
    timestamp = datetime.now().astimezone().strftime("%Y%m%d-%H%M%S-%f")
    return f"S-{participant_id}-{timestamp}"


def current_timestamp() -> str:
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


def study_url_for_token(base_url: str, token: str) -> str:
    return f"{base_url.rstrip('/')}/study/{token}"


class StudyDataError(RuntimeError):
    pass


class StudyTokenError(StudyDataError):
    pass


class StudyTaskCompletedError(StudyDataError):
    pass


class StudyTaskStateError(StudyDataError):
    pass
