import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { importedPdfToTipTapDocument } from "../editor/importedDocument";
import { createEditorExtensions } from "../editor/extensions";
import { serializeDocument } from "../editor/serializer";
import type { ImportedPdfDocument } from "../types/document";
import { calculateLocalWritingAnalytics } from "./localAnalytics";

function createTestEditor(content: string) {
  return new Editor({
    extensions: createEditorExtensions(),
    content,
  });
}

function analyticsFor(editor: Editor) {
  return calculateLocalWritingAnalytics(serializeDocument(editor, "Analytics test", 0));
}

function serializedIds(editor: Editor): string[] {
  return serializeDocument(editor, "Analytics test", 0).paragraphs.map((paragraph) => paragraph.id);
}

describe("editor-driven local analytics", () => {
  it("updates metrics after typing and undo or redo", () => {
    const editor = createTestEditor("<p>First sentence.</p>");
    const [initialId] = serializedIds(editor);

    expect(analyticsFor(editor).overview).toEqual(
      expect.objectContaining({ wordCount: 2, sentenceCount: 1, paragraphCount: 1 }),
    );

    const firstParagraph = editor.state.doc.firstChild;
    editor.commands.setTextSelection(1 + (firstParagraph?.content.size ?? 0));
    editor.commands.insertContent(" Another sentence.");

    expect(serializedIds(editor)[0]).toBe(initialId);
    expect(analyticsFor(editor).overview).toEqual(
      expect.objectContaining({ wordCount: 4, sentenceCount: 2, paragraphCount: 1 }),
    );

    editor.commands.undo();
    expect(analyticsFor(editor).overview).toEqual(
      expect.objectContaining({ wordCount: 2, sentenceCount: 1, paragraphCount: 1 }),
    );

    editor.commands.redo();
    expect(analyticsFor(editor).overview).toEqual(
      expect.objectContaining({ wordCount: 4, sentenceCount: 2, paragraphCount: 1 }),
    );
  });

  it("updates paragraph metrics after splitting and merging paragraphs", () => {
    const editor = createTestEditor("<p>First sentence. Second sentence.</p>");
    const [initialId] = serializedIds(editor);

    editor.view.dispatch(editor.state.tr.split(1 + "First sentence.".length));

    const afterSplitIds = serializedIds(editor);
    expect(afterSplitIds).toHaveLength(2);
    expect(afterSplitIds[0]).toBe(initialId);
    expect(new Set(afterSplitIds).size).toBe(afterSplitIds.length);
    expect(analyticsFor(editor).overview.paragraphCount).toBe(2);
    expect(analyticsFor(editor).paragraphLengths.map((paragraph) => paragraph.label)).toEqual(["P1", "P2"]);

    const firstNodeSize = editor.state.doc.firstChild?.nodeSize ?? 0;
    editor.view.dispatch(editor.state.tr.join(firstNodeSize));

    const afterMergeIds = serializedIds(editor);
    expect(afterMergeIds).toHaveLength(1);
    expect(afterMergeIds[0]).toBe(initialId);
    expect(analyticsFor(editor).overview.paragraphCount).toBe(1);
  });

  it("updates metrics after deleting a paragraph", () => {
    const editor = createTestEditor("<p>First paragraph.</p><p>Second paragraph.</p>");
    expect(analyticsFor(editor).overview.paragraphCount).toBe(2);

    const firstNodeSize = editor.state.doc.firstChild?.nodeSize ?? 0;
    editor.commands.deleteRange({ from: firstNodeSize, to: editor.state.doc.content.size });

    expect(analyticsFor(editor).overview).toEqual(
      expect.objectContaining({ wordCount: 2, sentenceCount: 1, paragraphCount: 1 }),
    );
  });

  it("calculates analytics for simple PDF-imported documents while excluding imported non-prose blocks", () => {
    const importedDocument: ImportedPdfDocument = {
      filename: "simple.pdf",
      page_count: 1,
      character_count: 118,
      blocks: [
        { kind: "heading", text: "Introduction", heading_level: 1 },
        { kind: "paragraph", text: "Imported prose remains editable. Analytics use this paragraph." },
        { kind: "metadata", text: "Author Name, Example University" },
        { kind: "caption", text: "Figure 1: Example caption." },
        { kind: "table", text: "A | B\n1 | 2", rows: [["A", "B"], ["1", "2"]] },
      ],
    };
    const editor = new Editor({
      extensions: createEditorExtensions(),
      content: importedPdfToTipTapDocument(importedDocument),
    });

    const analytics = analyticsFor(editor);
    expect(analytics.overview.paragraphCount).toBe(1);
    expect(analytics.overview.headingCount).toBe(1);
    expect(analytics.overview.excludedBlockCount).toBe(3);
    expect(analytics.overview.wordCount).toBe(8);
    expect(analytics.paragraphLengths[0].label).toBe("P1");
  });
});
