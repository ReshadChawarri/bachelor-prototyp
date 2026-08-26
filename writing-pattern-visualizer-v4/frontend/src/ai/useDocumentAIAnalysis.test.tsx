import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeDocument } from "../api/aiAnalysis";
import type { AnalyzeDocumentRequest, AnalyzeDocumentResponse } from "../types/aiAnalysis";
import type { DocumentModel, ParagraphBlock } from "../types/document";
import {
  createDocumentAIAnalysisTarget,
  createDocumentAIBlocks,
  shouldAcceptDocumentAIResponse,
  useDocumentAIAnalysis,
} from "./useDocumentAIAnalysis";

vi.mock("../api/aiAnalysis", () => ({
  analyzeDocument: vi.fn(),
}));

const mockedAnalyzeDocument = vi.mocked(analyzeDocument);

function paragraph(id: string, text: string, order: number, overrides: Partial<ParagraphBlock> = {}): ParagraphBlock {
  return {
    id,
    type: "paragraph",
    blockType: "paragraph",
    order,
    text,
    ...overrides,
  };
}

function documentWithBlocks(paragraphs: ParagraphBlock[], revision = 6): DocumentModel {
  return {
    documentId: "local-draft",
    revision,
    title: "Document AI hook test",
    paragraphs,
  };
}

const DOCUMENT = documentWithBlocks([
  paragraph("h-1", "1 Introduction", 0, { type: "heading", blockType: "heading", headingLevel: 1 }),
  paragraph("p-1", "Privacy concerns shape the background of the argument.", 1),
  paragraph("p-2", "The method compares student reflections across two writing sessions.", 2),
  paragraph("cap-1", "Figure 1: Imported overview.", 3, { blockType: "caption" }),
]);

function responseFor(request: AnalyzeDocumentRequest): AnalyzeDocumentResponse {
  return {
    documentId: request.documentId,
    revision: request.revision,
    requestId: request.requestId,
    model: "gpt-5.6-luna",
    analysisVersion: "document-v1",
    analyzedParagraphCount: 2,
    analysis: {
      paragraphRoles: [
        { paragraphId: "p-1", role: "background_context", rationale: "Introduces context." },
        { paragraphId: "p-2", role: "method_procedure", rationale: "Describes the procedure." },
      ],
      rhetoricalMoves: [
        { label: "background", count: 1, paragraphIds: ["p-1"] },
        { label: "method", count: 1, paragraphIds: ["p-2"] },
      ],
      coherence: {
        level: "moderate",
        rationale: "The document progresses from context to method.",
      },
      academicTone: {
        level: "strong",
        rationale: "The wording is formal.",
      },
      observation: "The document presents a compact academic progression.",
    },
  };
}

