import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { suggestRevision } from "../api/aiAnalysis";
import type { SuggestRevisionRequest, SuggestRevisionResponse } from "../types/aiAnalysis";
import type { DocumentModel, ParagraphBlock } from "../types/document";
import { useParagraphRevisionSuggestion } from "./useParagraphRevisionSuggestion";

vi.mock("../api/aiAnalysis", () => ({
  suggestRevision: vi.fn(),
}));

const mockedSuggestRevision = vi.mocked(suggestRevision);

const paragraph: ParagraphBlock = {
  id: "p-1",
  type: "paragraph",
  blockType: "paragraph",
  order: 0,
  text: "Academic writing interfaces can support reflection by making revision patterns visible.",
};

const document: DocumentModel = {
  documentId: "study-doc",
  revision: 4,
  title: "Study document",
  paragraphs: [paragraph],
};

function responseFor(request: SuggestRevisionRequest): SuggestRevisionResponse {
  return {
    documentId: request.documentId,
    sourceRevision: request.revision,
    requestId: request.requestId,
    paragraphId: request.paragraph.paragraphId,
    sourceContentHash: request.sourceContentHash,
    action: request.action,
    model: "gpt-5.6-luna",
    revisionVersion: "paragraph-revision-v1",
    suggestion: {
      revisedText: "Academic writing interfaces support reflection by making revision patterns visible.",
      summary: "Condenses the phrasing while preserving the central meaning.",
    },
  };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useParagraphRevisionSuggestion Study Mode callbacks", () => {
  beforeEach(() => {
    mockedSuggestRevision.mockImplementation(async (request) => responseFor(request));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reports generated revisions without mutating document state", async () => {
    const onRequestGenerated = vi.fn();
    const { result } = renderHook(() =>
      useParagraphRevisionSuggestion(document, paragraph, "p-1", "English", true, { onRequestGenerated }),
    );

    act(() => result.current.requestRevision("improve_clarity"));
    await flushPromises();

    expect(mockedSuggestRevision).toHaveBeenCalledTimes(1);
    expect(onRequestGenerated).toHaveBeenCalledWith(
      expect.objectContaining({
        paragraphId: "p-1",
        action: "improve_clarity",
      }),
      expect.any(Number),
    );
  });

  it("reports failed revisions with sanitized error handling and remains disabled when requested", async () => {
    mockedSuggestRevision.mockRejectedValueOnce(new Error("rate limit exceeded"));
    const onRequestFailed = vi.fn();
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useParagraphRevisionSuggestion(document, paragraph, "p-1", "English", enabled, { onRequestFailed }),
      {
        initialProps: { enabled: true },
      },
    );

    act(() => result.current.requestRevision("improve_transition"));
    await flushPromises();

    expect(onRequestFailed).toHaveBeenCalledWith(
      { paragraphId: "p-1", action: "improve_transition" },
      expect.any(Error),
      expect.any(Number),
    );

    rerender({ enabled: false });
    act(() => result.current.requestRevision("improve_clarity"));
    await flushPromises();
    expect(mockedSuggestRevision).toHaveBeenCalledTimes(1);
  });
});
