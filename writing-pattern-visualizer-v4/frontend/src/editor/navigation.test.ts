import { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import { createEditorExtensions } from "./extensions";
import { findDocumentNodeTarget, selectDocumentNode } from "./navigation";

function createTestEditor(content: string) {
  return new Editor({
    extensions: createEditorExtensions(),
    content,
  });
}

function selectedNodeId(editor: Editor): string | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const nodeId = $from.node(depth).attrs.paragraphId;
    if (typeof nodeId === "string") {
      return nodeId;
    }
  }
  return null;
}

describe("editor document navigation", () => {
  it("resolves paragraphs by stable paragraph ID", () => {
    const editor = createTestEditor(
      '<p data-paragraph-id="stable-a">Repeated text.</p><p data-paragraph-id="stable-b">Repeated text.</p>',
    );

    const target = findDocumentNodeTarget(editor, "stable-b", "paragraph");

    expect(target).toEqual(expect.objectContaining({ nodeId: "stable-b", nodeType: "paragraph" }));
  });

  it("selects the exact paragraph without mutating document content or firing update", () => {
    const editor = createTestEditor(
      '<p data-paragraph-id="stable-a">First paragraph.</p><p data-paragraph-id="stable-b">Second paragraph.</p>',
    );
    const onUpdate = vi.fn();
    editor.on("update", onUpdate);
    const before = editor.state.doc.toJSON();
    const target = findDocumentNodeTarget(editor, "stable-b", "paragraph");

    expect(target).toBeTruthy();
    expect(selectDocumentNode(editor, target!)).toBe(true);

    expect(editor.state.doc.toJSON()).toEqual(before);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(selectedNodeId(editor)).toBe("stable-b");
  });

  it("resolves duplicate heading text by stable heading node ID", () => {
    const editor = createTestEditor(
      '<h2 data-paragraph-id="heading-a">Results</h2><p>Body.</p><h2 data-paragraph-id="heading-b">Results</h2>',
    );

    const target = findDocumentNodeTarget(editor, "heading-b", "heading");

    expect(target).toEqual(expect.objectContaining({ nodeId: "heading-b", nodeType: "heading" }));
    expect(selectDocumentNode(editor, target!)).toBe(true);
    expect(selectedNodeId(editor)).toBe("heading-b");
  });

  it("fails gracefully for deleted or mismatched targets", () => {
    const editor = createTestEditor('<h2 data-paragraph-id="heading-a">Results</h2><p data-paragraph-id="p-a">Body.</p>');

    expect(findDocumentNodeTarget(editor, "missing-id", "paragraph")).toBeNull();
    expect(findDocumentNodeTarget(editor, "heading-a", "paragraph")).toBeNull();
    expect(findDocumentNodeTarget(editor, "p-a", "heading")).toBeNull();
  });
});
