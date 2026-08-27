import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { suggestRevision } from "../api/aiAnalysis";
import { WritingAnalyticsPanel } from "./WritingAnalyticsPanel";
import type { SuggestRevisionRequest, SuggestRevisionResponse } from "../types/aiAnalysis";
import type {
  ActiveAnalyticsHighlight,
  AnalyticsHighlightRequest,
  BackendAnalyticsState,
  DocumentAnalyticsResponse,
} from "../types/backendAnalytics";
import type { DocumentModel, ParagraphBlock } from "../types/document";
import type { ParagraphRevisionApplyResult } from "../editor/revision";

vi.mock("../api/aiAnalysis", () => ({
  suggestRevision: vi.fn(),
}));

const mockedSuggestRevision = vi.mocked(suggestRevision);

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

function documentWithParagraphs(paragraphs: ParagraphBlock[]): DocumentModel {
  return {
    documentId: "local-test",
    revision: 7,
    title: "Analytics panel test",
    paragraphs,
  };
}

const TEST_DOCUMENT = documentWithParagraphs([
  paragraph("p-stable-1", "One two three.", 0),
  paragraph("p-stable-2", "One two three four five.", 1),
  paragraph("p-stable-3", "One two.", 2),
]);

function generatedWords(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join(" ");
}

const LONG_DOCUMENT = documentWithParagraphs([
  paragraph("p-long-1", generatedWords("alpha", 80), 0),
  paragraph("p-long-2", generatedWords("beta", 40), 1),
]);

const ADDITION_OCCURRENCES = [
  {
    paragraphId: "p-stable-1",
    startOffset: 0,
    endOffset: 4,
    text: "also",
    term: "also",
    category: "Addition",
  },
  {
    paragraphId: "p-stable-2",
    startOffset: 0,
    endOffset: 12,
    text: "Furthermore",
    term: "furthermore",
    category: "Addition",
  },
  {
    paragraphId: "p-stable-3",
    startOffset: 0,
    endOffset: 11,
    text: "In addition",
    term: "in addition",
    category: "Addition",
  },
];

const CONTRAST_OCCURRENCES = [
  {
    paragraphId: "p-stable-2",
    startOffset: 14,
    endOffset: 21,
    text: "However",
    term: "however",
    category: "Contrast",
  },
  {
    paragraphId: "p-stable-3",
    startOffset: 13,
    endOffset: 24,
    text: "In contrast",
    term: "in contrast",
    category: "Contrast",
  },
];

const WRITING_OCCURRENCES = [
  { paragraphId: "p-stable-1", startOffset: 0, endOffset: 7, text: "Writing", normalizedTerm: "writing" },
  { paragraphId: "p-stable-1", startOffset: 8, endOffset: 15, text: "writing", normalizedTerm: "writing" },
  { paragraphId: "p-stable-2", startOffset: 0, endOffset: 7, text: "WRITING", normalizedTerm: "writing" },
  { paragraphId: "p-stable-3", startOffset: 0, endOffset: 7, text: "writing", normalizedTerm: "writing" },
];

const PRIVACY_OCCURRENCES = [
  { paragraphId: "p-stable-2", startOffset: 9, endOffset: 16, text: "privacy", normalizedTerm: "privacy" },
  { paragraphId: "p-stable-3", startOffset: 9, endOffset: 16, text: "Privacy", normalizedTerm: "privacy" },
];

