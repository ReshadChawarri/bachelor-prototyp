export const STUDY_VERSION = "1.0";

export type StudyCondition = "A" | "B";
export type StudyTextId = "X" | "Y";
export type StudyTaskOrder = 1 | 2;

export interface StudyTaskConfig {
  participantId: string;
  condition: StudyCondition;
  textId: StudyTextId;
  taskOrder: StudyTaskOrder;
}

export interface StudyTaskContext extends StudyTaskConfig {
  sessionId: string;
  studyVersion: typeof STUDY_VERSION;
}

export interface StudyTaskStartResponse {
  task: StudyTaskContext;
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
  task: StudyTaskContext;
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
  task: StudyTaskContext;
  summarySequenceNumber: number;
  finishedSequenceNumber: number;
  finalText: string;
  summary: TaskRevisionSummary;
}

export interface StudyTaskFinishResponse {
  ok: boolean;
  finalTextPath: string;
  logPath: string;
}

export type StudyEventLogger = (event: StudyEventType, payload?: StudyEventPayload) => void;
