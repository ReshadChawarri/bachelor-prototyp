import { act, render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeDocument, analyzeParagraph } from "../api/aiAnalysis";
import type {
  AnalyzeDocumentRequest,
  AnalyzeDocumentResponse,
  AnalyzeParagraphRequest,
  AnalyzeParagraphResponse,
} from "../types/aiAnalysis";
import type { DocumentModel, ParagraphBlock } from "../types/document";
import { AiWritingPanel } from "./AiWritingPanel";

vi.mock("../api/aiAnalysis", () => ({
  analyzeDocument: vi.fn(),
  analyzeParagraph: vi.fn(),
}));

const mockedAnalyzeDocument = vi.mocked(analyzeDocument);
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

function documentResponseFor(request: AnalyzeDocumentRequest): AnalyzeDocumentResponse {
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
        { paragraphId: "p-2", role: "claim_argument", rationale: "States a contrast." },
      ],
      rhetoricalMoves: [
        { label: "background", count: 1, paragraphIds: ["p-1"] },
        { label: "claim", count: 1, paragraphIds: ["p-2"] },
      ],
      coherence: {
        level: "moderate",
        rationale: "The document moves from context to claim.",
      },
      academicTone: {
        level: "strong",
        rationale: "The register is formal.",
      },
      observation: "The document develops a compact academic progression.",
    },
  };
}

describe("AiWritingPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedAnalyzeDocument.mockImplementation(async (request) => documentResponseFor(request));
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
    expect(screen.getByRole("tab", { name: "Document" })).not.toBeDisabled();
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

  it("activates document analysis only after the explicit document action", async () => {
    const onNavigateToParagraph = vi.fn();
    render(
      <AiWritingPanel
        document={DOCUMENT}
        selectedParagraph={DOCUMENT.paragraphs[1]}
        selectedParagraphId="p-1"
        onNavigateToParagraph={onNavigateToParagraph}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Document" }));

    expect(screen.getByRole("tab", { name: "Document" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/Analyze the current document/)).toBeInTheDocument();
    expect(mockedAnalyzeDocument).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Analyze document" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Paragraph Roles")).toBeInTheDocument();
    expect(screen.getByText("P1")).toBeInTheDocument();
    expect(screen.getByText("Background / Context")).toBeInTheDocument();
    expect(screen.getByText("Rhetorical Moves")).toBeInTheDocument();
    expect(screen.getByText("The document develops a compact academic progression.")).toBeInTheDocument();
    expect(mockedAnalyzeDocument).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Background \/ Context/ }));
    expect(onNavigateToParagraph).toHaveBeenCalledWith("p-1");
  });

  it("marks document analysis stale after editing and updates on request", async () => {
    const { rerender } = render(
      <AiWritingPanel
        document={DOCUMENT}
        selectedParagraph={DOCUMENT.paragraphs[1]}
        selectedParagraphId="p-1"
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Document" }));
    fireEvent.click(screen.getByRole("button", { name: "Analyze document" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const editedDocument = {
      ...DOCUMENT,
      revision: 11,
      paragraphs: [
        DOCUMENT.paragraphs[0],
        paragraph("p-1", "Privacy concerns shape academic arguments about data practices and consent.", 1),
        DOCUMENT.paragraphs[2],
      ],
    };
    rerender(
      <AiWritingPanel
        document={editedDocument}
        selectedParagraph={editedDocument.paragraphs[1]}
        selectedParagraphId="p-1"
      />,
    );

    expect(screen.getByText("Document changed since this analysis.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Update analysis" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Analysis based on Revision 11")).toBeInTheDocument();
    expect(mockedAnalyzeDocument).toHaveBeenCalledTimes(2);
  });
});
