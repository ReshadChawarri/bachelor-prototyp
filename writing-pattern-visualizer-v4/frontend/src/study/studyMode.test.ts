import { describe, expect, it } from "vitest";
import { studyTextToBlocks, studyTextToImportedDocument } from "./studyText";
import { buildTaskRevisionSummary, documentToPlainText } from "./studySummary";
import { revisionGeneratedPayload, revisionRequestedPayload } from "./revisionEvents";
import type { SuggestRevisionRequest, SuggestRevisionResponse } from "../types/aiAnalysis";
import type { DocumentModel } from "../types/document";

describe("Study Mode utilities", () => {
  it("turns replaceable study text into heading and prose blocks", () => {
    const blocks = studyTextToBlocks("Text X\n\n1 Introduction\n\nA wrapped\nparagraph continues.");

    expect(blocks).toEqual([
      { kind: "heading", heading_level: 1, text: "Text X" },
      { kind: "heading", heading_level: 1, text: "1 Introduction" },
      { kind: "paragraph", text: "A wrapped paragraph continues." },
    ]);
    expect(studyTextToImportedDocument("Text X\n\nBody paragraph.", "text-x.txt")).toMatchObject({
      filename: "text-x.txt",
      blocks: expect.any(Array),
    });
  });

  it("builds final text and aggregate summary without storing edit history", () => {
    const document: DocumentModel = {
      documentId: "S-P01",
      revision: 3,
      title: "Study Text X",
      paragraphs: [
        { id: "h-1", type: "heading", blockType: "heading", order: 0, text: "1 Introduction", headingLevel: 1 },
        { id: "p-1", type: "paragraph", blockType: "paragraph", order: 1, text: "Changed prose paragraph." },
        { id: "p-2", type: "paragraph", blockType: "caption", order: 2, text: "Figure 1: Excluded caption." },
      ],
    };

    expect(documentToPlainText(document)).toBe("1 Introduction\n\nChanged prose paragraph.\n\nFigure 1: Excluded caption.");
    expect(
      buildTaskRevisionSummary(
        [
          { kind: "heading", text: "1 Introduction" },
          { kind: "paragraph", text: "Original prose paragraph." },
        ],
        document,
      ),
    ).toEqual({
      initialWordCount: 3,
      finalWordCount: 3,
      changedParagraphCount: 1,
      addedWordEstimate: 0,
      removedWordEstimate: 0,
    });
  });

  it("creates revision event payloads without full source or revised text", () => {
    const request: SuggestRevisionRequest = {
      documentId: "S-P01",
      revision: 4,
      requestId: "revision-4-1",
      language: "English",
      action: "adjust_paragraph_length",
      sourceContentHash: "hash",
      targetWordCount: 30,
      paragraph: {
        paragraphId: "p-1",
        text: "This full paragraph text should only be used for counting and must not appear in the event payload.",
      },
      context: {
        nearestHeading: "1 Introduction",
        previousParagraph: null,
        nextParagraph: null,
      },
    };
    const response: SuggestRevisionResponse = {
      documentId: "S-P01",
      sourceRevision: 4,
      requestId: "revision-4-1",
      paragraphId: "p-1",
      sourceContentHash: "hash",
      action: "adjust_paragraph_length",
      model: "gpt-5.6-luna",
      revisionVersion: "paragraph-revision-v1",
      suggestion: {
        revisedText: "A proposed revision must not be logged.",
        summary: "Shortens the paragraph.",
      },
      length: {
        originalWordCount: 16,
        targetWordCount: 30,
        revisedWordCount: 28,
        withinTolerance: true,
      },
    };

    const requested = revisionRequestedPayload(request);
    const generated = revisionGeneratedPayload(response, 1234);

    expect(requested).toEqual({
      paragraphId: "p-1",
      action: "adjust_paragraph_length",
      currentWordCount: 18,
      targetWordCount: 30,
    });
    expect(generated).toMatchObject({
      paragraphId: "p-1",
      action: "adjust_paragraph_length",
      generationLatencyMs: 1234,
      suggestedWordCount: 28,
    });
    expect(JSON.stringify([requested, generated])).not.toContain("full paragraph text");
    expect(JSON.stringify([requested, generated])).not.toContain("proposed revision");
  });
});
