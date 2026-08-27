import { useEffect, useRef, useState } from "react";
import { analyzeDocument } from "../api/documentAnalytics";
import {
  documentAnalyticsRequest,
  type AnalyticsLanguage,
  type BackendAnalyticsState,
} from "../types/backendAnalytics";
import type { DocumentModel } from "../types/document";

export const BACKEND_ANALYTICS_DEBOUNCE_MS = 700;

export interface BackendAnalyticsRequestIdentity {
  requestId: string;
  revision: number;
}

export function useBackendWritingAnalytics(
  document: DocumentModel,
  language: AnalyticsLanguage = "English",
  debounceMs = BACKEND_ANALYTICS_DEBOUNCE_MS,
): BackendAnalyticsState {
  const [state, setState] = useState<BackendAnalyticsState>({
    data: null,
    loading: false,
    error: null,
  });
  const requestCounter = useRef(0);
  const latestRequest = useRef<BackendAnalyticsRequestIdentity | null>(null);

  useEffect(() => {
    if (document.paragraphs.length === 0) {
      latestRequest.current = null;
      setState({ data: null, loading: false, error: null });
      return;
    }

    requestCounter.current += 1;
    const requestId = `analytics-${document.revision}-${requestCounter.current}`;
    const request = documentAnalyticsRequest(document, requestId, language);
    latestRequest.current = {
      requestId,
      revision: document.revision,
    };
    setState((current) => ({
      data: current.data?.revision === document.revision ? current.data : null,
      loading: true,
      error: null,
    }));

    const controller = new AbortController();
    const timerId = window.setTimeout(() => {
      analyzeDocument(request, controller.signal)
        .then((response) => {
          if (!shouldAcceptBackendAnalyticsResponse(response.requestId, response.revision, latestRequest.current)) {
            return;
          }
          setState({ data: response, loading: false, error: null });
        })
        .catch((error: unknown) => {
          if (
            isAbortError(error) ||
            !shouldAcceptBackendAnalyticsResponse(requestId, document.revision, latestRequest.current)
          ) {
            return;
          }
          setState({
            data: null,
            loading: false,
            error: "Deterministic writing analytics are temporarily unavailable.",
          });
        });
    }, debounceMs);

    return () => {
      window.clearTimeout(timerId);
      controller.abort();
    };
  }, [document, language, debounceMs]);

  return state;
}

export function shouldAcceptBackendAnalyticsResponse(
  requestId: string,
  revision: number,
  latest: BackendAnalyticsRequestIdentity | null,
): boolean {
  return latest?.requestId === requestId && latest.revision === revision;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
