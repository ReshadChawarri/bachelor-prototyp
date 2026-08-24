import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { WritingAnalyticsPanel } from "./WritingAnalyticsPanel";
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

describe("WritingAnalyticsPanel paragraph length focus", () => {
  it("shows the selected prose paragraph first and keeps all paragraphs collapsed by default", () => {
    const { container } = render(
      <WritingAnalyticsPanel
        document={TEST_DOCUMENT}
        revision={7}
        selectedParagraph={TEST_DOCUMENT.paragraphs[1]}
        selectedParagraphId="p-stable-2"
      />,
    );

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
    const { rerender } = render(
      <WritingAnalyticsPanel
        document={TEST_DOCUMENT}
        revision={7}
        selectedParagraph={TEST_DOCUMENT.paragraphs[1]}
        selectedParagraphId="p-stable-2"
      />,
    );

    expect(screen.getByText("Selected paragraph · P2")).toBeInTheDocument();

    rerender(
      <WritingAnalyticsPanel
        document={TEST_DOCUMENT}
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
    const { rerender } = render(
      <WritingAnalyticsPanel
        document={TEST_DOCUMENT}
        revision={7}
        selectedParagraph={TEST_DOCUMENT.paragraphs[1]}
        selectedParagraphId="p-stable-2"
      />,
    );

    expect(screen.getByText("5 words")).toBeInTheDocument();

    const editedDocument = documentWithParagraphs([
      TEST_DOCUMENT.paragraphs[0],
      paragraph("p-stable-2", "One two three four five six seven.", 1),
      TEST_DOCUMENT.paragraphs[2],
    ]);

    rerender(
      <WritingAnalyticsPanel
        document={editedDocument}
        revision={8}
        selectedParagraph={editedDocument.paragraphs[1]}
        selectedParagraphId="p-stable-2"
      />,
    );

    expect(screen.getByText("7 words")).toBeInTheDocument();
  });

  it("shows a neutral empty state when the selected block is not a valid prose paragraph", () => {
    const metadata = paragraph("metadata-1", "Author Name, Example University", 3, { blockType: "metadata" });
    render(
      <WritingAnalyticsPanel
        document={documentWithParagraphs([...TEST_DOCUMENT.paragraphs, metadata])}
        revision={7}
        selectedParagraph={metadata}
        selectedParagraphId="metadata-1"
      />,
    );

    const paragraphLengthSection = screen.getByLabelText("Paragraph length");
    expect(within(paragraphLengthSection).getByText("Select a paragraph in the document")).toBeInTheDocument();
    expect(within(paragraphLengthSection).getByText("to view its length.")).toBeInTheDocument();
    expect(within(paragraphLengthSection).getByRole("button", { name: "All paragraphs (3)" })).toBeInTheDocument();
    expect(screen.queryByText("Selected paragraph · P1")).not.toBeInTheDocument();
  });

  it("does not pretend a paragraph is selected when the editor selection has no paragraph ID", () => {
    render(
      <WritingAnalyticsPanel
        document={TEST_DOCUMENT}
        revision={7}
        selectedParagraph={undefined}
        selectedParagraphId={null}
      />,
    );

    const paragraphLengthSection = screen.getByLabelText("Paragraph length");
    expect(within(paragraphLengthSection).getByText("Select a paragraph in the document")).toBeInTheDocument();
    expect(within(paragraphLengthSection).getByRole("button", { name: "All paragraphs (3)" })).toBeInTheDocument();
    expect(within(paragraphLengthSection).queryByText("Selected paragraph · P1")).not.toBeInTheDocument();
  });

  it("expands and collapses all paragraph bars while marking the selected row", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <WritingAnalyticsPanel
        document={TEST_DOCUMENT}
        revision={7}
        selectedParagraph={TEST_DOCUMENT.paragraphs[1]}
        selectedParagraphId="p-stable-2"
      />,
    );

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
});
