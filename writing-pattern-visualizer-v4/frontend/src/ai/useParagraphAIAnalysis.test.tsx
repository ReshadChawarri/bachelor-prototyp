import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeParagraph } from "../api/aiAnalysis";
import type { AnalyzeParagraphRequest, AnalyzeParagraphResponse } from "../types/aiAnalysis";
import type { DocumentModel, ParagraphBlock } from "../types/document";
import {
  AI_ANALYSIS_DEBOUNCE_MS,
  createParagraphAIAnalysisTarget,
  shouldAcceptParagraphAIResponse,
  useParagraphAIAnalysis,
} from "./useParagraphAIAnalysis";

vi.mock("../api/aiAnalysis", () => ({
  analyzeParagraph: vi.fn(),
}));

const mockedAnalyzeParagraph = vi.mocked(analyzeParagraph);

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

function documentWithParagraphs(paragraphs: ParagraphBlock[], revision = 4): DocumentModel {
  return {
    documentId: "local-draft",
    revision,
    title: "AI hook test",
    paragraphs,
  };
}

const DOCUMENT = documentWithParagraphs([
  paragraph("h-1", "1 Introduction", 0, { type: "heading", blockType: "heading", headingLevel: 1 }),
  paragraph("p-1", "Privacy concerns shape student writing about data practices.", 1),
  paragraph("p-2", "However, students often discuss privacy with different assumptions.", 2),
]);

function responseFor(request: AnalyzeParagraphRequest): AnalyzeParagraphResponse {
  return {
    documentId: request.documentId,
    revision: request.revision,
    requestId: request.requestId,
    paragraphId: request.paragraph.paragraphId,
    model: "gpt-5.6-luna",
    analysisVersion: "paragraph-v1",
    analysis: {
      paragraphRole: {
        label: "claim_argument",
        rationale: `Role for ${request.paragraph.paragraphId}`,
      },
      rhetoricalMoves: [{ label: "claim", rationale: "States a central point." }],
      coherence: {
        level: "moderate",
        rationale: "The paragraph is understandable.",
      },
      academicTone: {
        level: "strong",
        rationale: "The wording is formal.",
      },
      observation: `Observation for ${request.paragraph.paragraphId}`,
    },
  };
}

function HookHarness({
  document,
  selectedParagraphId,
  debounceMs = 25,
}: {
  document: DocumentModel;
  selectedParagraphId: string | null;
  debounceMs?: number;
}) {
  const selectedParagraph = document.paragraphs.find((block) => block.id === selectedParagraphId);
  const state = useParagraphAIAnalysis(document, selectedParagraph, selectedParagraphId, "English", debounceMs);

  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <span data-testid="paragraph">{state.data?.paragraphId ?? state.paragraphId ?? "none"}</span>
      <span data-testid="message">{state.message ?? "none"}</span>
      <span data-testid="source">{state.fromCache ? "cache" : "fresh"}</span>
      <button type="button" onClick={state.reanalyze}>
        Re-analyze
      </button>
    </div>
  );
}

