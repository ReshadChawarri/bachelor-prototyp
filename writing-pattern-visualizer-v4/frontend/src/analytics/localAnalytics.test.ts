import { describe, expect, it } from "vitest";
import {
  calculateLocalWritingAnalytics,
  categorizeSentenceLength,
  countWords,
  splitSentences,
} from "./localAnalytics";
import type { DocumentModel, ParagraphBlock } from "../types/document";

function documentWithBlocks(blocks: ParagraphBlock[]): DocumentModel {
  return {
    documentId: "test-document",
    revision: 0,
    title: "Test document",
    paragraphs: blocks,
  };
}

function block(id: string, text: string, overrides: Partial<ParagraphBlock> = {}): ParagraphBlock {
  return {
    id,
    type: "paragraph",
    blockType: "paragraph",
    order: Number(id.replace(/\D/g, "")) || 0,
    text,
    ...overrides,
  };
}

describe("local writing analytics", () => {
  it("counts words with punctuation, apostrophes, hyphens, numbers, and umlauts", () => {
    expect(countWords("Außerdem uses AI-assisted examples, don't split 2026 data.")).toBe(8);
  });

  it("splits sentences while keeping common abbreviations inside the sentence", () => {
    const sentences = splitSentences("Dr. Smith uses e.g. short examples. Does this work? Yes!");

    expect(sentences).toEqual(["Dr. Smith uses e.g. short examples.", "Does this work?", "Yes!"]);
  });

  it("returns empty metrics for an empty document", () => {
    const analytics = calculateLocalWritingAnalytics(documentWithBlocks([]));

    expect(analytics.overview.wordCount).toBe(0);
    expect(analytics.overview.sentenceCount).toBe(0);
    expect(analytics.overview.paragraphCount).toBe(0);
    expect(analytics.overview.averageSentenceLength).toBe(0);
    expect(analytics.paragraphLengths).toEqual([]);
    expect(analytics.sentenceDistribution.every((bucket) => bucket.count === 0)).toBe(true);
  });

  it("calculates overview metrics across multiple prose paragraphs", () => {
    const analytics = calculateLocalWritingAnalytics(
      documentWithBlocks([
        block("p1", "Academic writing often combines evidence with interpretation."),
        block("p2", "Another paragraph adds context. It also changes rhythm."),
      ]),
    );

    expect(analytics.overview.wordCount).toBe(15);
    expect(analytics.overview.sentenceCount).toBe(3);
    expect(analytics.overview.paragraphCount).toBe(2);
    expect(analytics.overview.averageSentenceLength).toBeCloseTo(15 / 3);
  });

  it("calculates paragraph word counts with stable paragraph IDs and order labels", () => {
    const analytics = calculateLocalWritingAnalytics(
      documentWithBlocks([
        block("stable-a", "First paragraph has four words."),
        block("stable-b", "Second paragraph has exactly five words."),
      ]),
    );

    expect(analytics.paragraphLengths).toEqual([
      expect.objectContaining({ paragraphId: "stable-a", label: "P1", wordCount: 5 }),
      expect.objectContaining({ paragraphId: "stable-b", label: "P2", wordCount: 6 }),
    ]);
  });

  it("assigns sentence length categories from centralized thresholds", () => {
    expect(categorizeSentenceLength(7)).toBe("Short");
    expect(categorizeSentenceLength(8)).toBe("Medium");
    expect(categorizeSentenceLength(20)).toBe("Medium");
    expect(categorizeSentenceLength(21)).toBe("Long");
    expect(categorizeSentenceLength(30)).toBe("Long");
    expect(categorizeSentenceLength(31)).toBe("Very long");
  });

  it("builds a sentence length distribution", () => {
    const analytics = calculateLocalWritingAnalytics(
      documentWithBlocks([
        block(
          "p1",
          [
            "One two three four five six seven.",
            "One two three four five six seven eight.",
            "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone.",
            "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour twentyfive twentysix twentyseven twentyeight twentynine thirty thirtyone.",
          ].join(" "),
        ),
      ]),
    );

    expect(analytics.sentenceDistribution).toEqual([
      expect.objectContaining({ category: "Short", count: 1 }),
      expect.objectContaining({ category: "Medium", count: 1 }),
      expect.objectContaining({ category: "Long", count: 1 }),
      expect.objectContaining({ category: "Very long", count: 1 }),
    ]);
  });

  it("excludes known non-prose blocks and counts headings separately", () => {
    const analytics = calculateLocalWritingAnalytics(
      documentWithBlocks([
        block("h1", "Introduction", { type: "heading", blockType: "heading", headingLevel: 1 }),
        block("p1", "Only this prose paragraph is analyzed."),
        block("m1", "Author Name, University", { blockType: "metadata" }),
        block("c1", "Figure 1: A caption.", { blockType: "caption" }),
        block("t1", "A | B\n1 | 2", { blockType: "table" }),
        block("f1", "[Figure/image detected]", { blockType: "figure" }),
        block("l1", "A list item is not prose paragraph analytics.", { blockType: "list" }),
      ]),
    );

    expect(analytics.overview.paragraphCount).toBe(1);
    expect(analytics.overview.wordCount).toBe(6);
    expect(analytics.overview.headingCount).toBe(1);
    expect(analytics.overview.excludedBlockCount).toBe(5);
    expect(analytics.paragraphLengths).toHaveLength(1);
    expect(analytics.paragraphLengths[0].paragraphId).toBe("p1");
  });
});
