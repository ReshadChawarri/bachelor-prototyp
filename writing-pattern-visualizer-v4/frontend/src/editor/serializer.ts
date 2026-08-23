import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { DocumentModel, ParagraphBlock } from "../types/document";

export function serializeDocument(editor: Editor, title: string, revision: number): DocumentModel {
  const paragraphs: ParagraphBlock[] = [];

  walkDocument(editor.state.doc, [], (node, ancestors) => {
    if (node.type.name !== "paragraph" && node.type.name !== "heading") {
      return;
    }

    const paragraphId = node.attrs.paragraphId;
    if (typeof paragraphId !== "string" || paragraphId.length === 0) {
      return;
    }

    paragraphs.push({
      id: paragraphId,
      type: node.type.name === "heading" ? "heading" : "paragraph",
      order: paragraphs.length,
      text: node.textContent,
      headingLevel: node.type.name === "heading" ? node.attrs.level : undefined,
      listType: listTypeFromAncestors(ancestors),
    });
  });

  return {
    documentId: "local-draft",
    revision,
    title,
    paragraphs,
  };
}

function walkDocument(
  node: ProseMirrorNode,
  ancestors: string[],
  visit: (node: ProseMirrorNode, ancestors: string[]) => void,
) {
  visit(node, ancestors);
  node.forEach((child) => {
    walkDocument(child, [...ancestors, node.type.name], visit);
  });
}

function listTypeFromAncestors(ancestors: string[]): "bulletList" | "orderedList" | undefined {
  if (ancestors.includes("orderedList")) {
    return "orderedList";
  }
  if (ancestors.includes("bulletList")) {
    return "bulletList";
  }
  return undefined;
}
