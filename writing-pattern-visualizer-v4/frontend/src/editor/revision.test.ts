import { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import { createEditorExtensions } from "./extensions";
import { paragraphContentHash, replaceParagraphTextById } from "./revision";

function createTestEditor(content: string) {
  return new Editor({
    extensions: createEditorExtensions(),
    content,
  });
}

function paragraphText(editor: Editor, paragraphId: string): string | null {
  let text: string | null = null;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "paragraph" && node.attrs.paragraphId === paragraphId) {
      text = node.textContent;
      return false;
    }
    return true;
  });
  return text;
}

function paragraphIds(editor: Editor): string[] {
  const ids: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "paragraph") {
      ids.push(node.attrs.paragraphId);
    }
    return true;
  });
  return ids;
}

describe("paragraph revision application", () => {
  it("replaces only the targeted paragraph by stable paragraph ID", () => {
    const editor = createTestEditor(
      '<p data-paragraph-id="p-a">Original paragraph.</p><p data-paragraph-id="p-b">Neighbor paragraph.</p>',
    );
    const sourceHash = paragraphContentHash("Original paragraph.");

    const result = replaceParagraphTextById(editor, "p-a", sourceHash, "Revised paragraph.");

    expect(result).toEqual({ applied: true });
    expect(paragraphText(editor, "p-a")).toBe("Revised paragraph.");
    expect(paragraphText(editor, "p-b")).toBe("Neighbor paragraph.");
    expect(paragraphIds(editor)).toEqual(["p-a", "p-b"]);
  });

  it("rejects stale suggestions when the paragraph text hash no longer matches", () => {
    const editor = createTestEditor('<p data-paragraph-id="p-a">Current paragraph.</p>');
    const before = editor.state.doc.toJSON();

    const result = replaceParagraphTextById(editor, "p-a", paragraphContentHash("Older paragraph."), "Revision.");

    expect(result).toEqual({ applied: false, reason: "stale" });
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it("fails safely when the target paragraph no longer exists", () => {
    const editor = createTestEditor('<p data-paragraph-id="p-a">Current paragraph.</p>');
    const before = editor.state.doc.toJSON();

    const result = replaceParagraphTextById(editor, "missing", paragraphContentHash("Current paragraph."), "Revision.");

    expect(result).toEqual({ applied: false, reason: "missing" });
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it("records accept as one undoable editor mutation", () => {
    const editor = createTestEditor('<p data-paragraph-id="p-a">Original paragraph.</p>');
    const onUpdate = vi.fn();
    editor.on("update", onUpdate);

    const result = replaceParagraphTextById(
      editor,
      "p-a",
      paragraphContentHash("Original paragraph."),
      "Revised paragraph.",
    );

    expect(result).toEqual({ applied: true });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(paragraphText(editor, "p-a")).toBe("Revised paragraph.");

    editor.commands.undo();

    expect(paragraphText(editor, "p-a")).toBe("Original paragraph.");
    expect(paragraphIds(editor)).toEqual(["p-a"]);
  });

  it("normalizes accidental line breaks into a single paragraph", () => {
    const editor = createTestEditor('<p data-paragraph-id="p-a">Original paragraph.</p>');

    replaceParagraphTextById(
      editor,
      "p-a",
      paragraphContentHash("Original paragraph."),
      "Revised\nparagraph.",
    );

    expect(paragraphText(editor, "p-a")).toBe("Revised paragraph.");
  });
});
