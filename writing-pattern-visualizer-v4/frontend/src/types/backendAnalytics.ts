import type { DocumentModel, ParagraphBlock } from "./document";

export type AnalyticsLanguage = "English" | "German";

export interface DocumentAnalyticsRequest {
  documentId: string;
  revision: number;
  requestId: string;
  language: AnalyticsLanguage;
  blocks: ParagraphBlock[];
}

export interface TransitionCategoryCount {
  name: string;
  count: number;
}

export interface TransitionTermCount {
  term: string;
  category: string;
  count: number;
}

export interface TransitionAnalytics {
  total: number;
  categories: TransitionCategoryCount[];
  terms: TransitionTermCount[];
}

export interface RepetitionTerm {
  term: string;
  count: number;
}

export interface RepetitionAnalytics {
  terms: RepetitionTerm[];
  minCount: number;
}

export interface StructureHeading {
  text: string;
  level: number;
  paragraphId?: string | null;
}

export interface DocumentStructureAnalytics {
  source: "explicit" | "heuristic" | "none";
  headings: StructureHeading[];
}

export interface DocumentAnalyticsResponse {
  documentId: string;
  revision: number;
  requestId: string;
  language: AnalyticsLanguage;
  transitions: TransitionAnalytics;
  repetition: RepetitionAnalytics;
  structure: DocumentStructureAnalytics;
}

export interface BackendAnalyticsState {
  data: DocumentAnalyticsResponse | null;
  loading: boolean;
  error: string | null;
}

export function documentAnalyticsRequest(
  document: DocumentModel,
  requestId: string,
  language: AnalyticsLanguage,
): DocumentAnalyticsRequest {
  return {
    documentId: document.documentId,
    revision: document.revision,
    requestId,
    language,
    blocks: document.paragraphs,
  };
}
