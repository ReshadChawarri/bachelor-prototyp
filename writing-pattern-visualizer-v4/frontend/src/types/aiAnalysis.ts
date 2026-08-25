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
