import { act, render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeParagraph, suggestRevision } from "../api/aiAnalysis";
import type {
  AnalyzeParagraphRequest,
  AnalyzeParagraphResponse,
  SuggestRevisionRequest,
  SuggestRevisionResponse,
} from "../types/aiAnalysis";
import type { DocumentModel, ParagraphBlock } from "../types/document";
import type { StudyEventLogger } from "../study/types";
import { AiWritingPanel } from "./AiWritingPanel";

vi.mock("../api/aiAnalysis", () => ({
  analyzeParagraph: vi.fn(),
  suggestRevision: vi.fn(),
}));

const mockedAnalyzeParagraph = vi.mocked(analyzeParagraph);
const mockedSuggestRevision = vi.mocked(suggestRevision);

async function advanceAIAnalysisDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(1400);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function flushPromises() {
  await act(async () => {
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

function revisionResponseFor(request: SuggestRevisionRequest): SuggestRevisionResponse {
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
      revisedText: "Privacy concerns shape academic arguments about responsible data practices.",
      summary: "Clarifies the phrasing while preserving the central meaning.",
    },
  };
}

describe("AiWritingPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedAnalyzeParagraph.mockImplementation(async (request) => responseFor(request));
    mockedSuggestRevision.mockImplementation(async (request) => revisionResponseFor(request));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders paragraph analysis results for the selected prose paragraph without document-wide tabs", async () => {
    render(<AiWritingPanel document={DOCUMENT} selectedParagraph={DOCUMENT.paragraphs[1]} selectedParagraphId="p-1" />);

    expect(screen.queryByRole("tab", { name: "Paragraph" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Document" })).not.toBeInTheDocument();
    expect(screen.getByText("Analyzing paragraph...")).toBeInTheDocument();

    await advanceAIAnalysisDebounce();

    expect(screen.getByText("Paragraph P1")).toBeInTheDocument();
    expect(screen.getByText("Claim / Argument")).toBeInTheDocument();
    expect(screen.getByText("Claim")).toBeInTheDocument();
    expect(screen.getByText("Support")).toBeInTheDocument();
    expect(screen.getByText("Moderate")).toBeInTheDocument();
    expect(screen.getByText("Strong")).toBeInTheDocument();
    expect(screen.getByText("The paragraph develops a clear claim without rewriting the text.")).toBeInTheDocument();
    expect(screen.getByText("Suggested Actions")).toBeInTheDocument();
    expect(mockedAnalyzeParagraph).toHaveBeenCalledTimes(1);
  });

  it("does not call AI when a heading is selected", async () => {
    render(<AiWritingPanel document={DOCUMENT} selectedParagraph={DOCUMENT.paragraphs[0]} selectedParagraphId="h-1" />);

    await advanceAIAnalysisDebounce();

    expect(screen.getByText("Select a paragraph to view AI writing analysis.")).toBeInTheDocument();
    expect(mockedAnalyzeParagraph).not.toHaveBeenCalled();
    expect(mockedSuggestRevision).not.toHaveBeenCalled();
  });

  it("shows a compact controlled paragraph-analysis error state", async () => {
    mockedAnalyzeParagraph.mockRejectedValueOnce(new Error("AI analysis is not configured."));
    render(<AiWritingPanel document={DOCUMENT} selectedParagraph={DOCUMENT.paragraphs[1]} selectedParagraphId="p-1" />);

    await advanceAIAnalysisDebounce();

    expect(screen.getByText("AI analysis is not configured.")).toBeInTheDocument();
  });

  it("requests an explicit clarity revision and renders the preview without applying it", async () => {
    const onAcceptRevision = vi.fn();
    render(
      <AiWritingPanel
        document={DOCUMENT}
        selectedParagraph={DOCUMENT.paragraphs[1]}
        selectedParagraphId="p-1"
        onAcceptRevision={onAcceptRevision}
      />,
    );

    await advanceAIAnalysisDebounce();
    fireEvent.click(screen.getByRole("button", { name: "Improve clarity" }));
    expect(screen.getByText("Generating revision...")).toBeInTheDocument();
    await flushPromises();

    expect(mockedSuggestRevision).toHaveBeenCalledTimes(1);
    expect(mockedSuggestRevision.mock.calls[0][0].action).toBe("improve_clarity");
    expect(screen.getByText("Revision Suggestion")).toBeInTheDocument();
    expect(screen.getByText("Clarifies the phrasing while preserving the central meaning.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(onAcceptRevision).not.toHaveBeenCalled();
  });

  it("logs AI analysis completion and revision decisions without model response text", async () => {
    const onStudyEvent = vi.fn<StudyEventLogger>();
    const onAcceptRevision = vi.fn(() => ({ applied: true as const }));
    render(
      <AiWritingPanel
        document={DOCUMENT}
        selectedParagraph={DOCUMENT.paragraphs[1]}
        selectedParagraphId="p-1"
        onAcceptRevision={onAcceptRevision}
        onStudyEvent={onStudyEvent}
      />,
    );

    await advanceAIAnalysisDebounce();
    expect(onStudyEvent).toHaveBeenCalledWith("ai_analysis_completed", { paragraphId: "p-1" });

    fireEvent.click(screen.getByRole("button", { name: "Improve clarity" }));
    await flushPromises();
    expect(onStudyEvent).toHaveBeenCalledWith("revision_requested", {
      paragraphId: "p-1",
      action: "improve_clarity",
    });

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onStudyEvent).toHaveBeenCalledWith("revision_rejected", {
      paragraphId: "p-1",
      action: "improve_clarity",
    });

    fireEvent.click(screen.getByRole("button", { name: "Improve transition" }));
    await flushPromises();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onStudyEvent).toHaveBeenCalledWith("revision_accepted", {
      paragraphId: "p-1",
      action: "improve_transition",
    });
    expect(JSON.stringify(onStudyEvent.mock.calls)).not.toContain("The paragraph develops a clear claim");
  });

  it("uses the requested revision action", async () => {
    render(<AiWritingPanel document={DOCUMENT} selectedParagraph={DOCUMENT.paragraphs[1]} selectedParagraphId="p-1" />);

    await advanceAIAnalysisDebounce();
    fireEvent.click(screen.getByRole("button", { name: "Improve academic tone" }));
    await flushPromises();

    expect(mockedSuggestRevision.mock.calls[0][0].action).toBe("improve_academic_tone");
  });

  it("does not send duplicate revision requests while loading", async () => {
    mockedSuggestRevision.mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    render(<AiWritingPanel document={DOCUMENT} selectedParagraph={DOCUMENT.paragraphs[1]} selectedParagraphId="p-1" />);

    await advanceAIAnalysisDebounce();
    const button = screen.getByRole("button", { name: "Improve transition" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(mockedSuggestRevision).toHaveBeenCalledTimes(1);
  });

  it("rejects a suggestion without calling the accept handler", async () => {
    const onAcceptRevision = vi.fn();
    render(
      <AiWritingPanel
        document={DOCUMENT}
        selectedParagraph={DOCUMENT.paragraphs[1]}
        selectedParagraphId="p-1"
        onAcceptRevision={onAcceptRevision}
      />,
    );

    await advanceAIAnalysisDebounce();
    fireEvent.click(screen.getByRole("button", { name: "Improve clarity" }));
    await flushPromises();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    expect(onAcceptRevision).not.toHaveBeenCalled();
    expect(screen.getByText("Suggested Actions")).toBeInTheDocument();
  });

  it("accepts a suggestion through the supplied editor callback", async () => {
    const onAcceptRevision = vi.fn<(suggestion: SuggestRevisionResponse) => { applied: true }>(() => ({
      applied: true,
    }));
    render(
      <AiWritingPanel
        document={DOCUMENT}
        selectedParagraph={DOCUMENT.paragraphs[1]}
        selectedParagraphId="p-1"
        onAcceptRevision={onAcceptRevision}
      />,
    );

    await advanceAIAnalysisDebounce();
    fireEvent.click(screen.getByRole("button", { name: "Improve clarity" }));
    await flushPromises();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    expect(onAcceptRevision).toHaveBeenCalledTimes(1);
    expect(onAcceptRevision.mock.calls[0][0].paragraphId).toBe("p-1");
    expect(screen.getByText("Suggested Actions")).toBeInTheDocument();
  });

  it("shows a stale-suggestion message when accept cannot apply safely", async () => {
    const onAcceptRevision = vi.fn<(suggestion: SuggestRevisionResponse) => { applied: false; reason: "stale" }>(() => ({
      applied: false,
      reason: "stale",
    }));
    render(
      <AiWritingPanel
        document={DOCUMENT}
        selectedParagraph={DOCUMENT.paragraphs[1]}
        selectedParagraphId="p-1"
        onAcceptRevision={onAcceptRevision}
      />,
    );

    await advanceAIAnalysisDebounce();
    fireEvent.click(screen.getByRole("button", { name: "Improve clarity" }));
    await flushPromises();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    expect(screen.getByText("This paragraph changed after the suggestion was generated. Generate a new revision before applying it.")).toBeInTheDocument();
  });

  it("ignores stale revision responses after the selected paragraph changes", async () => {
    const { rerender } = render(
      <AiWritingPanel document={DOCUMENT} selectedParagraph={DOCUMENT.paragraphs[1]} selectedParagraphId="p-1" />,
    );

    await advanceAIAnalysisDebounce();
    fireEvent.click(screen.getByRole("button", { name: "Improve clarity" }));

    rerender(<AiWritingPanel document={DOCUMENT} selectedParagraph={DOCUMENT.paragraphs[2]} selectedParagraphId="p-2" />);
    await flushPromises();

    expect(screen.queryByText("Revision Suggestion")).not.toBeInTheDocument();
  });
});
