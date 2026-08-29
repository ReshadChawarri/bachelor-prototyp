import { afterEach, describe, expect, it } from "vitest";
import type { DocumentModel } from "../types/document";
import { clearRemoteStudyDraft, documentModelToImportedDocument, loadRemoteStudyDraft, saveRemoteStudyDraft } from "./studyDraft";

const DOCUMENT: DocumentModel = {
  documentId: "doc_remote",
  revision: 4,
  title: "Academic Text Revision Task",
  paragraphs: [
    {
      id: "p_second",
      type: "paragraph",
      order: 2,
      blockType: "paragraph",
      text: "Second paragraph.",
    },
    {
      id: "h_intro",
      type: "heading",
      order: 1,
      blockType: "heading",
      headingLevel: 1,
      text: "1 Introduction",
    },
  ],
};

describe("remote study draft storage", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("restores only drafts that match the token and active document ID", () => {
    saveRemoteStudyDraft("t_token1234567890", {
      documentId: "doc_remote",
      title: "Draft",
      document: DOCUMENT,
      initialBlocks: [],
    });

    expect(loadRemoteStudyDraft("t_token1234567890", "doc_remote")).toMatchObject({
      title: "Draft",
      document: {
        documentId: "doc_remote",
      },
    });
    expect(loadRemoteStudyDraft("t_token1234567890", "doc_other")).toBeNull();
    expect(loadRemoteStudyDraft("t_other1234567890", "doc_remote")).toBeNull();
  });

  it("serializes drafts back into importable blocks without changing stable IDs", () => {
    const imported = documentModelToImportedDocument(DOCUMENT, "text-x.txt");

    expect(imported.blocks).toEqual([
      {
        kind: "heading",
        paragraph_id: "h_intro",
        text: "1 Introduction",
        heading_level: 1,
      },
      {
        kind: "paragraph",
        paragraph_id: "p_second",
        text: "Second paragraph.",
        heading_level: null,
      },
    ]);
  });

  it("clears the browser draft for a completed token", () => {
    saveRemoteStudyDraft("t_token1234567890", {
      documentId: "doc_remote",
      title: "Draft",
      document: DOCUMENT,
      initialBlocks: [],
    });

    clearRemoteStudyDraft("t_token1234567890");

    expect(loadRemoteStudyDraft("t_token1234567890", "doc_remote")).toBeNull();
  });
});
