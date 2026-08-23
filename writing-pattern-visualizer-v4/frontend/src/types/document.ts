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

export interface ImportedContentBlock {
  kind: "paragraph" | "heading";
  text: string;
  heading_level?: number | null;
}

export interface ImportedPdfDocument {
  filename: string;
  page_count: number;
  character_count: number;
  blocks: ImportedContentBlock[];
}

export interface ImportRequest {
  requestId: number;
  document: ImportedPdfDocument;
}