async function advanceDebounce(ms = 25) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useParagraphAIAnalysis", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedAnalyzeParagraph.mockImplementation(async (request) => responseFor(request));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("uses a conservative AI debounce", () => {
    expect(AI_ANALYSIS_DEBOUNCE_MS).toBeGreaterThanOrEqual(1000);
    expect(AI_ANALYSIS_DEBOUNCE_MS).toBeLessThanOrEqual(2000);
  });

  it("builds minimal paragraph context from the TipTap-derived document model", () => {
    const target = createParagraphAIAnalysisTarget(DOCUMENT, DOCUMENT.paragraphs[1], "p-1", "English");

    expect(target.status).toBe("ready");
    if (target.status !== "ready") {
      throw new Error("Expected ready target");
    }
    expect(target.displayLabel).toBe("P1");
    expect(target.requestBase.paragraph).toEqual({
      paragraphId: "p-1",
      text: DOCUMENT.paragraphs[1].text,
    });
    expect(target.requestBase.context).toEqual({
      nearestHeading: "1 Introduction",
      previousParagraph: null,
      nextParagraph: DOCUMENT.paragraphs[2].text,
    });
  });

  it("analyzes the selected prose paragraph after debounce", async () => {
    render(<HookHarness document={DOCUMENT} selectedParagraphId="p-1" />);

    expect(screen.getByTestId("status")).toHaveTextContent("loading");
    await advanceDebounce();

    expect(screen.getByTestId("status")).toHaveTextContent("success");
    expect(screen.getByTestId("paragraph")).toHaveTextContent("p-1");
    expect(mockedAnalyzeParagraph).toHaveBeenCalledTimes(1);
    expect(mockedAnalyzeParagraph.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        documentId: "local-draft",
        revision: 4,
        paragraph: expect.objectContaining({ paragraphId: "p-1" }),
      }),
    );
  });

  it("does not create another request when selection remains inside the unchanged paragraph", async () => {
    const { rerender } = render(<HookHarness document={DOCUMENT} selectedParagraphId="p-1" />);
    await advanceDebounce();
    expect(screen.getByTestId("status")).toHaveTextContent("success");

    rerender(<HookHarness document={DOCUMENT} selectedParagraphId="p-1" />);
    await advanceDebounce();

    expect(mockedAnalyzeParagraph).toHaveBeenCalledTimes(1);
  });

  it("does not call AI for headings or insufficient paragraph fragments", async () => {
    const shortDocument = documentWithParagraphs([
      DOCUMENT.paragraphs[0],
      paragraph("p-short", "Too short.", 1),
    ]);
    const { rerender } = render(<HookHarness document={DOCUMENT} selectedParagraphId="h-1" />);

    await advanceDebounce();
    expect(screen.getByTestId("message")).toHaveTextContent("Select a paragraph");
    expect(mockedAnalyzeParagraph).not.toHaveBeenCalled();

    rerender(<HookHarness document={shortDocument} selectedParagraphId="p-short" />);
    await advanceDebounce();

    expect(screen.getByTestId("status")).toHaveTextContent("insufficient");
    expect(screen.getByTestId("message")).toHaveTextContent("Add more text");
    expect(mockedAnalyzeParagraph).not.toHaveBeenCalled();
  });

  it("prevents an old paragraph response from overwriting the current selection", async () => {
    const pending: Array<{ request: AnalyzeParagraphRequest; resolve: (response: AnalyzeParagraphResponse) => void }> = [];
    mockedAnalyzeParagraph.mockImplementation(
      (request) =>
        new Promise((resolve) => {
          pending.push({ request, resolve });
        }),
    );
    const { rerender } = render(<HookHarness document={DOCUMENT} selectedParagraphId="p-1" />);
    await advanceDebounce();

    rerender(<HookHarness document={DOCUMENT} selectedParagraphId="p-2" />);
    await advanceDebounce();

    await act(async () => {
      pending[1].resolve(responseFor(pending[1].request));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("paragraph")).toHaveTextContent("p-2");

    await act(async () => {
      pending[0].resolve(responseFor(pending[0].request));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("paragraph")).toHaveTextContent("p-2");
  });

  it("invalidates displayed analysis when selected paragraph text changes", async () => {
    const { rerender } = render(<HookHarness document={DOCUMENT} selectedParagraphId="p-1" />);
    await advanceDebounce();
    expect(screen.getByTestId("status")).toHaveTextContent("success");

    const editedDocument = documentWithParagraphs(
      [
        DOCUMENT.paragraphs[0],
        paragraph("p-1", "Privacy concerns shape student writing about data practices and trust.", 1),
        DOCUMENT.paragraphs[2],
      ],
      5,
    );
    rerender(<HookHarness document={editedDocument} selectedParagraphId="p-1" />);

    expect(screen.getByTestId("status")).toHaveTextContent("loading");
    expect(screen.getByTestId("paragraph")).toHaveTextContent("p-1");
    await advanceDebounce();

    expect(mockedAnalyzeParagraph).toHaveBeenCalledTimes(2);
  });

  it("reuses cached paragraph analysis when returning to an unchanged paragraph", async () => {
    const { rerender } = render(<HookHarness document={DOCUMENT} selectedParagraphId="p-1" />);
    await advanceDebounce();
    expect(screen.getByTestId("paragraph")).toHaveTextContent("p-1");

    rerender(<HookHarness document={DOCUMENT} selectedParagraphId="p-2" />);
    await advanceDebounce();
    expect(screen.getByTestId("paragraph")).toHaveTextContent("p-2");

    rerender(<HookHarness document={DOCUMENT} selectedParagraphId="p-1" />);
    await advanceDebounce();

    expect(screen.getByTestId("paragraph")).toHaveTextContent("p-1");
    expect(screen.getByTestId("source")).toHaveTextContent("cache");
    expect(mockedAnalyzeParagraph).toHaveBeenCalledTimes(2);
  });

  it("manual re-analyze bypasses the current cached result once", async () => {
    render(<HookHarness document={DOCUMENT} selectedParagraphId="p-1" />);
    await advanceDebounce();
    expect(screen.getByTestId("status")).toHaveTextContent("success");

    fireEvent.click(screen.getByRole("button", { name: "Re-analyze" }));
    await advanceDebounce();

    expect(mockedAnalyzeParagraph).toHaveBeenCalledTimes(2);
  });

  it("accepts AI responses only for the latest request identity", () => {
    const latest = {
      documentId: "local-draft",
      revision: 4,
      requestId: "ai-4-1",
      paragraphId: "p-1",
      cacheKey: "key-a",
    };
    const response = responseFor({
      documentId: "local-draft",
      revision: 4,
      requestId: "ai-4-1",
      language: "English",
      paragraph: { paragraphId: "p-1", text: "Privacy concerns shape academic writing." },
      context: { nearestHeading: null, previousParagraph: null, nextParagraph: null },
    });

    expect(shouldAcceptParagraphAIResponse(response, latest, "key-a")).toBe(true);
    expect(shouldAcceptParagraphAIResponse({ ...response, revision: 3 }, latest, "key-a")).toBe(false);
    expect(shouldAcceptParagraphAIResponse({ ...response, paragraphId: "p-2" }, latest, "key-a")).toBe(false);
    expect(shouldAcceptParagraphAIResponse(response, latest, "key-b")).toBe(false);
  });
});