const BACKEND_RESPONSE: DocumentAnalyticsResponse = {
  documentId: TEST_DOCUMENT.documentId,
  revision: TEST_DOCUMENT.revision,
  requestId: "analytics-7-1",
  language: "English",
  transitions: {
    total: 5,
    categories: [
      { name: "Addition", count: 3, occurrences: ADDITION_OCCURRENCES },
      { name: "Contrast", count: 2, occurrences: CONTRAST_OCCURRENCES },
    ],
    terms: [
      { term: "also", category: "Addition", count: 1, occurrences: [ADDITION_OCCURRENCES[0]] },
      { term: "however", category: "Contrast", count: 1, occurrences: [CONTRAST_OCCURRENCES[0]] },
    ],
  },
  repetition: {
    minCount: 2,
    terms: [
      { term: "writing", count: 4, occurrences: WRITING_OCCURRENCES },
      { term: "privacy", count: 2, occurrences: PRIVACY_OCCURRENCES },
    ],
  },
  structure: {
    source: "explicit",
    headings: [
      { text: "Abstract", level: 1, nodeId: "h1", paragraphId: "h1" },
      { text: "2.1 Participants", level: 2, nodeId: "h2", paragraphId: "h2" },
    ],
  },
};

function backendState(overrides: Partial<BackendAnalyticsState> = {}): BackendAnalyticsState {
  return {
    data: BACKEND_RESPONSE,
    loading: false,
    error: null,
    ...overrides,
  };
}

function renderPanel({
  document = TEST_DOCUMENT,
  revision = 7,
  selectedParagraph = TEST_DOCUMENT.paragraphs[1],
  selectedParagraphId = "p-stable-2",
  backendAnalytics = backendState(),
  onNavigateToParagraph,
  onNavigateToHeading,
  activeAnalyticsHighlight,
  onToggleAnalyticsHighlight,
  onClearAnalyticsHighlights,
  onAcceptRevision,
}: {
  document?: DocumentModel;
  revision?: number;
  selectedParagraph?: ParagraphBlock;
  selectedParagraphId?: string | null;
  backendAnalytics?: BackendAnalyticsState;
  onNavigateToParagraph?: (paragraphId: string) => void;
  onNavigateToHeading?: (headingId: string) => void;
  activeAnalyticsHighlight?: ActiveAnalyticsHighlight | null;
  onToggleAnalyticsHighlight?: (request: AnalyticsHighlightRequest) => void;
  onClearAnalyticsHighlights?: () => void;
  onAcceptRevision?: (suggestion: SuggestRevisionResponse) => ParagraphRevisionApplyResult;
} = {}) {
  return render(
    <WritingAnalyticsPanel
      document={document}
      backendAnalytics={backendAnalytics}
      revision={revision}
      selectedParagraph={selectedParagraph}
      selectedParagraphId={selectedParagraphId}
      activeAnalyticsHighlight={activeAnalyticsHighlight}
      onAcceptRevision={onAcceptRevision}
      onNavigateToParagraph={onNavigateToParagraph}
      onNavigateToHeading={onNavigateToHeading}
      onToggleAnalyticsHighlight={onToggleAnalyticsHighlight}
      onClearAnalyticsHighlights={onClearAnalyticsHighlights}
    />,
  );
}

function revisionResponseFor(request: SuggestRevisionRequest): SuggestRevisionResponse {
  const revisedText = request.targetWordCount
    ? generatedWords("revised", request.targetWordCount + 2)
    : "Revised paragraph text.";

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
      revisedText,
      summary: "Adjusts the paragraph length while preserving the stated meaning.",
    },
    length:
      request.action === "adjust_paragraph_length" && request.targetWordCount
        ? {
            originalWordCount: request.paragraph.text.split(/\s+/).filter(Boolean).length,
            targetWordCount: request.targetWordCount,
            revisedWordCount: request.targetWordCount + 2,
            withinTolerance: true,
          }
        : null,
  };
}

