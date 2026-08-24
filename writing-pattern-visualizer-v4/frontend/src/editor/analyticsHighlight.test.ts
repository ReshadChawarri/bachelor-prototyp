import { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import {
  analyticsHighlightPluginKey,
  clearAnalyticsHighlights,
  resolveAnalyticsHighlightSpans,
  setAnalyticsHighlights,
} from "./analyticsHighlight";
import { createEditorExtensions } from "./extensions";

function createTestEditor(content: string) {
  return new Editor({
    extensions: createEditorExtensions(),
    content,
  });
}

function decorationRanges(editor: Editor) {
  return analyticsHighlightPluginKey.getState(editor.state)?.find() ?? [];
}

function decorationTexts(editor: Editor): string[] {
  return decorationRanges(editor).map((decoration) =>
    editor.state.doc.textBetween(decoration.from, decoration.to, ""),
  );
}

describe("analytics editor highlights", () => {
  it("maps paragraph-local text offsets across inline formatting", () => {
    const editor = createTestEditor(
      '<p data-paragraph-id="p1">Privacy <strong>privacy</strong> database.</p>',
    );

    const spans = resolveAnalyticsHighlightSpans(editor.state.doc, [
      {
        paragraphId: "p1",
        startOffset: 8,
        endOffset: 15,
        kind: "repetition",
      },
    ]);

    expect(spans).toHaveLength(1);
    expect(editor.state.doc.textBetween(spans[0].from, spans[0].to, "")).toBe("privacy");
  });

  it("uses decorations without mutating TipTap JSON or firing update", () => {
    const editor = createTestEditor(
      '<p data-paragraph-id="p1">Privacy privacy database.</p>',
    );
    const onUpdate = vi.fn();
    editor.on("update", onUpdate);
    const before = editor.state.doc.toJSON();

    const resolvedCount = setAnalyticsHighlights(editor, [
      { paragraphId: "p1", startOffset: 0, endOffset: 7, kind: "repetition" },
      { paragraphId: "p1", startOffset: 8, endOffset: 15, kind: "repetition" },
    ]);

    expect(resolvedCount).toBe(2);
    expect(decorationRanges(editor)).toHaveLength(2);
    expect(decorationTexts(editor)).toEqual(["Privacy", "privacy"]);
    expect(editor.state.doc.toJSON()).toEqual(before);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("clears highlights without mutating document content", () => {
    const editor = createTestEditor(
      '<p data-paragraph-id="p1">However, privacy matters.</p>',
    );
    const before = editor.state.doc.toJSON();

    setAnalyticsHighlights(editor, [{ paragraphId: "p1", startOffset: 0, endOffset: 7, kind: "transition" }]);
    clearAnalyticsHighlights(editor);

    expect(decorationRanges(editor)).toHaveLength(0);
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it("clears stale highlight decorations when the document changes", () => {
    const editor = createTestEditor(
      '<p data-paragraph-id="p1">Privacy privacy database.</p>',
    );

    setAnalyticsHighlights(editor, [{ paragraphId: "p1", startOffset: 0, endOffset: 7, kind: "repetition" }]);
    expect(decorationRanges(editor)).toHaveLength(1);

    editor.commands.setTextSelection(1);
    editor.commands.insertContent("New ");

    expect(decorationRanges(editor)).toHaveLength(0);
  });

  it("ignores missing paragraphs and invalid offsets safely", () => {
    const editor = createTestEditor('<p data-paragraph-id="p1">Privacy.</p>');

    expect(
      resolveAnalyticsHighlightSpans(editor.state.doc, [
        { paragraphId: "missing", startOffset: 0, endOffset: 7, kind: "repetition" },
        { paragraphId: "p1", startOffset: 0, endOffset: 70, kind: "repetition" },
      ]),
    ).toEqual([]);
  });
});
