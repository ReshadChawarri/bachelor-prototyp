import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { createEditorExtensions } from "./extensions";
import { importedPdfToTipTapDocument } from "./importedDocument";
import { serializeDocument } from "./serializer";
import type { ImportedPdfDocument } from "../types/document";

const IMPORTED_DOCUMENT: ImportedPdfDocument = {
  filename: "sample.pdf",
  page_count: 1,
  character_count: 126,
  blocks: [
    { kind: "heading", text: "Introduction", heading_level: 1 },
    {
      kind: "paragraph",
      text: "This imported paragraph becomes editable text.",
      spans: [
        { text: "This imported paragraph becomes " },
        { text: "editable", bold: true },
        { text: " text.", italic: true },
      ],
    },
    { kind: "paragraph", text: "A second imported paragraph supports merge and split checks." },
    { kind: "metadata", text: "Author Name, University of Example" },
    { kind: "caption", text: "Figure 1: Example caption." },
    { kind: "table", text: "A | B\n1 | 2", rows: [["A", "B"], ["1", "2"]] },
    { kind: "figure", text: "[Figure/image detected on page 1]" },
  ],
};

function createImportedEditor() {
  return new Editor({
    extensions: createEditorExtensions(),
    content: importedPdfToTipTapDocument(IMPORTED_DOCUMENT),
  });
}

function ids(editor: Editor): string[] {
  return serializeDocument(editor, "Imported", 0).paragraphs.map((paragraph) => paragraph.id);
}

describe("imported PDF content", () => {
  it("loads imported PDF blocks with unique paragraph IDs", () => {
    const editor = createImportedEditor();
    const paragraphIds = ids(editor);

    expect(paragraphIds).toHaveLength(7);
    expect(new Set(paragraphIds).size).toBe(paragraphIds.length);
    expect(serializeDocument(editor, "Imported", 0).paragraphs[0].type).toBe("heading");
  });

  it("preserves reliable bold and italic spans from imported PDF text", () => {
    const editor = createImportedEditor();
    const html = editor.getHTML();

    expect(html).toContain("<strong>editable</strong>");
    expect(html).toContain("<em> text.</em>");
  });

  it("distinguishes non-prose imported blocks in the serialized document", () => {
    const editor = createImportedEditor();
    const blocks = serializeDocument(editor, "Imported", 0).paragraphs;
    expect(blocks.map((block) => block.blockType)).toContain("metadata");
    expect(blocks.map((block) => block.blockType)).toContain("caption");
    expect(blocks.map((block) => block.blockType)).toContain("table");
    expect(blocks.map((block) => block.blockType)).toContain("figure");
  });

  it("keeps imported paragraph IDs stable while editing", () => {
    const editor = createImportedEditor();
    const before = ids(editor);

    editor.commands.setTextSelection(editor.state.doc.content.child(0).nodeSize + 7);
    editor.commands.insertContent(" edited");

    expect(ids(editor)).toEqual(before);
    expect(editor.getText()).toContain("This i editedmported paragraph");
  });

  it("splits imported paragraphs without duplicate IDs", () => {
    const editor = createImportedEditor();
    const before = ids(editor);
    const firstParagraphStart = editor.state.doc.content.child(0).nodeSize;
    const firstParagraphNode = editor.state.doc.content.child(1);
    const splitPosition = firstParagraphStart + 1 + firstParagraphNode.content.size;

    editor.view.dispatch(editor.state.tr.split(splitPosition));

    const after = ids(editor);
    expect(after).toHaveLength(before.length + 1);
    expect(after[1]).toBe(before[1]);
    expect(new Set(after).size).toBe(after.length);
  });

  it("merges imported paragraphs while preserving one valid ID", () => {
    const editor = createImportedEditor();
    const before = ids(editor);
    const joinPosition = editor.state.doc.content.child(0).nodeSize + editor.state.doc.content.child(1).nodeSize;

    editor.view.dispatch(editor.state.tr.join(joinPosition));

    const after = ids(editor);
    expect(after).toHaveLength(before.length - 1);
    expect(after[1]).toBe(before[1]);
    expect(new Set(after).size).toBe(after.length);
  });

  it("supports undo and redo after imported paragraph edits", () => {
    const editor = createImportedEditor();
    const before = editor.getText();

    editor.commands.setTextSelection(editor.state.doc.content.child(0).nodeSize + 7);
    editor.commands.insertContent(" edited");
    expect(editor.getText()).not.toBe(before);

    editor.commands.undo();
    expect(editor.getText()).toBe(before);

    editor.commands.redo();
    expect(editor.getText()).not.toBe(before);
  });
});
