import { useCallback, useMemo, useRef, useState } from "react";
import { analyzeDocument } from "../api/aiAnalysis";
import type {
  AnalyzeDocumentRequest,
  AnalyzeDocumentResponse,
  DocumentAIBlock,
  DocumentAIRequestIdentity,
} from "../types/aiAnalysis";
import type { AnalyticsLanguage } from "../types/backendAnalytics";
import type { DocumentModel, ParagraphBlock } from "../types/document";

export const DOCUMENT_AI_ANALYSIS_VERSION = "document-v1";
export const MAX_DOCUMENT_AI_INPUT_CHARS = 24000;
export const MAX_DOCUMENT_AI_PARAGRAPHS = 80;

export type DocumentAIAnalysisStatus = "idle" | "insufficient" | "too_large" | "loading" | "success" | "error";

export interface DocumentAIAnalysisState {
  status: DocumentAIAnalysisStatus;
  data: AnalyzeDocumentResponse | null;
  message: string | null;
  isStale: boolean;
  fromCache: boolean;
  canAnalyze: boolean;
  analyze: () => void;
  reanalyze: () => void;
}

interface ReadyDocumentTarget {
  status: "ready";
  cacheKey: string;
  requestBase: Omit<AnalyzeDocumentRequest, "requestId">;
}

interface UnavailableDocumentTarget {
  status: "insufficient" | "too_large";
  message: string;
}

type DocumentTarget = ReadyDocumentTarget | UnavailableDocumentTarget;

export function useDocumentAIAnalysis(
  document: DocumentModel,
  language: AnalyticsLanguage = "English",
): DocumentAIAnalysisState {
  const [status, setStatus] = useState<DocumentAIAnalysisStatus>("idle");
  const [data, setData] = useState<AnalyzeDocumentResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const requestCounter = useRef(0);
  const latestRequest = useRef<DocumentAIRequestIdentity | null>(null);
  const cache = useRef(new Map<string, AnalyzeDocumentResponse>());
  const inFlight = useRef(false);

  const target = useMemo(() => createDocumentAIAnalysisTarget(document, language), [document, language]);
  const isStale = data !== null && data.revision !== document.revision;
  const canAnalyze = target.status === "ready" && status !== "loading";

  const runAnalysis = useCallback(
    (bypassCache: boolean) => {
      if (target.status !== "ready") {
        latestRequest.current = null;
        inFlight.current = false;
        setStatus(target.status);
        setMessage(target.message);
        setFromCache(false);
        return;
      }

      if (inFlight.current) {
        return;
      }

      if (!bypassCache) {
        const cached = cache.current.get(target.cacheKey);
        if (cached) {
          latestRequest.current = null;
          setData(cached);
          setStatus("success");
          setMessage(null);
          setFromCache(true);
          return;
        }
      }

      requestCounter.current += 1;
      const requestId = `doc-ai-${target.requestBase.revision}-${requestCounter.current}`;
      const request: AnalyzeDocumentRequest = {
        ...target.requestBase,
        requestId,
      };
      const requestIdentity: DocumentAIRequestIdentity = {
        documentId: request.documentId,
        revision: request.revision,
        requestId,
        cacheKey: target.cacheKey,
      };
      latestRequest.current = requestIdentity;
      inFlight.current = true;
      setStatus("loading");
      setMessage("Analyzing document...");
      setFromCache(false);

      analyzeDocument(request)
        .then((response) => {
          if (!shouldAcceptDocumentAIResponse(response, latestRequest.current, target.cacheKey)) {
            return;
          }

          inFlight.current = false;
          cache.current.set(target.cacheKey, response);
          setData(response);
          setStatus("success");
          setMessage(null);
          setFromCache(false);
        })
        .catch((error: unknown) => {
          if (!isCurrentDocumentAIRequest(requestIdentity, latestRequest.current)) {
            return;
          }

          inFlight.current = false;
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "AI analysis is temporarily unavailable.");
          setFromCache(false);
        });
    },
    [target],
  );

  return {
    status,
    data,
    message:
      message ??
      (target.status === "ready"
        ? "Analyze the current document to view paragraph roles, rhetorical moves, coherence, and academic tone."
        : target.message),
    isStale,
    fromCache,
    canAnalyze,
    analyze: () => runAnalysis(false),
    reanalyze: () => runAnalysis(true),
  };
}

