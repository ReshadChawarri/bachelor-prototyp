import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { createEditorExtensions } from "./extensions";
import { serializeDocument } from "./serializer";

function createTestEditor(content: string) {
  return new Editor({
    extensions: createEditorExtensions(),
    content,
  });
}

function paragraphIds(editor: Editor): string[] {
  return serializeDocument(editor, "Test", 0).paragraphs.map((paragraph) => paragraph.id);
}

describe("persistent paragraph IDs", () => {
  it("creates missing paragraph IDs and fixes duplicates", () => {
    const editor = createTestEditor(
      '<p data-paragraph-id="duplicate">First.</p><p data-paragraph-id="duplicate">Second.</p><p>Third.</p>',
    );

    const ids = paragraphIds(editor);

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe("duplicate");
  });

  it("preserves a paragraph ID while editing text", () => {
    const editor = createTestEditor("<p>First paragraph.</p>");
    const [beforeId] = paragraphIds(editor);

    editor.commands.setTextSelection(1 + "First".length);
    editor.commands.insertContent(" edited");

    const [afterId] = paragraphIds(editor);
    expect(afterId).toBe(beforeId);
    expect(editor.getText()).toContain("First edited paragraph.");
  });

  it("preserves the first paragraph ID and creates a new one when splitting", () => {
    const editor = createTestEditor("<p>First paragraph.</p>");
    const [beforeId] = paragraphIds(editor);
    const firstParagraph = editor.state.doc.firstChild;
    expect(firstParagraph).toBeTruthy();

    const splitPosition = 1 + (firstParagraph?.content.size ?? 0);
    editor.view.dispatch(editor.state.tr.split(splitPosition));

    const ids = paragraphIds(editor);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(beforeId);
    expect(ids[1]).not.toBe(beforeId);
    expect(new Set(ids).size).toBe(2);
  });

  it("keeps one valid paragraph ID when merging paragraphs", () => {
    const editor = createTestEditor("<p>First.</p><p>Second.</p>");
    const beforeIds = paragraphIds(editor);
    const firstNodeSize = editor.state.doc.firstChild?.nodeSize ?? 0;

    editor.view.dispatch(editor.state.tr.join(firstNodeSize));

    const afterIds = paragraphIds(editor);
    expect(afterIds).toHaveLength(1);
    expect(afterIds[0]).toBe(beforeIds[0]);
    expect(new Set(afterIds).size).toBe(1);
  });

  it("uses TipTap history for undo and redo", () => {
    const editor = createTestEditor("<p>Undo test.</p>");
    const [paragraphId] = paragraphIds(editor);

    editor.commands.setTextSelection(1 + "Undo".length);
    editor.commands.insertContent(" and redo");
    expect(editor.getText()).toBe("Undo and redo test.");

    editor.commands.undo();
    expect(editor.getText()).toBe("Undo test.");

    editor.commands.redo();
    expect(editor.getText()).toBe("Undo and redo test.");
    expect(paragraphIds(editor)[0]).toBe(paragraphId);
  });
});

