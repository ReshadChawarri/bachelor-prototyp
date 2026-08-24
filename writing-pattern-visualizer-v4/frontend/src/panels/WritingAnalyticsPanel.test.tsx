import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { WritingAnalyticsPanel } from "./WritingAnalyticsPanel";
import type { BackendAnalyticsState, DocumentAnalyticsResponse } from "../types/backendAnalytics";
import type { DocumentModel, ParagraphBlock } from "../types/document";

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

const BACKEND_RESPONSE: DocumentAnalyticsResponse = {
  documentId: TEST_DOCUMENT.documentId,
  revision: TEST_DOCUMENT.revision,
  requestId: "analytics-7-1",
  language: "English",
  transitions: {
    total: 5,
    categories: [
      { name: "Addition", count: 3 },
      { name: "Contrast", count: 2 },
    ],
    terms: [],
  },
  repetition: {
    minCount: 2,
    terms: [
      { term: "writing", count: 4 },
      { term: "privacy", count: 2 },
    ],
  },
  structure: {
    source: "explicit",
    headings: [
      { text: "Abstract", level: 1, paragraphId: "h1" },
      { text: "2.1 Participants", level: 2, paragraphId: "h2" },
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
}: {
  document?: DocumentModel;
  revision?: number;
  selectedParagraph?: ParagraphBlock;
  selectedParagraphId?: string | null;
  backendAnalytics?: BackendAnalyticsState;
} = {}) {
  return render(
    <WritingAnalyticsPanel
      document={document}
      backendAnalytics={backendAnalytics}
      revision={revision}
      selectedParagraph={selectedParagraph}
      selectedParagraphId={selectedParagraphId}
    />,
  );
}

describe("WritingAnalyticsPanel paragraph length focus", () => {
  it("shows the selected prose paragraph first and keeps all paragraphs collapsed by default", () => {
    const { container } = renderPanel();

    const paragraphLengthSection = screen.getByLabelText("Paragraph length");
    expect(within(paragraphLengthSection).getByText("Selected paragraph · P2")).toBeInTheDocument();
    expect(within(paragraphLengthSection).getByText("5 words")).toBeInTheDocument();
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
    expect(screen.getByText("2 words")).toBeInTheDocument();
    expect(screen.queryByText("Selected paragraph · P2")).not.toBeInTheDocument();
  });

  it("updates the selected paragraph word count when the document changes", () => {
    const { rerender } = renderPanel();

    expect(screen.getByText("5 words")).toBeInTheDocument();

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

    expect(screen.getByText("7 words")).toBeInTheDocument();
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
});
