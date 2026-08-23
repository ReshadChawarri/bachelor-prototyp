import type { JSONContent } from "@tiptap/core";
import { createParagraphId } from "./paragraphIdentity";
import type { ImportedPdfDocument } from "../types/document";

export function importedPdfToTipTapDocument(document: ImportedPdfDocument): JSONContent {
  return {
    type: "doc",
    content: document.blocks.map((block) => {
      const paragraphId = createParagraphId();
      const content = block.text ? [{ type: "text", text: block.text }] : [];

      if (block.kind === "heading") {
        return {
          type: "heading",
          attrs: {
            level: normalizeHeadingLevel(block.heading_level),
            paragraphId,
          },
          content,
        };
      }

      return {
        type: "paragraph",
        attrs: { paragraphId },
        content,
      };
    }),
  };
}

function normalizeHeadingLevel(level: number | null | undefined): 1 | 2 | 3 {
  if (level === 2) {
    return 2;
  }
  if (level === 3) {
    return 3;
  }
  return 1;
}
