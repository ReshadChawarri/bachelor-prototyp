export type TextBlockType = "paragraph" | "heading";

export interface ParagraphBlock {
  id: string;
  type: TextBlockType;
  order: number;
  text: string;
  headingLevel?: number;
  listType?: "bulletList" | "orderedList";
}

export interface DocumentModel {
  documentId: string;
  revision: number;
  title: string;
  paragraphs: ParagraphBlock[];
}

export interface EditorSelection {
  paragraphId: string | null;
}

