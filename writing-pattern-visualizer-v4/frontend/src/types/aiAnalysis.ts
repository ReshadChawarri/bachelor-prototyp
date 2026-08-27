import type { AnalyticsLanguage } from "./backendAnalytics";

export type ParagraphRoleLabel =
  | "background_context"
  | "purpose_aim"
  | "claim_argument"
  | "evidence_example"
  | "method_procedure"
  | "result_finding"
  | "interpretation_discussion"
  | "limitation"
  | "transition"
  | "conclusion"
  | "other"
  | "uncertain";

export type RhetoricalMoveLabel =
  | "background"
  | "problem"
  | "purpose"
  | "claim"
  | "support"
  | "example"
  | "contrast"
  | "method"
  | "result"
  | "interpretation"
  | "limitation"
  | "implication"
  | "transition"
  | "conclusion";

export type CoherenceLevel = "strong" | "moderate" | "needs_attention" | "insufficient_context";
export type AcademicToneLevel = "strong" | "moderate" | "needs_attention" | "insufficient_text";

export interface AnalyzeParagraphRequest {
  documentId: string;
  revision: number;
  requestId: string;
  language: AnalyticsLanguage;
  paragraph: {
    paragraphId: string;
    text: string;
  };
  context: {
    nearestHeading: string | null;
    previousParagraph: string | null;
    nextParagraph: string | null;
  };
}

export interface ParagraphAIAnalysis {
  paragraphRole: {
    label: ParagraphRoleLabel;
    rationale: string;
  };
  rhetoricalMoves: Array<{
    label: RhetoricalMoveLabel;
    rationale: string;
  }>;
  coherence: {
    level: CoherenceLevel;
    rationale: string;
  };
  academicTone: {
    level: AcademicToneLevel;
    rationale: string;
  };
  observation: string;
}

export interface AnalyzeParagraphResponse {
  documentId: string;
  revision: number;
  requestId: string;
  paragraphId: string;
  model: string;
  analysisVersion: string;
  analysis: ParagraphAIAnalysis;
}

export interface ParagraphAIRequestIdentity {
  documentId: string;
  revision: number;
  requestId: string;
  paragraphId: string;
  cacheKey: string;
}

export type ParagraphRevisionAction =
  | "improve_clarity"
  | "improve_academic_tone"
  | "improve_transition"
  | "adjust_paragraph_length";

export interface SuggestRevisionRequest {
  documentId: string;
  revision: number;
  requestId: string;
  language: AnalyticsLanguage;
  action: ParagraphRevisionAction;
  sourceContentHash: string;
  targetWordCount?: number;
  paragraph: {
    paragraphId: string;
    text: string;
  };
  context: {
    nearestHeading: string | null;
    previousParagraph: string | null;
    nextParagraph: string | null;
  };
}

export interface ParagraphRevisionSuggestion {
  revisedText: string;
  summary: string;
}

export interface LengthAdjustmentMetadata {
  originalWordCount: number;
  targetWordCount: number;
  revisedWordCount: number;
  withinTolerance: boolean;
}

export interface SuggestRevisionResponse {
  documentId: string;
  sourceRevision: number;
  requestId: string;
  paragraphId: string;
  sourceContentHash: string;
  action: ParagraphRevisionAction;
  model: string;
  revisionVersion: string;
  suggestion: ParagraphRevisionSuggestion;
  length?: LengthAdjustmentMetadata | null;
}

export interface ParagraphRevisionRequestIdentity {
  documentId: string;
  requestId: string;
  sourceRevision: number;
  paragraphId: string;
  sourceContentHash: string;
  action: ParagraphRevisionAction;
  targetWordCount?: number;
}
