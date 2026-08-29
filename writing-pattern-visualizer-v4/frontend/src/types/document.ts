export type TextBlockType = "paragraph" | "heading";
export type ImportedBlockKind = "paragraph" | "heading" | "metadata" | "list" | "caption" | "table" | "figure";

export interface TextSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export interface ParagraphBlock {
  id: string;
  type: TextBlockType;
  blockType: ImportedBlockKind;
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
  kind: ImportedBlockKind;
  text: string;
  paragraph_id?: string;
  heading_level?: number | null;
  spans?: TextSpan[];
  rows?: string[][] | null;
  page_number?: number | null;
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
