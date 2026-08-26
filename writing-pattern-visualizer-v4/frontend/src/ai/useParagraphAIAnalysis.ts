import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyzeParagraph } from "../api/aiAnalysis";
import type { AnalyzeParagraphRequest, AnalyzeParagraphResponse, ParagraphAIRequestIdentity } from "../types/aiAnalysis";
import type { AnalyticsLanguage } from "../types/backendAnalytics";
import type { DocumentModel, ParagraphBlock } from "../types/document";

export const PARAGRAPH_AI_ANALYSIS_VERSION = "paragraph-v1";
export const AI_ANALYSIS_DEBOUNCE_MS = 1400;
export const MIN_AI_ANALYSIS_WORDS = 4;

export type ParagraphAIAnalysisStatus = "idle" | "insufficient" | "loading" | "success" | "error";

export interface ParagraphAIAnalysisState {
  status: ParagraphAIAnalysisStatus;
  data: AnalyzeParagraphResponse | null;
  message: string | null;
  paragraphId: string | null;
  displayLabel: string | null;
  fromCache: boolean;
  reanalyze: () => void;
}

interface ReadyParagraphTarget {
  status: "ready";
  paragraphId: string;
  displayLabel: string;
  cacheKey: string;
  requestBase: Omit<AnalyzeParagraphRequest, "requestId">;
}

interface UnavailableParagraphTarget {
  status: "idle" | "insufficient";
  paragraphId: string | null;
  displayLabel: string | null;
  message: string;
}

type ParagraphTarget = ReadyParagraphTarget | UnavailableParagraphTarget;

const EMPTY_STATE: Omit<ParagraphAIAnalysisState, "reanalyze"> = {
  status: "idle",
  data: null,
  message: "Select a paragraph to view AI writing analysis.",
  paragraphId: null,
  displayLabel: null,
  fromCache: false,
};

export function useParagraphAIAnalysis(
  document: DocumentModel,
  selectedParagraph: ParagraphBlock | undefined,
  selectedParagraphId: string | null,
  language: AnalyticsLanguage = "English",
  debounceMs = AI_ANALYSIS_DEBOUNCE_MS,
  enabled = true,
): ParagraphAIAnalysisState {
  const [state, setState] = useState<Omit<ParagraphAIAnalysisState, "reanalyze">>(EMPTY_STATE);
  const [reanalyzeNonce, setReanalyzeNonce] = useState(0);
  const requestCounter = useRef(0);
  const latestRequest = useRef<ParagraphAIRequestIdentity | null>(null);
  const cache = useRef(new Map<string, AnalyzeParagraphResponse>());

  const target = useMemo(
    () => createParagraphAIAnalysisTarget(document, selectedParagraph, selectedParagraphId, language),
    [document, language, selectedParagraph, selectedParagraphId],
  );

  const reanalyze = useCallback(() => {
    if (target.status === "ready") {
      cache.current.delete(target.cacheKey);
      setReanalyzeNonce((nonce) => nonce + 1);
    }
  }, [target]);

  useEffect(() => {
    if (!enabled) {
      latestRequest.current = null;
      setState(EMPTY_STATE);
      return;
    }

    if (target.status !== "ready") {
      latestRequest.current = null;
      setState({
        status: target.status,
        data: null,
        message: target.message,
        paragraphId: target.paragraphId,
        displayLabel: target.displayLabel,
        fromCache: false,
      });
      return;
    }

    const cached = cache.current.get(target.cacheKey);
    if (cached?.revision === document.revision && cached.paragraphId === target.paragraphId) {
      latestRequest.current = null;
      setState({
        status: "success",
        data: cached,
        message: null,
        paragraphId: target.paragraphId,
        displayLabel: target.displayLabel,
        fromCache: true,
      });
      return;
    }

    requestCounter.current += 1;
    const requestId = `ai-${document.revision}-${requestCounter.current}`;
    const request: AnalyzeParagraphRequest = {
      ...target.requestBase,
      requestId,
    };
    const requestIdentity: ParagraphAIRequestIdentity = {
      documentId: document.documentId,
      revision: document.revision,
      requestId,
      paragraphId: target.paragraphId,
      cacheKey: target.cacheKey,
    };
    latestRequest.current = requestIdentity;
    setState({
      status: "loading",
      data: null,
      message: "Analyzing paragraph...",
      paragraphId: target.paragraphId,
      displayLabel: target.displayLabel,
      fromCache: false,
    });

    const controller = new AbortController();
    const timerId = window.setTimeout(() => {
      analyzeParagraph(request, controller.signal)
        .then((response) => {
          if (!shouldAcceptParagraphAIResponse(response, latestRequest.current, target.cacheKey)) {
            return;
          }

          cache.current.set(target.cacheKey, response);
          setState({
            status: "success",
            data: response,
            message: null,
            paragraphId: target.paragraphId,
            displayLabel: target.displayLabel,
            fromCache: false,
          });
        })
        .catch((error: unknown) => {
          if (isAbortError(error) || !isCurrentParagraphAIRequest(requestIdentity, latestRequest.current)) {
            return;
          }

          setState({
            status: "error",
            data: null,
            message: error instanceof Error ? error.message : "AI analysis is temporarily unavailable.",
            paragraphId: target.paragraphId,
            displayLabel: target.displayLabel,
            fromCache: false,
          });
        });
    }, debounceMs);

    return () => {
      window.clearTimeout(timerId);
      controller.abort();
    };
  }, [document.documentId, document.revision, debounceMs, enabled, reanalyzeNonce, target]);

  return {
    ...state,
    reanalyze,
  };
}

