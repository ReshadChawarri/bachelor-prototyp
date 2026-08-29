export const STUDY_VERSION = "1.0";

export type StudyCondition = "A" | "B";
export type StudyTaskStatus = "unused" | "active" | "completed";

export interface RemoteStudyClientTask {
  token: string;
  status: "active";
  condition: StudyCondition;
  documentId: string;
  studyVersion: typeof STUDY_VERSION;
}

export interface RemoteStudyTaskStatusResponse {
  status: StudyTaskStatus;
  task: RemoteStudyClientTask | null;
  studyText: string | null;
  filename: string | null;
}

export interface StudyTaskStartResponse {
  task: RemoteStudyClientTask;
  studyText: string;
  filename: string;
}

export type StudyEventType =
  | "analytics_section_expanded"
  | "transition_highlight_applied"
  | "repetition_highlight_applied"
  | "paragraph_navigation_used"
  | "structure_navigation_used"
  | "ai_analysis_completed"
  | "revision_requested"
  | "revision_generated"
  | "revision_failed"
  | "revision_accepted"
  | "revision_rejected";

export type RevisionFailureCategory =
  | "timeout"
  | "rate_limit"
  | "authentication"
  | "validation"
  | "network"
  | "stale"
  | "unknown";

export type StudyEventPayload = Record<string, unknown>;

export interface StudyEventRequest {
  eventId: string;
  sequenceNumber: number;
  event: StudyEventType;
  payload: StudyEventPayload;
}

export interface TaskRevisionSummary {
  initialWordCount: number;
  finalWordCount: number;
  changedParagraphCount: number;
  addedWordEstimate?: number;
  removedWordEstimate?: number;
}

export interface StudyTaskFinishRequest {
  summaryEventId: string;
  finishedEventId: string;
  summarySequenceNumber: number;
  finishedSequenceNumber: number;
  finalText: string;
  summary: TaskRevisionSummary;
}

export interface StudyTaskFinishResponse {
  ok: boolean;
  status: "completed";
}

export type StudyEventLogger = (event: StudyEventType, payload?: StudyEventPayload) => void;
