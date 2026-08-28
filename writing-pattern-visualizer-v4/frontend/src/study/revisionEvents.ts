import type { SuggestRevisionRequest, SuggestRevisionResponse } from "../types/aiAnalysis";
import type { StudyEventPayload, RevisionFailureCategory } from "./types";

const WORD_PATTERN = /[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu;
const SENTENCE_PATTERN = /[^.!?]+[.!?]+|[^.!?]+$/g;

export function revisionRequestedPayload(request: SuggestRevisionRequest): StudyEventPayload {
  const payload: StudyEventPayload = {
    paragraphId: request.paragraph.paragraphId,
    action: request.action,
  };

  if (request.action === "adjust_paragraph_length" && request.targetWordCount !== undefined) {
    payload.currentWordCount = countWords(request.paragraph.text);
    payload.targetWordCount = request.targetWordCount;
  }

  if (request.action === "improve_sentence_length") {
    const metrics = sentenceMetrics(request.paragraph.text);
    payload.originalAverageSentenceLength = metrics.averageSentenceLength;
    payload.originalVeryLongSentenceCount = metrics.veryLongSentenceCount;
  }

  return payload;
}

export function revisionGeneratedPayload(response: SuggestRevisionResponse, generationLatencyMs: number): StudyEventPayload {
  const payload: StudyEventPayload = {
    paragraphId: response.paragraphId,
    action: response.action,
    generationLatencyMs,
  };

  if (response.length) {
    payload.originalWordCount = response.length.originalWordCount;
    payload.targetWordCount = response.length.targetWordCount;
    payload.suggestedWordCount = response.length.revisedWordCount;
    payload.withinTolerance = response.length.withinTolerance;
  }

  if (response.sentence) {
    payload.originalSentenceCount = response.sentence.originalSentenceCount;
    payload.suggestedSentenceCount = response.sentence.revisedSentenceCount;
    payload.originalAverageSentenceLength = response.sentence.originalAverageSentenceLength;
    payload.suggestedAverageSentenceLength = response.sentence.revisedAverageSentenceLength;
  }

  return payload;
}

export function revisionDecisionPayload(response: SuggestRevisionResponse): StudyEventPayload {
  return {
    paragraphId: response.paragraphId,
    action: response.action,
  };
}

export function revisionFailedPayload(
  paragraphId: string,
  action: string,
  category: RevisionFailureCategory,
  generationLatencyMs?: number,
): StudyEventPayload {
  return {
    paragraphId,
    action,
    category,
    ...(generationLatencyMs !== undefined ? { generationLatencyMs } : {}),
  };
}

export function categorizeRevisionFailure(error: unknown): RevisionFailureCategory {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("timeout")) {
    return "timeout";
  }
  if (message.includes("rate") || message.includes("429")) {
    return "rate_limit";
  }
  if (message.includes("auth") || message.includes("api key") || message.includes("configured") || message.includes("401")) {
    return "authentication";
  }
  if (message.includes("validat") || message.includes("safely") || message.includes("guardrail")) {
    return "validation";
  }
  if (message.includes("network") || message.includes("fetch")) {
    return "network";
  }
  return "unknown";
}

function sentenceMetrics(text: string) {
  const sentences = (text.match(SENTENCE_PATTERN) ?? [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const wordCounts = sentences.map(countWords);
  const totalWords = wordCounts.reduce((total, count) => total + count, 0);
  return {
    averageSentenceLength: sentences.length > 0 ? Number((totalWords / sentences.length).toFixed(1)) : 0,
    veryLongSentenceCount: wordCounts.filter((count) => count > 30).length,
  };
}

function countWords(text: string): number {
  return text.match(WORD_PATTERN)?.length ?? 0;
}
