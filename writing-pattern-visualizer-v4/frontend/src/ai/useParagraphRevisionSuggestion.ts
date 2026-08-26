import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { suggestRevision } from "../api/aiAnalysis";
import { createParagraphAIAnalysisTarget } from "./useParagraphAIAnalysis";
import { paragraphContentHash } from "../editor/revision";
import type {
  ParagraphRevisionAction,
  ParagraphRevisionRequestIdentity,
  SuggestRevisionRequest,
  SuggestRevisionResponse,
} from "../types/aiAnalysis";
import type { AnalyticsLanguage } from "../types/backendAnalytics";
import type { DocumentModel, ParagraphBlock } from "../types/document";

export type ParagraphRevisionStatus = "idle" | "loading" | "success" | "error";

export interface ParagraphRevisionState {
  status: ParagraphRevisionStatus;
  suggestion: SuggestRevisionResponse | null;
  activeAction: ParagraphRevisionAction | null;
  message: string | null;
  canRequest: boolean;
  requestRevision: (action: ParagraphRevisionAction) => void;
  reject: () => void;
  clear: () => void;
}

const EMPTY_STATE: Omit<ParagraphRevisionState, "requestRevision" | "reject" | "clear"> = {
  status: "idle",
  suggestion: null,
  activeAction: null,
  message: null,
  canRequest: false,
};

export function useParagraphRevisionSuggestion(
  document: DocumentModel,
  selectedParagraph: ParagraphBlock | undefined,
  selectedParagraphId: string | null,
  language: AnalyticsLanguage = "English",
): ParagraphRevisionState {
  const [state, setState] = useState<Omit<ParagraphRevisionState, "requestRevision" | "reject" | "clear">>(EMPTY_STATE);
  const requestCounter = useRef(0);
  const latestRequest = useRef<ParagraphRevisionRequestIdentity | null>(null);
  const activeController = useRef<AbortController | null>(null);

  const target = useMemo(
    () => createParagraphAIAnalysisTarget(document, selectedParagraph, selectedParagraphId, language),
    [document, language, selectedParagraph, selectedParagraphId],
  );

  const targetKey = target.status === "ready" ? target.cacheKey : `${target.status}:${target.paragraphId ?? "none"}`;

  const clear = useCallback(() => {
    latestRequest.current = null;
    activeController.current?.abort();
    activeController.current = null;
    setState({
      ...EMPTY_STATE,
      canRequest: target.status === "ready",
    });
  }, [target.status]);

  useEffect(() => {
    clear();
  }, [clear, targetKey]);

  const requestRevision = useCallback(
    (action: ParagraphRevisionAction) => {
      if (target.status !== "ready" || state.status === "loading") {
        return;
      }

      activeController.current?.abort();
      const controller = new AbortController();
      activeController.current = controller;

      requestCounter.current += 1;
      const requestId = `revision-${document.revision}-${requestCounter.current}`;
      const sourceContentHash = paragraphContentHash(target.requestBase.paragraph.text);
      const request: SuggestRevisionRequest = {
        ...target.requestBase,
        requestId,
        action,
        sourceContentHash,
      };
      const identity: ParagraphRevisionRequestIdentity = {
        documentId: document.documentId,
        requestId,
        sourceRevision: document.revision,
        paragraphId: target.paragraphId,
        sourceContentHash,
        action,
      };

      latestRequest.current = identity;
      setState({
        status: "loading",
        suggestion: null,
        activeAction: action,
        message: "Generating revision...",
        canRequest: false,
      });

      suggestRevision(request, controller.signal)
        .then((response) => {
          if (!shouldAcceptRevisionResponse(response, latestRequest.current)) {
            return;
          }

          activeController.current = null;
          setState({
            status: "success",
            suggestion: response,
            activeAction: response.action,
            message: null,
            canRequest: true,
          });
        })
        .catch((error: unknown) => {
          if (isAbortError(error) || !isCurrentRevisionRequest(identity, latestRequest.current)) {
            return;
          }

          activeController.current = null;
          setState({
            status: "error",
            suggestion: null,
            activeAction: action,
            message: error instanceof Error ? error.message : "A revision could not be generated. Please try again.",
            canRequest: true,
          });
        });
    },
    [document.documentId, document.revision, state.status, target],
  );

  const reject = useCallback(() => {
    latestRequest.current = null;
    activeController.current?.abort();
    activeController.current = null;
    setState({
      ...EMPTY_STATE,
      canRequest: target.status === "ready",
    });
  }, [target.status]);

  return {
    ...state,
    canRequest: target.status === "ready" && state.status !== "loading",
    requestRevision,
    reject,
    clear,
  };
}

export function shouldAcceptRevisionResponse(
  response: SuggestRevisionResponse,
  latest: ParagraphRevisionRequestIdentity | null,
): boolean {
  return (
    latest?.documentId === response.documentId &&
    latest.sourceRevision === response.sourceRevision &&
    latest.requestId === response.requestId &&
    latest.paragraphId === response.paragraphId &&
    latest.sourceContentHash === response.sourceContentHash &&
    latest.action === response.action
  );
}

function isCurrentRevisionRequest(
  request: ParagraphRevisionRequestIdentity,
  latest: ParagraphRevisionRequestIdentity | null,
): boolean {
  return (
    latest?.documentId === request.documentId &&
    latest.sourceRevision === request.sourceRevision &&
    latest.requestId === request.requestId &&
    latest.paragraphId === request.paragraphId &&
    latest.sourceContentHash === request.sourceContentHash &&
    latest.action === request.action
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
