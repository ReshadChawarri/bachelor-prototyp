import type { ImportedPdfDocument, ImportedContentBlock } from "../types/document";

const NUMBERED_HEADING_PATTERN = /^\d+(?:\.\d+)*\.?\s+\S.{0,90}$/;

const COMMON_HEADING_PATTERN =
  /^(text [xy]|abstract|introduction|background|related work|method|methods|methodology|results|discussion|conclusion|references|fazit|einleitung|methode|methodik|ergebnisse|diskussion|literatur)$/i;

export function studyTextToImportedDocument(text: string, filename: string): ImportedPdfDocument {
  const blocks = studyTextToBlocks(text);
  return {
    filename,
    page_count: 1,
    character_count: text.length,
    blocks,
  };
}

export function studyTextToBlocks(text: string): ImportedContentBlock[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      if (isLikelyStudyHeading(block)) {
        return {
          kind: "heading",
          heading_level: headingLevelForStudyText(block),
          text: normalizeBlockText(block),
        };
      }
      return {
        kind: "paragraph",
        text: normalizeBlockText(block),
      };
    });
}

function normalizeBlockText(block: string): string {
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function isLikelyStudyHeading(block: string): boolean {
  const normalized = normalizeBlockText(block);
  if (normalized.length > 96 || /[.!?]$/.test(normalized)) {
    return false;
  }
  return NUMBERED_HEADING_PATTERN.test(normalized) || COMMON_HEADING_PATTERN.test(normalized);
}

function headingLevelForStudyText(block: string): 1 | 2 | 3 {
  const normalized = normalizeBlockText(block);
  const numbering = normalized.match(/^(\d+(?:\.\d+)*)/);
  if (!numbering) {
    return 1;
  }
  const depth = numbering[1].split(".").length;
  return depth >= 3 ? 3 : depth === 2 ? 2 : 1;
}
