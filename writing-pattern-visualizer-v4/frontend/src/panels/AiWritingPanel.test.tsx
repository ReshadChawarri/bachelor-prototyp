import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeParagraph } from "../api/aiAnalysis";
import type { AnalyzeParagraphRequest, AnalyzeParagraphResponse } from "../types/aiAnalysis";
import type { DocumentModel, ParagraphBlock } from "../types/document";
import { AiWritingPanel } from "./AiWritingPanel";

vi.mock("../api/aiAnalysis", () => ({
  analyzeParagraph: vi.fn(),
}));

const mockedAnalyzeParagraph = vi.mocked(analyzeParagraph);

async function advanceAIAnalysisDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(1400);
    await Promise.resolve();
    await Promise.resolve();
  });
}

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

const DOCUMENT: DocumentModel = {
  documentId: "local-draft",
  revision: 10,
  title: "AI panel test",
  paragraphs: [
    paragraph("h-1", "1 Introduction", 0, { type: "heading", blockType: "heading", headingLevel: 1 }),
    paragraph("p-1", "Privacy concerns shape academic arguments about data practices.", 1),
    paragraph("p-2", "However, the following paragraph introduces a contrasting perspective.", 2),
  ],
};

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
        rationale: "Introduces a central position about the topic.",
      },
      rhetoricalMoves: [
        { label: "claim", rationale: "States the core position." },
        { label: "support", rationale: "Adds a reason for that position." },
      ],
      coherence: {
        level: "moderate",
        rationale: "The ideas are connected, with one transition that could be clearer.",
      },
      academicTone: {
        level: "strong",
        rationale: "The language is formal and precise.",
      },
      observation: "The paragraph develops a clear claim without rewriting the text.",
    },
  };
}

describe("AiWritingPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedAnalyzeParagraph.mockImplementation(async (request) => responseFor(request));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders paragraph analysis results for the selected prose paragraph", async () => {
    render(
      <AiWritingPanel
        document={DOCUMENT}
        selectedParagraph={DOCUMENT.paragraphs[1]}
        selectedParagraphId="p-1"
      />,
    );

    expect(screen.getByRole("tab", { name: "Paragraph" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Document" })).toBeDisabled();
    expect(screen.getByText("Analyzing paragraph...")).toBeInTheDocument();

    await advanceAIAnalysisDebounce();

    expect(screen.getByText("Paragraph P1")).toBeInTheDocument();
    expect(screen.getByText("Claim / Argument")).toBeInTheDocument();
    expect(screen.getByText("Claim")).toBeInTheDocument();
    expect(screen.getByText("Support")).toBeInTheDocument();
    expect(screen.getByText("Moderate")).toBeInTheDocument();
    expect(screen.getByText("Strong")).toBeInTheDocument();
    expect(screen.getByText("The paragraph develops a clear claim without rewriting the text.")).toBeInTheDocument();
    expect(mockedAnalyzeParagraph).toHaveBeenCalledTimes(1);
  });

  it("does not call AI when a heading is selected", async () => {
    render(
      <AiWritingPanel
        document={DOCUMENT}
        selectedParagraph={DOCUMENT.paragraphs[0]}
        selectedParagraphId="h-1"
      />,
    );

    await advanceAIAnalysisDebounce();

    expect(screen.getByText("Select a paragraph to view AI writing analysis.")).toBeInTheDocument();
    expect(mockedAnalyzeParagraph).not.toHaveBeenCalled();
  });

  it("shows a compact controlled error state", async () => {
    mockedAnalyzeParagraph.mockRejectedValueOnce(new Error("AI analysis is not configured."));
    render(
      <AiWritingPanel
        document={DOCUMENT}
        selectedParagraph={DOCUMENT.paragraphs[1]}
        selectedParagraphId="p-1"
      />,
    );

    await advanceAIAnalysisDebounce();

    expect(screen.getByText("AI analysis is not configured.")).toBeInTheDocument();
  });
});
