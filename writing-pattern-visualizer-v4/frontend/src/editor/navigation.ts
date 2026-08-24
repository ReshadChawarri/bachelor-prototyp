import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

export type NavigableNodeType = "paragraph" | "heading";

export interface DocumentNodeTarget {
  nodeId: string;
  position: number;
  selectionPosition: number;
  nodeType: NavigableNodeType;
}

export function findDocumentNodeTarget(
  editor: Editor,
  nodeId: string,
  expectedType?: NavigableNodeType,
): DocumentNodeTarget | null {
  let target: DocumentNodeTarget | null = null;

  editor.state.doc.descendants((node, position) => {
    if (target) {
      return false;
    }

    if (node.type.name !== "paragraph" && node.type.name !== "heading") {
      return true;
    }

    if (node.attrs.paragraphId !== nodeId) {
      return true;
    }

    const nodeType = node.type.name as NavigableNodeType;
    if (expectedType && nodeType !== expectedType) {
      return false;
    }

    if (expectedType === "paragraph" && node.attrs.blockType !== "paragraph") {
      return false;
    }

    target = {
      nodeId,
      position,
      selectionPosition: position + 1,
      nodeType,
    };
    return false;
  });

  return target;
}

export function selectDocumentNode(editor: Editor, target: DocumentNodeTarget): boolean {
  try {
    const resolvedPosition = editor.state.doc.resolve(target.selectionPosition);
    const selection = TextSelection.near(resolvedPosition, 1);
    const transaction = editor.state.tr.setSelection(selection);
    transaction.setMeta("addToHistory", false);
    editor.view.dispatch(transaction);
    editor.view.focus();
    return true;
  } catch {
    return false;
  }
}
