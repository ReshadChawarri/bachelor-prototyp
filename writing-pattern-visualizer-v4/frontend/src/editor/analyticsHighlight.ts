import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type AnalyticsHighlightKind = "repetition" | "transition";

export interface AnalyticsHighlightSpan {
  paragraphId: string;
  startOffset: number;
  endOffset: number;
  kind: AnalyticsHighlightKind;
}

export interface ResolvedHighlightSpan {
  from: number;
  to: number;
  kind: AnalyticsHighlightKind;
}

type AnalyticsHighlightMeta =
  | {
      type: "set";
      spans: AnalyticsHighlightSpan[];
    }
  | {
      type: "clear";
    };

export const analyticsHighlightPluginKey = new PluginKey<DecorationSet>("analyticsHighlight");

export const AnalyticsHighlight = Extension.create({
  name: "analyticsHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: analyticsHighlightPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, previousDecorations, _oldState, newState) {
            const meta = transaction.getMeta(analyticsHighlightPluginKey) as AnalyticsHighlightMeta | undefined;

            if (meta?.type === "clear") {
              return DecorationSet.empty;
            }

            if (meta?.type === "set") {
              return DecorationSet.create(
                newState.doc,
                resolveAnalyticsHighlightSpans(newState.doc, meta.spans).map((span) =>
                  Decoration.inline(span.from, span.to, {
                    class: `analytics-editor-highlight ${span.kind}`,
                  }),
                ),
              );
            }

            if (transaction.docChanged) {
              return DecorationSet.empty;
            }

            return previousDecorations.map(transaction.mapping, transaction.doc);
          },
        },
        props: {
          decorations(state) {
            return analyticsHighlightPluginKey.getState(state);
          },
        },
      }),
    ];
  },
});

export function setAnalyticsHighlights(editor: Editor, spans: AnalyticsHighlightSpan[]): number {
  const resolvedSpans = resolveAnalyticsHighlightSpans(editor.state.doc, spans);
  const transaction = editor.state.tr.setMeta(analyticsHighlightPluginKey, {
    type: "set",
    spans,
  } satisfies AnalyticsHighlightMeta);
  transaction.setMeta("addToHistory", false);
  editor.view.dispatch(transaction);
  return resolvedSpans.length;
}

export function clearAnalyticsHighlights(editor: Editor): void {
  const transaction = editor.state.tr.setMeta(analyticsHighlightPluginKey, {
    type: "clear",
  } satisfies AnalyticsHighlightMeta);
  transaction.setMeta("addToHistory", false);
  editor.view.dispatch(transaction);
}

export function resolveAnalyticsHighlightSpans(
  documentNode: ProseMirrorNode,
  spans: AnalyticsHighlightSpan[],
): ResolvedHighlightSpan[] {
  return spans.flatMap((span) => {
    const paragraphTarget = findParagraphNode(documentNode, span.paragraphId);
    if (!paragraphTarget) {
      return [];
    }

    const from = textOffsetToDocumentPosition(paragraphTarget.node, paragraphTarget.position, span.startOffset);
    const to = textOffsetToDocumentPosition(paragraphTarget.node, paragraphTarget.position, span.endOffset);

    if (from === null || to === null || to <= from) {
      return [];
    }

    return [{ from, to, kind: span.kind }];
  });
}

function findParagraphNode(
  documentNode: ProseMirrorNode,
  paragraphId: string,
): { node: ProseMirrorNode; position: number } | null {
  let target: { node: ProseMirrorNode; position: number } | null = null;

  documentNode.descendants((node, position) => {
    if (target) {
      return false;
    }

    if (node.type.name !== "paragraph") {
      return true;
    }

    if (node.attrs.paragraphId === paragraphId && node.attrs.blockType === "paragraph") {
      target = { node, position };
      return false;
    }

    return true;
  });

  return target;
}

function textOffsetToDocumentPosition(
  paragraphNode: ProseMirrorNode,
  paragraphPosition: number,
  requestedOffset: number,
): number | null {
  if (requestedOffset < 0 || requestedOffset > paragraphNode.textContent.length) {
    return null;
  }

  if (requestedOffset === 0) {
    return paragraphPosition + 1;
  }

  let consumedText = 0;
  let resolvedPosition: number | null = null;

  paragraphNode.descendants((node, relativePosition) => {
    if (resolvedPosition !== null) {
      return false;
    }

    const text = node.isText ? node.text ?? "" : node.textContent;
    if (!text) {
      return true;
    }

    const nextConsumedText = consumedText + text.length;
    if (requestedOffset <= nextConsumedText) {
      resolvedPosition = paragraphPosition + 1 + relativePosition + (requestedOffset - consumedText);
      return false;
    }

    consumedText = nextConsumedText;
    return true;
  });

  return resolvedPosition;
}