describe("WritingAnalyticsPanel paragraph length focus", () => {
  beforeEach(() => {
    mockedSuggestRevision.mockImplementation(async (request) => revisionResponseFor(request));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows the selected prose paragraph first and keeps all paragraphs collapsed by default", () => {
    const { container } = renderPanel();

    const paragraphLengthSection = screen.getByLabelText("Paragraph length");
    expect(within(paragraphLengthSection).getByText("Selected paragraph · P2")).toBeInTheDocument();
    expect(currentWordCountElement(paragraphLengthSection)).toHaveTextContent("5 words");
    expect(within(paragraphLengthSection).getByRole("button", { name: "All paragraphs (3)" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(within(paragraphLengthSection).queryByText("P1")).not.toBeInTheDocument();
    expect(container.querySelector('[data-paragraph-id="p-stable-2"]')).toBeTruthy();
  });

  it("updates the focused paragraph when editor selection changes", () => {
    const { rerender } = renderPanel();

    expect(screen.getByText("Selected paragraph · P2")).toBeInTheDocument();

    rerender(
      <WritingAnalyticsPanel
        document={TEST_DOCUMENT}
        backendAnalytics={backendState()}
        revision={8}
        selectedParagraph={TEST_DOCUMENT.paragraphs[2]}
        selectedParagraphId="p-stable-3"
      />,
    );

    expect(screen.getByText("Selected paragraph · P3")).toBeInTheDocument();
    expect(currentWordCountElement(screen.getByLabelText("Paragraph length"))).toHaveTextContent("2 words");
    expect(screen.queryByText("Selected paragraph · P2")).not.toBeInTheDocument();
  });

  it("updates the selected paragraph word count when the document changes", () => {
    const { rerender } = renderPanel();

    expect(currentWordCountElement(screen.getByLabelText("Paragraph length"))).toHaveTextContent("5 words");

    const editedDocument = documentWithParagraphs([
      TEST_DOCUMENT.paragraphs[0],
      paragraph("p-stable-2", "One two three four five six seven.", 1),
      TEST_DOCUMENT.paragraphs[2],
    ]);

    rerender(
      <WritingAnalyticsPanel
        document={editedDocument}
        backendAnalytics={backendState({
          data: {
            ...BACKEND_RESPONSE,
            revision: editedDocument.revision,
          },
        })}
        revision={8}
        selectedParagraph={editedDocument.paragraphs[1]}
        selectedParagraphId="p-stable-2"
      />,
    );

    expect(currentWordCountElement(screen.getByLabelText("Paragraph length"))).toHaveTextContent("7 words");
  });

  it("shows a neutral empty state when the selected block is not a valid prose paragraph", () => {
    const metadata = paragraph("metadata-1", "Author Name, Example University", 3, { blockType: "metadata" });
    renderPanel({
      document: documentWithParagraphs([...TEST_DOCUMENT.paragraphs, metadata]),
      selectedParagraph: metadata,
      selectedParagraphId: "metadata-1",
    });

    const paragraphLengthSection = screen.getByLabelText("Paragraph length");
    expect(within(paragraphLengthSection).getByText("Select a paragraph in the document")).toBeInTheDocument();
    expect(within(paragraphLengthSection).getByText("to view its length.")).toBeInTheDocument();
    expect(within(paragraphLengthSection).getByRole("button", { name: "All paragraphs (3)" })).toBeInTheDocument();
    expect(screen.queryByText("Selected paragraph · P1")).not.toBeInTheDocument();
  });

  it("does not pretend a paragraph is selected when the editor selection has no paragraph ID", () => {
    renderPanel({ selectedParagraph: undefined, selectedParagraphId: null });

    const paragraphLengthSection = screen.getByLabelText("Paragraph length");
    expect(within(paragraphLengthSection).getByText("Select a paragraph in the document")).toBeInTheDocument();
    expect(within(paragraphLengthSection).getByRole("button", { name: "All paragraphs (3)" })).toBeInTheDocument();
    expect(within(paragraphLengthSection).queryByText("Selected paragraph · P1")).not.toBeInTheDocument();
  });

  it("expands and collapses all paragraph bars while marking the selected row", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();

    const paragraphLengthSection = screen.getByLabelText("Paragraph length");
    const toggle = within(paragraphLengthSection).getByRole("button", { name: "All paragraphs (3)" });

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(paragraphLengthSection).getByText("P1")).toBeInTheDocument();
    expect(within(paragraphLengthSection).getByText("P2")).toBeInTheDocument();
    expect(within(paragraphLengthSection).getByText("P3")).toBeInTheDocument();
    expect(container.querySelector('[data-paragraph-id="p-stable-2"][aria-current="true"]')).toBeTruthy();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(paragraphLengthSection).queryByText("P1")).not.toBeInTheDocument();
  });

  it("renders backend transition, repetition, and structure sections compactly", () => {
    renderPanel();

    const transitions = screen.getByLabelText("Transition words");
    expect(within(transitions).getByText("Total")).toBeInTheDocument();
    expect(within(transitions).getByText("5")).toBeInTheDocument();
    expect(within(transitions).getByText("Addition")).toBeInTheDocument();
    expect(within(transitions).getByText("Contrast")).toBeInTheDocument();

    const repetition = screen.getByLabelText("Repetition");
    expect(within(repetition).getByText("writing")).toBeInTheDocument();
    expect(within(repetition).getByText("privacy")).toBeInTheDocument();

    const structure = screen.getByLabelText("Document structure");
    expect(within(structure).getByText("Abstract")).toBeInTheDocument();
    expect(within(structure).getByText("2.1 Participants")).toBeInTheDocument();
  });

  it("renders neutral backend empty states", () => {
    renderPanel({
      backendAnalytics: backendState({
        data: {
          ...BACKEND_RESPONSE,
          transitions: { total: 0, categories: [], terms: [] },
          repetition: { minCount: 2, terms: [] },
          structure: { source: "none", headings: [] },
        },
      }),
    });

    expect(screen.getByText("No transition words detected.")).toBeInTheDocument();
    expect(screen.getByText("No notable repetition detected.")).toBeInTheDocument();
    expect(screen.getByText("No document headings detected.")).toBeInTheDocument();
  });

  it("requests transition category highlighting with backend occurrence spans", async () => {
    const user = userEvent.setup();
    const onToggleAnalyticsHighlight = vi.fn();
    renderPanel({ onToggleAnalyticsHighlight });

    const transitions = screen.getByLabelText("Transition words");
    await user.click(within(transitions).getByRole("button", { name: /Highlight 2 Contrast transition occurrences/i }));

    expect(onToggleAnalyticsHighlight).toHaveBeenCalledWith({
      type: "transition",
      key: "Contrast",
      label: "Contrast",
      revision: TEST_DOCUMENT.revision,
      occurrences: CONTRAST_OCCURRENCES.map(({ paragraphId, startOffset, endOffset }) => ({
        paragraphId,
        startOffset,
        endOffset,
      })),
    });
  });

  it("requests repetition term highlighting with backend occurrence spans", async () => {
    const user = userEvent.setup();
    const onToggleAnalyticsHighlight = vi.fn();
    renderPanel({ onToggleAnalyticsHighlight });

    const repetition = screen.getByLabelText("Repetition");
    await user.click(within(repetition).getByRole("button", { name: /Highlight 4 occurrences of writing/i }));

    expect(onToggleAnalyticsHighlight).toHaveBeenCalledWith({
      type: "repetition",
      key: "writing",
      label: "writing",
      revision: TEST_DOCUMENT.revision,
      occurrences: WRITING_OCCURRENCES.map(({ paragraphId, startOffset, endOffset }) => ({
        paragraphId,
        startOffset,
        endOffset,
      })),
    });
  });

  it("shows active highlight state and clears it through the panel control", async () => {
    const user = userEvent.setup();
    const onClearAnalyticsHighlights = vi.fn();
    renderPanel({
      onToggleAnalyticsHighlight: vi.fn(),
      onClearAnalyticsHighlights,
      activeAnalyticsHighlight: {
        type: "repetition",
        key: "privacy",
        label: "privacy",
        revision: TEST_DOCUMENT.revision,
        count: 2,
      },
    });

    expect(screen.getByText("Highlighting 2 occurrences of privacy")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Highlight 2 occurrences of privacy/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Clear highlights" }));

    expect(onClearAnalyticsHighlights).toHaveBeenCalledTimes(1);
  });

  it("renders backend loading and failure states without hiding local overview metrics", () => {
    const { rerender } = renderPanel({ backendAnalytics: backendState({ data: null, loading: true }) });

    expect(screen.getByText("Words")).toBeInTheDocument();
    expect(screen.getAllByText("Updating...")).toHaveLength(3);

    rerender(
      <WritingAnalyticsPanel
        document={TEST_DOCUMENT}
        backendAnalytics={backendState({
          data: null,
          loading: false,
          error: "Deterministic writing analytics are temporarily unavailable.",
        })}
        revision={7}
        selectedParagraph={TEST_DOCUMENT.paragraphs[1]}
        selectedParagraphId="p-stable-2"
      />,
    );

    expect(screen.getByText("Words")).toBeInTheDocument();
    expect(screen.getAllByText("Deterministic writing analytics are temporarily unavailable.")).toHaveLength(3);
  });

  it("navigates paragraph overview rows by stable paragraph ID rather than display label", async () => {
    const user = userEvent.setup();
    const onNavigateToParagraph = vi.fn();
    renderPanel({ onNavigateToParagraph });

    const paragraphLengthSection = screen.getByLabelText("Paragraph length");
    await user.click(within(paragraphLengthSection).getByRole("button", { name: "All paragraphs (3)" }));
    await user.click(within(paragraphLengthSection).getByRole("button", { name: /P3/i }));

    expect(onNavigateToParagraph).toHaveBeenCalledWith("p-stable-3");
  });

  it("keeps paragraph navigation keyboard accessible", async () => {
    const user = userEvent.setup();
    const onNavigateToParagraph = vi.fn();
    renderPanel({ onNavigateToParagraph });

    const paragraphLengthSection = screen.getByLabelText("Paragraph length");
    await user.click(within(paragraphLengthSection).getByRole("button", { name: "All paragraphs (3)" }));

    const firstParagraph = within(paragraphLengthSection).getByRole("button", { name: /P1/i });
    firstParagraph.focus();
    await user.keyboard("{Enter}");

    expect(onNavigateToParagraph).toHaveBeenCalledWith("p-stable-1");
  });

  it("navigates explicit structure headings by node ID and distinguishes duplicate names", async () => {
    const user = userEvent.setup();
    const onNavigateToHeading = vi.fn();
    renderPanel({
      onNavigateToHeading,
      backendAnalytics: backendState({
        data: {
          ...BACKEND_RESPONSE,
          structure: {
            source: "explicit",
            headings: [
              { text: "Results", level: 1, nodeId: "heading-a", paragraphId: "heading-a" },
              { text: "Results", level: 2, nodeId: "heading-b", paragraphId: "heading-b" },
            ],
          },
        },
      }),
    });

    const headingButtons = screen.getAllByRole("button", { name: "Results" });
    await user.click(headingButtons[1]);

    expect(onNavigateToHeading).toHaveBeenCalledWith("heading-b");
  });

  it("does not make heuristic structure entries clickable without explicit node IDs", () => {
    renderPanel({
      onNavigateToHeading: vi.fn(),
      backendAnalytics: backendState({
        data: {
          ...BACKEND_RESPONSE,
          structure: {
            source: "heuristic",
            headings: [{ text: "1 Introduction", level: 1, nodeId: null, paragraphId: "p-heading-like" }],
          },
        },
      }),
    });

    const structure = screen.getByLabelText("Document structure");
    expect(within(structure).getByText("1 Introduction")).toBeInTheDocument();
    expect(within(structure).queryByRole("button", { name: "1 Introduction" })).not.toBeInTheDocument();
  });

  it("defaults the paragraph-length target to the selected paragraph word count", () => {
    renderPanel({
      document: LONG_DOCUMENT,
      selectedParagraph: LONG_DOCUMENT.paragraphs[0],
      selectedParagraphId: "p-long-1",
      backendAnalytics: backendState({ data: { ...BACKEND_RESPONSE, revision: LONG_DOCUMENT.revision } }),
    });

    const paragraphLengthSection = screen.getByLabelText("Paragraph length");
    const targetSlider = within(paragraphLengthSection).getByRole("slider", { name: "Target length in words" });

    expect(within(paragraphLengthSection).getByText("Selected paragraph · P1")).toBeInTheDocument();
    expect(targetSlider).toHaveValue("80");
    expect(targetSlider).toHaveAttribute("min", "40");
    expect(targetSlider).toHaveAttribute("max", "140");
    expect(within(paragraphLengthSection).getByRole("button", { name: "Generate revision" })).toBeDisabled();
  });

  it("resets the paragraph-length target when the selected paragraph changes", () => {
    const { rerender } = renderPanel({
      document: LONG_DOCUMENT,
      selectedParagraph: LONG_DOCUMENT.paragraphs[0],
      selectedParagraphId: "p-long-1",
      backendAnalytics: backendState({ data: { ...BACKEND_RESPONSE, revision: LONG_DOCUMENT.revision } }),
    });

    const firstSlider = screen.getByRole("slider", { name: "Target length in words" });
    fireEvent.change(firstSlider, { target: { value: "60" } });
    expect(firstSlider).toHaveValue("60");

    rerender(
      <WritingAnalyticsPanel
        document={LONG_DOCUMENT}
        backendAnalytics={backendState({ data: { ...BACKEND_RESPONSE, revision: LONG_DOCUMENT.revision } })}
        revision={LONG_DOCUMENT.revision}
        selectedParagraph={LONG_DOCUMENT.paragraphs[1]}
        selectedParagraphId="p-long-2"
      />,
    );

    expect(screen.getByRole("slider", { name: "Target length in words" })).toHaveValue("40");
  });

  it("resets the paragraph-length target to the actual count after the paragraph content changes", () => {
    const { rerender } = renderPanel({
      document: LONG_DOCUMENT,
      selectedParagraph: LONG_DOCUMENT.paragraphs[0],
      selectedParagraphId: "p-long-1",
      backendAnalytics: backendState({ data: { ...BACKEND_RESPONSE, revision: LONG_DOCUMENT.revision } }),
    });

    const slider = screen.getByRole("slider", { name: "Target length in words" });
    fireEvent.change(slider, { target: { value: "60" } });
    expect(slider).toHaveValue("60");

    const acceptedDocument = documentWithParagraphs([
      paragraph("p-long-1", generatedWords("accepted", 62), 0),
      LONG_DOCUMENT.paragraphs[1],
    ]);

    rerender(
      <WritingAnalyticsPanel
        document={acceptedDocument}
        backendAnalytics={backendState({ data: { ...BACKEND_RESPONSE, revision: acceptedDocument.revision } })}
        revision={acceptedDocument.revision}
        selectedParagraph={acceptedDocument.paragraphs[0]}
        selectedParagraphId="p-long-1"
      />,
    );

    expect(screen.getByRole("slider", { name: "Target length in words" })).toHaveValue("62");
  });

  it("sends a shortening request through the existing revision endpoint", async () => {
    const user = userEvent.setup();
    renderPanel({
      document: LONG_DOCUMENT,
      selectedParagraph: LONG_DOCUMENT.paragraphs[0],
      selectedParagraphId: "p-long-1",
      backendAnalytics: backendState({ data: { ...BACKEND_RESPONSE, revision: LONG_DOCUMENT.revision } }),
    });

    const targetSlider = screen.getByRole("slider", { name: "Target length in words" });
    fireEvent.change(targetSlider, { target: { value: "60" } });
    await user.click(screen.getByRole("button", { name: "Generate revision" }));

    expect(mockedSuggestRevision).toHaveBeenCalledTimes(1);
    expect(mockedSuggestRevision.mock.calls[0][0]).toMatchObject({
      action: "adjust_paragraph_length",
      targetWordCount: 60,
      paragraph: {
        paragraphId: "p-long-1",
      },
    });
  });

  it("sends a moderate lengthening request through the existing revision endpoint", async () => {
    const user = userEvent.setup();
    renderPanel({
      document: LONG_DOCUMENT,
      selectedParagraph: LONG_DOCUMENT.paragraphs[0],
      selectedParagraphId: "p-long-1",
      backendAnalytics: backendState({ data: { ...BACKEND_RESPONSE, revision: LONG_DOCUMENT.revision } }),
    });

    fireEvent.change(screen.getByRole("slider", { name: "Target length in words" }), { target: { value: "100" } });
    await user.click(screen.getByRole("button", { name: "Generate revision" }));

    expect(mockedSuggestRevision.mock.calls[0][0].action).toBe("adjust_paragraph_length");
    expect(mockedSuggestRevision.mock.calls[0][0].targetWordCount).toBe(100);
  });

  it("does not submit an invalid paragraph-length target", async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(screen.getByText("Length adjustment is available for paragraphs with at least 20 words.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Generate revision" }));
    expect(mockedSuggestRevision).not.toHaveBeenCalled();
  });

  it("renders the shared revision preview with current target and suggested counts", async () => {
    const user = userEvent.setup();
    renderPanel({
      document: LONG_DOCUMENT,
      selectedParagraph: LONG_DOCUMENT.paragraphs[0],
      selectedParagraphId: "p-long-1",
      backendAnalytics: backendState({ data: { ...BACKEND_RESPONSE, revision: LONG_DOCUMENT.revision } }),
    });

    fireEvent.change(screen.getByRole("slider", { name: "Target length in words" }), { target: { value: "60" } });
    await user.click(screen.getByRole("button", { name: "Generate revision" }));
    await flushPromises();

    expect(screen.getByText("Revision Suggestion")).toBeInTheDocument();
    expect(screen.getByText("Adjust paragraph length")).toBeInTheDocument();
    const lengthFacts = screen.getByLabelText("Length revision word counts");
    expect(within(lengthFacts).getByText("Current")).toBeInTheDocument();
    expect(within(lengthFacts).getByText("80 words")).toBeInTheDocument();
    expect(within(lengthFacts).getByText("Target")).toBeInTheDocument();
    expect(within(lengthFacts).getByText("60 words")).toBeInTheDocument();
    expect(within(lengthFacts).getByText("Suggested")).toBeInTheDocument();
    expect(within(lengthFacts).getByText("62 words")).toBeInTheDocument();
  });

  it("accepts a paragraph-length revision through the shared accept callback", async () => {
    const user = userEvent.setup();
    const onAcceptRevision = vi.fn<(suggestion: SuggestRevisionResponse) => { applied: true }>(() => ({
      applied: true,
    }));
    renderPanel({
      document: LONG_DOCUMENT,
      selectedParagraph: LONG_DOCUMENT.paragraphs[0],
      selectedParagraphId: "p-long-1",
      backendAnalytics: backendState({ data: { ...BACKEND_RESPONSE, revision: LONG_DOCUMENT.revision } }),
      onAcceptRevision,
    });

    fireEvent.change(screen.getByRole("slider", { name: "Target length in words" }), { target: { value: "60" } });
    await user.click(screen.getByRole("button", { name: "Generate revision" }));
    await flushPromises();
    await user.click(screen.getByRole("button", { name: "Accept" }));

    expect(onAcceptRevision).toHaveBeenCalledTimes(1);
    expect(onAcceptRevision.mock.calls[0][0]).toMatchObject({
      paragraphId: "p-long-1",
      action: "adjust_paragraph_length",
      length: {
        targetWordCount: 60,
      },
    });
    expect(screen.queryByText("Revision Suggestion")).not.toBeInTheDocument();
  });
});

function currentWordCountElement(section: HTMLElement): HTMLElement {
  const row = section.querySelector(".paragraph-length-current-row");
  if (!(row instanceof HTMLElement)) {
    throw new Error("Missing current paragraph length row.");
  }
  const value = row.querySelector("strong");
  if (!(value instanceof HTMLElement)) {
    throw new Error("Missing current paragraph length value.");
  }
  return value;
}
