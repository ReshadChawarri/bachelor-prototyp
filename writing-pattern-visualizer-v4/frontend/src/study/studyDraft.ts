import type { DocumentModel, ImportedContentBlock, ImportedPdfDocument } from "../types/document";

const DRAFT_PREFIX = "wpv.remoteStudy.draft.";

export interface RemoteStudyDraft {
  token: string;
  documentId: string;
  title: string;
  document: DocumentModel;
  initialBlocks: ImportedContentBlock[];
}

export function saveRemoteStudyDraft(token: string, draft: Omit<RemoteStudyDraft, "token">) {
  window.localStorage.setItem(storageKey(token), JSON.stringify({ ...draft, token }));
}

export function loadRemoteStudyDraft(token: string, documentId: string): RemoteStudyDraft | null {
  const raw = window.localStorage.getItem(storageKey(token));
  if (!raw) {
    return null;
  }

  try {
    const draft = JSON.parse(raw) as RemoteStudyDraft;
    if (draft.token === token && draft.documentId === documentId && draft.document.documentId === documentId) {
      return draft;
    }
  } catch {
    return null;
  }

  return null;
}

export function clearRemoteStudyDraft(token: string) {
  window.localStorage.removeItem(storageKey(token));
}

export function documentModelToImportedDocument(document: DocumentModel, filename: string): ImportedPdfDocument {
  const blocks: ImportedContentBlock[] = [...document.paragraphs]
    .sort((left, right) => left.order - right.order)
    .map((block) => ({
      kind: block.blockType,
      paragraph_id: block.id,
      text: block.text,
      heading_level: block.headingLevel ?? null,
    }));

  return {
    filename,
    page_count: 1,
    character_count: blocks.reduce((total, block) => total + block.text.length, 0),
    blocks,
  };
}

function storageKey(token: string): string {
  return `${DRAFT_PREFIX}${token}`;
}
