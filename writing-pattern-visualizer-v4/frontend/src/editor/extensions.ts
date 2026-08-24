import Heading from "@tiptap/extension-heading";
import Paragraph from "@tiptap/extension-paragraph";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import type { Extensions } from "@tiptap/core";
import { AnalyticsHighlight } from "./analyticsHighlight";
import { ParagraphIdentity } from "./paragraphIdentity";

const persistentParagraphAttributes = {
  paragraphId: {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute("data-paragraph-id"),
    renderHTML: (attributes: { paragraphId?: string | null }) => {
      if (!attributes.paragraphId) {
        return {};
      }
      return { "data-paragraph-id": attributes.paragraphId };
    },
  },
  blockType: {
    default: "paragraph",
    parseHTML: (element: HTMLElement) => element.getAttribute("data-block-type") || "paragraph",
    renderHTML: (attributes: { blockType?: string | null }) => {
      if (!attributes.blockType) {
        return {};
      }
      return { "data-block-type": attributes.blockType };
    },
  },
};

const PersistentParagraph = Paragraph.extend({
  addAttributes() {
    return persistentParagraphAttributes;
  },
});

const PersistentHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...persistentParagraphAttributes,
    };
  },
});

export function createEditorExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: false,
      paragraph: false,
    }),
    PersistentParagraph,
    PersistentHeading.configure({ levels: [1, 2, 3] }),
    Underline,
    ParagraphIdentity,
    AnalyticsHighlight,
  ];
}
