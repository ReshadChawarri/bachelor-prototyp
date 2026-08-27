import { describe, expect, it } from "vitest";
import {
  BACKEND_ANALYTICS_DEBOUNCE_MS,
  shouldAcceptBackendAnalyticsResponse,
} from "./useBackendWritingAnalytics";
import { documentAnalyticsRequest } from "../types/backendAnalytics";
import type { DocumentModel } from "../types/document";

const DOCUMENT: DocumentModel = {
  documentId: "local-draft",
  revision: 141,
  title: "Lifecycle test",
  paragraphs: [
    {
      id: "p-1",
      type: "paragraph",
      blockType: "paragraph",
      order: 0,
      text: "However, writing analytics remain local.",
    },
  ],
};

describe("backend analytics lifecycle helpers", () => {
  it("uses a debounce in the expected Phase 3B range", () => {
    expect(BACKEND_ANALYTICS_DEBOUNCE_MS).toBeGreaterThanOrEqual(500);
    expect(BACKEND_ANALYTICS_DEBOUNCE_MS).toBeLessThanOrEqual(1000);
  });

  it("creates a minimal document analytics request from the TipTap-derived document model", () => {
    const request = documentAnalyticsRequest(DOCUMENT, "analytics-141-1", "English");

    expect(request).toEqual({
      documentId: "local-draft",
      revision: 141,
      requestId: "analytics-141-1",
      language: "English",
      blocks: DOCUMENT.paragraphs,
    });
  });

  it("accepts only responses matching the latest request ID and revision", () => {
    const latest = {
      requestId: "analytics-141-2",
      revision: 141,
    };

    expect(shouldAcceptBackendAnalyticsResponse("analytics-141-2", 141, latest)).toBe(true);
    expect(shouldAcceptBackendAnalyticsResponse("analytics-140-1", 140, latest)).toBe(false);
    expect(shouldAcceptBackendAnalyticsResponse("analytics-141-1", 141, latest)).toBe(false);
    expect(shouldAcceptBackendAnalyticsResponse("analytics-141-2", 140, latest)).toBe(false);
    expect(shouldAcceptBackendAnalyticsResponse("analytics-141-2", 141, null)).toBe(false);
  });
});