function HookHarness({ document = DOCUMENT }: { document?: DocumentModel }) {
  const state = useDocumentAIAnalysis(document, "English");
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <span data-testid="message">{state.message ?? "none"}</span>
      <span data-testid="revision">{state.data?.revision ?? "none"}</span>
      <span data-testid="stale">{state.isStale ? "stale" : "current"}</span>
      <span data-testid="source">{state.fromCache ? "cache" : "fresh"}</span>
      <button type="button" onClick={state.analyze} disabled={!state.canAnalyze}>
        Analyze document
      </button>
      <button type="button" onClick={state.reanalyze} disabled={!state.canAnalyze}>
        Re-analyze
      </button>
    </div>
  );
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useDocumentAIAnalysis", () => {
  beforeEach(() => {
    mockedAnalyzeDocument.mockImplementation(async (request) => responseFor(request));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("builds document blocks from headings and prose while excluding known non-prose blocks", () => {
    const blocks = createDocumentAIBlocks(DOCUMENT);

    expect(blocks).toEqual([
      expect.objectContaining({ type: "heading", nodeId: "h-1", text: "1 Introduction" }),
      expect.objectContaining({ type: "paragraph", paragraphId: "p-1", displayIndex: 1 }),
      expect.objectContaining({ type: "paragraph", paragraphId: "p-2", displayIndex: 2 }),
    ]);
    expect(blocks.some((block) => block.text.includes("Figure 1"))).toBe(false);
  });

  it("does not make a document AI request before the explicit action", () => {
    render(<HookHarness />);

    expect(screen.getByTestId("status")).toHaveTextContent("idle");
    expect(screen.getByText("Analyze document")).toBeEnabled();
    expect(mockedAnalyzeDocument).not.toHaveBeenCalled();
  });

  it("analyzes the document once when requested", async () => {
    render(<HookHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Analyze document" }));
    expect(screen.getByTestId("status")).toHaveTextContent("loading");
    await flushPromises();

    expect(screen.getByTestId("status")).toHaveTextContent("success");
    expect(screen.getByTestId("revision")).toHaveTextContent("6");
    expect(mockedAnalyzeDocument).toHaveBeenCalledTimes(1);
    expect(mockedAnalyzeDocument.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        documentId: "local-draft",
        revision: 6,
        blocks: expect.arrayContaining([expect.objectContaining({ paragraphId: "p-1" })]),
      }),
    );
  });

  it("guards against simultaneous document analysis requests", () => {
    mockedAnalyzeDocument.mockImplementation(
      () => new Promise<AnalyzeDocumentResponse>(() => undefined),
    );
    render(<HookHarness />);

    const button = screen.getByRole("button", { name: "Analyze document" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(mockedAnalyzeDocument).toHaveBeenCalledTimes(1);
  });

  it("marks an existing document analysis stale after the document changes", async () => {
    const { rerender } = render(<HookHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Analyze document" }));
    await flushPromises();
    expect(screen.getByTestId("stale")).toHaveTextContent("current");

    const editedDocument = documentWithBlocks(
      [
        DOCUMENT.paragraphs[0],
        paragraph("p-1", "Privacy concerns shape the edited background of the argument.", 1),
        DOCUMENT.paragraphs[2],
      ],
      7,
    );
    rerender(<HookHarness document={editedDocument} />);

    expect(screen.getByTestId("revision")).toHaveTextContent("6");
    expect(screen.getByTestId("stale")).toHaveTextContent("stale");
    expect(mockedAnalyzeDocument).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Analyze document" }));
    await flushPromises();

    expect(screen.getByTestId("revision")).toHaveTextContent("7");
    expect(screen.getByTestId("stale")).toHaveTextContent("current");
    expect(mockedAnalyzeDocument).toHaveBeenCalledTimes(2);
  });

  it("reuses a cached document analysis for an unchanged document state", async () => {
    render(<HookHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Analyze document" }));
    await flushPromises();
    fireEvent.click(screen.getByRole("button", { name: "Analyze document" }));
    await flushPromises();

    expect(screen.getByTestId("source")).toHaveTextContent("cache");
    expect(mockedAnalyzeDocument).toHaveBeenCalledTimes(1);
  });

  it("manual re-analyze bypasses the current cache", async () => {
    render(<HookHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Analyze document" }));
    await flushPromises();
    fireEvent.click(screen.getByRole("button", { name: "Re-analyze" }));
    await flushPromises();

    expect(mockedAnalyzeDocument).toHaveBeenCalledTimes(2);
  });

  it("keeps the old result visible when an update fails", async () => {
    const { rerender } = render(<HookHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Analyze document" }));
    await flushPromises();

    mockedAnalyzeDocument.mockRejectedValueOnce(new Error("AI analysis is temporarily unavailable."));
    const editedDocument = documentWithBlocks([DOCUMENT.paragraphs[0], DOCUMENT.paragraphs[1]], 7);
    rerender(<HookHarness document={editedDocument} />);
    fireEvent.click(screen.getByRole("button", { name: "Analyze document" }));
    await flushPromises();

    expect(screen.getByTestId("status")).toHaveTextContent("error");
    expect(screen.getByTestId("revision")).toHaveTextContent("6");
    expect(screen.getByTestId("message")).toHaveTextContent("AI analysis is temporarily unavailable.");
  });

  it("returns a controlled oversized state before sending a request", () => {
    const hugeDocument = documentWithBlocks([paragraph("p-large", "word ".repeat(25000), 0)]);

    const target = createDocumentAIAnalysisTarget(hugeDocument, "English");
    render(<HookHarness document={hugeDocument} />);

    expect(target.status).toBe("too_large");
    expect(screen.getByText("Analyze document")).toBeDisabled();
    expect(mockedAnalyzeDocument).not.toHaveBeenCalled();
  });

  it("accepts only responses matching the latest document request identity", () => {
    const request = createDocumentAIAnalysisTarget(DOCUMENT, "English");
    if (request.status !== "ready") {
      throw new Error("Expected ready document target");
    }
    const latest = {
      documentId: "local-draft",
      revision: 6,
      requestId: "doc-ai-6-1",
      cacheKey: request.cacheKey,
    };
    const response = responseFor({
      ...request.requestBase,
      requestId: "doc-ai-6-1",
    });

    expect(shouldAcceptDocumentAIResponse(response, latest, request.cacheKey)).toBe(true);
    expect(shouldAcceptDocumentAIResponse({ ...response, revision: 5 }, latest, request.cacheKey)).toBe(false);
    expect(shouldAcceptDocumentAIResponse(response, { ...latest, requestId: "other" }, request.cacheKey)).toBe(false);
    expect(shouldAcceptDocumentAIResponse(response, latest, "other-cache-key")).toBe(false);
  });
});
