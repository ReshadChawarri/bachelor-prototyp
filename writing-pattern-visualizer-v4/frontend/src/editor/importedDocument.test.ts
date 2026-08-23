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
    { kind: "paragraph", text: "This imported paragraph becomes editable text." },
    { kind: "paragraph", text: "A second imported paragraph supports merge and split checks." },
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

    expect(paragraphIds).toHaveLength(3);
    expect(new Set(paragraphIds).size).toBe(3);
    expect(serializeDocument(editor, "Imported", 0).paragraphs[0].type).toBe("heading");
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
    expect(after).toHaveLength(4);
    expect(after[1]).toBe(before[1]);
    expect(new Set(after).size).toBe(after.length);
  });

  it("merges imported paragraphs while preserving one valid ID", () => {
    const editor = createImportedEditor();
    const before = ids(editor);
    const joinPosition = editor.state.doc.content.child(0).nodeSize + editor.state.doc.content.child(1).nodeSize;

    editor.view.dispatch(editor.state.tr.join(joinPosition));

    const after = ids(editor);
    expect(after).toHaveLength(2);
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
