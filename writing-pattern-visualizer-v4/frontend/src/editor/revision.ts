import type { Editor } from "@tiptap/core";

export type ParagraphRevisionApplyResult =
  | { applied: true }
  | { applied: false; reason: "missing" | "stale" | "invalid" };

export function paragraphContentHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function replaceParagraphTextById(
  editor: Editor,
  paragraphId: string,
  sourceContentHash: string,
  revisedText: string,
): ParagraphRevisionApplyResult {
  const normalizedText = normalizeRevisionParagraphText(revisedText);
  if (!normalizedText) {
    return { applied: false, reason: "invalid" };
  }

  const target = findEditableParagraph(editor, paragraphId);
  if (!target) {
    return { applied: false, reason: "missing" };
  }

  if (paragraphContentHash(target.text) !== sourceContentHash) {
    return { applied: false, reason: "stale" };
  }

  if (target.text === normalizedText) {
    return { applied: true };
  }

  const from = target.position + 1;
  const to = target.position + target.nodeSize - 1;
  const transaction = editor.state.tr.insertText(normalizedText, from, to);
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
  return { applied: true };
}

function findEditableParagraph(editor: Editor, paragraphId: string): { position: number; nodeSize: number; text: string } | null {
  let target: { position: number; nodeSize: number; text: string } | null = null;

  editor.state.doc.descendants((node, position) => {
    if (target) {
      return false;
    }

    if (node.type.name !== "paragraph") {
      return true;
    }

    if (node.attrs.paragraphId !== paragraphId || node.attrs.blockType !== "paragraph") {
      return true;
    }

    target = {
      position,
      nodeSize: node.nodeSize,
      text: node.textContent,
    };
    return false;
  });

  return target;
}

function normalizeRevisionParagraphText(text: string): string {
  return text.replace(/\s*\n+\s*/g, " ").trim();
}