export function createParagraphAIAnalysisTarget(
  document: DocumentModel,
  selectedParagraph: ParagraphBlock | undefined,
  selectedParagraphId: string | null,
  language: AnalyticsLanguage,
): ParagraphTarget {
  if (!selectedParagraphId || !selectedParagraph || !isProseParagraph(selectedParagraph)) {
    return {
      status: "idle",
      paragraphId: selectedParagraphId,
      displayLabel: null,
      message: "Select a paragraph to view AI writing analysis.",
    };
  }

  const displayLabel = displayLabelForParagraph(document, selectedParagraph.id) ?? "Selected paragraph";
  if (meaningfulWordCount(selectedParagraph.text) < MIN_AI_ANALYSIS_WORDS) {
    return {
      status: "insufficient",
      paragraphId: selectedParagraph.id,
      displayLabel,
      message: "Add more text to analyze this paragraph.",
    };
  }

  const sortedBlocks = [...document.paragraphs].sort((left, right) => left.order - right.order);
  const selectedIndex = sortedBlocks.findIndex((block) => block.id === selectedParagraph.id);
  const nearestHeading = [...sortedBlocks.slice(0, selectedIndex)]
    .reverse()
    .find((block) => block.type === "heading" || block.blockType === "heading")?.text;
  const previousParagraph = [...sortedBlocks.slice(0, selectedIndex)].reverse().find(isProseParagraph)?.text;
  const nextParagraph = sortedBlocks.slice(selectedIndex + 1).find(isProseParagraph)?.text;

  const requestBase: Omit<AnalyzeParagraphRequest, "requestId"> = {
    documentId: document.documentId,
    revision: document.revision,
    language,
    paragraph: {
      paragraphId: selectedParagraph.id,
      text: selectedParagraph.text,
    },
    context: {
      nearestHeading: nearestHeading ?? null,
      previousParagraph: previousParagraph ?? null,
      nextParagraph: nextParagraph ?? null,
    },
  };

  return {
    status: "ready",
    paragraphId: selectedParagraph.id,
    displayLabel,
    requestBase,
    cacheKey: createParagraphAIAnalysisCacheKey(requestBase),
  };
}

export function shouldAcceptParagraphAIResponse(
  response: AnalyzeParagraphResponse,
  latest: ParagraphAIRequestIdentity | null,
  cacheKey: string,
): boolean {
  return (
    latest?.documentId === response.documentId &&
    latest.revision === response.revision &&
    latest.requestId === response.requestId &&
    latest.paragraphId === response.paragraphId &&
    latest.cacheKey === cacheKey
  );
}

export function createParagraphAIAnalysisCacheKey(request: Omit<AnalyzeParagraphRequest, "requestId">): string {
  return [
    PARAGRAPH_AI_ANALYSIS_VERSION,
    request.documentId,
    request.language,
    request.paragraph.paragraphId,
    stableHash(request.paragraph.text),
    stableHash(request.context.nearestHeading ?? ""),
    stableHash(request.context.previousParagraph ?? ""),
    stableHash(request.context.nextParagraph ?? ""),
  ].join(":");
}

export function displayLabelForParagraph(document: DocumentModel, paragraphId: string): string | null {
  const proseParagraphs = [...document.paragraphs]
    .sort((left, right) => left.order - right.order)
    .filter(isProseParagraph);
  const index = proseParagraphs.findIndex((paragraph) => paragraph.id === paragraphId);
  return index === -1 ? null : `P${index + 1}`;
}

function isCurrentParagraphAIRequest(
  request: ParagraphAIRequestIdentity,
  latest: ParagraphAIRequestIdentity | null,
): boolean {
  return (
    latest?.documentId === request.documentId &&
    latest.revision === request.revision &&
    latest.requestId === request.requestId &&
    latest.paragraphId === request.paragraphId &&
    latest.cacheKey === request.cacheKey
  );
}

function isProseParagraph(block: ParagraphBlock): boolean {
  return block.type === "paragraph" && block.blockType === "paragraph";
}

function meaningfulWordCount(text: string): number {
  return text.trim().match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