export function createDocumentAIAnalysisTarget(
  document: DocumentModel,
  language: AnalyticsLanguage,
): DocumentTarget {
  const blocks = createDocumentAIBlocks(document);
  const proseCount = blocks.filter((block) => block.type === "paragraph").length;
  if (proseCount === 0) {
    return {
      status: "insufficient",
      message: "Add prose text to analyze this document.",
    };
  }

  if (proseCount > MAX_DOCUMENT_AI_PARAGRAPHS || documentInputCharacterCount(blocks) > MAX_DOCUMENT_AI_INPUT_CHARS) {
    return {
      status: "too_large",
      message: "This document is too large for full AI analysis. Analyze a shorter document or reduce the content.",
    };
  }

  const requestBase: Omit<AnalyzeDocumentRequest, "requestId"> = {
    documentId: document.documentId,
    revision: document.revision,
    language,
    blocks,
  };

  return {
    status: "ready",
    requestBase,
    cacheKey: createDocumentAIAnalysisCacheKey(requestBase),
  };
}

export function createDocumentAIBlocks(document: DocumentModel): DocumentAIBlock[] {
  let displayIndex = 0;
  return [...document.paragraphs]
    .sort((left, right) => left.order - right.order)
    .flatMap((block): DocumentAIBlock[] => {
      const text = block.text.replace(/\s+/g, " ").trim();
      if (!text) {
        return [];
      }

      if (isHeadingBlock(block)) {
        return [
          {
            type: "heading",
            nodeId: block.id,
            order: block.order,
            text,
            headingLevel: normalizeHeadingLevel(block.headingLevel),
            blockType: "heading",
          },
        ];
      }

      if (isProseParagraph(block)) {
        displayIndex += 1;
        return [
          {
            type: "paragraph",
            paragraphId: block.id,
            order: block.order,
            displayIndex,
            text,
            blockType: "paragraph",
          },
        ];
      }

      return [];
    });
}

export function shouldAcceptDocumentAIResponse(
  response: AnalyzeDocumentResponse,
  latest: DocumentAIRequestIdentity | null,
  cacheKey: string,
): boolean {
  return (
    latest?.documentId === response.documentId &&
    latest.revision === response.revision &&
    latest.requestId === response.requestId &&
    latest.cacheKey === cacheKey
  );
}

export function createDocumentAIAnalysisCacheKey(request: Omit<AnalyzeDocumentRequest, "requestId">): string {
  return [
    DOCUMENT_AI_ANALYSIS_VERSION,
    request.documentId,
    request.language,
    ...request.blocks.map((block) =>
      [
        block.type,
        "nodeId" in block ? block.nodeId : "",
        "paragraphId" in block ? block.paragraphId : "",
        "headingLevel" in block ? block.headingLevel : "",
        "displayIndex" in block ? block.displayIndex : "",
        stableHash(block.text),
      ].join("|"),
    ),
  ].join(":");
}

function isCurrentDocumentAIRequest(
  request: DocumentAIRequestIdentity,
  latest: DocumentAIRequestIdentity | null,
): boolean {
  return (
    latest?.documentId === request.documentId &&
    latest.revision === request.revision &&
    latest.requestId === request.requestId &&
    latest.cacheKey === request.cacheKey
  );
}

function isHeadingBlock(block: ParagraphBlock): boolean {
  return block.type === "heading" || block.blockType === "heading";
}

function isProseParagraph(block: ParagraphBlock): boolean {
  return block.type === "paragraph" && block.blockType === "paragraph";
}

function normalizeHeadingLevel(level: number | undefined): number {
  if (level === undefined) {
    return 1;
  }
  return Math.min(Math.max(level, 1), 3);
}

function documentInputCharacterCount(blocks: DocumentAIBlock[]): number {
  return blocks.reduce((total, block) => total + block.text.length, 0);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
