import type { JSONContent } from "@tiptap/core";
import { createParagraphId } from "./paragraphIdentity";
import type { ImportedContentBlock, ImportedPdfDocument, TextSpan } from "../types/document";

export function importedPdfToTipTapDocument(document: ImportedPdfDocument): JSONContent {
  return {
    type: "doc",
    content: document.blocks.flatMap(blockToTipTapNodes),
  };
}

function blockToTipTapNodes(block: ImportedContentBlock): JSONContent[] {
  if (block.kind === "heading") {
    return [
      {
        type: "heading",
        attrs: {
          level: normalizeHeadingLevel(block.heading_level),
          paragraphId: createParagraphId(),
          blockType: "heading",
        },
        content: spanContent(block),
      },
    ];
  }

  if (block.kind === "list") {
    return [
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                attrs: { paragraphId: createParagraphId(), blockType: "list" },
                content: spanContent(block),
              },
            ],
          },
        ],
      },
    ];
  }

  return [
    {
      type: "paragraph",
      attrs: { paragraphId: createParagraphId(), blockType: block.kind },
      content: spanContent(block),
    },
  ];
}

function spanContent(block: ImportedContentBlock): JSONContent[] {
  const spans = block.spans && block.spans.length > 0 ? block.spans : [{ text: block.text }];
  return spans
    .filter((span) => span.text.length > 0)
    .map((span) => ({
      type: "text",
      text: span.text,
      marks: marksForSpan(span),
    }))
    .map((node) => {
      if (!node.marks || node.marks.length === 0) {
        const { marks: _marks, ...withoutMarks } = node;
        return withoutMarks;
      }
      return node;
    });
}

function marksForSpan(span: TextSpan): JSONContent[] {
  const marks: JSONContent[] = [];
  if (span.bold) {
    marks.push({ type: "bold" });
  }
  if (span.italic) {
    marks.push({ type: "italic" });
  }
  return marks;
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
