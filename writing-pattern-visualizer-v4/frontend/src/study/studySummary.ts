import type { DocumentModel, ImportedContentBlock, ParagraphBlock } from "../types/document";

const WORD_PATTERN = /[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu;

export function documentToPlainText(document: DocumentModel): string {
  return [...document.paragraphs]
    .sort((left, right) => left.order - right.order)
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function buildTaskRevisionSummary(initialBlocks: ImportedContentBlock[], finalDocument: DocumentModel) {
  const initialParagraphs = initialBlocks.filter((block) => block.kind === "paragraph").map((block) => block.text.trim());
  const finalParagraphs = proseParagraphs(finalDocument).map((paragraph) => paragraph.text.trim());
  const initialWordCount = countStudyWords(initialParagraphs.join(" "));
  const finalWordCount = countStudyWords(finalParagraphs.join(" "));
  const maxLength = Math.max(initialParagraphs.length, finalParagraphs.length);
  let changedParagraphCount = 0;

  for (let index = 0; index < maxLength; index += 1) {
    if ((initialParagraphs[index] ?? "") !== (finalParagraphs[index] ?? "")) {
      changedParagraphCount += 1;
    }
  }

  return {
    initialWordCount,
    finalWordCount,
    changedParagraphCount,
    addedWordEstimate: Math.max(0, finalWordCount - initialWordCount),
    removedWordEstimate: Math.max(0, initialWordCount - finalWordCount),
  };
}

export function countStudyWords(text: string): number {
  return text.match(WORD_PATTERN)?.length ?? 0;
}

function proseParagraphs(document: DocumentModel): ParagraphBlock[] {
  return [...document.paragraphs]
    .sort((left, right) => left.order - right.order)
    .filter((block) => block.type === "paragraph" && block.blockType === "paragraph");
}
