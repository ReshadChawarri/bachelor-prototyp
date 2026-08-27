import type { DocumentModel, ParagraphBlock } from "../types/document";

export type SentenceLengthCategory = "Short" | "Medium" | "Long" | "Very long";

export interface ParagraphLengthMetric {
  paragraphId: string;
  label: string;
  order: number;
  wordCount: number;
  textPreview: string;
}

export interface SentenceLengthMetric {
  paragraphId: string;
  sentenceIndex: number;
  text: string;
  wordCount: number;
  category: SentenceLengthCategory;
}

export interface SentenceDistributionMetric {
  category: SentenceLengthCategory;
  count: number;
  rangeLabel: string;
}

export interface LocalWritingAnalytics {
  overview: {
    wordCount: number;
    sentenceCount: number;
    paragraphCount: number;
    headingCount: number;
    averageSentenceLength: number;
    excludedBlockCount: number;
  };
  paragraphLengths: ParagraphLengthMetric[];
  sentenceLengths: SentenceLengthMetric[];
  sentenceDistribution: SentenceDistributionMetric[];
}

// Centralized deterministic thresholds for the non-evaluative sentence length distribution.
export const SENTENCE_LENGTH_THRESHOLDS = {
  shortMaxWords: 7,
  mediumMaxWords: 20,
  longMaxWords: 30,
} as const;

export const SENTENCE_DISTRIBUTION_ORDER: SentenceLengthCategory[] = ["Short", "Medium", "Long", "Very long"];

export const SENTENCE_RANGE_LABELS: Record<SentenceLengthCategory, string> = {
  Short: "1-7 words",
  Medium: "8-20 words",
  Long: "21-30 words",
  "Very long": "31+ words",
};

const COMMON_ABBREVIATIONS = [
  "e.g.",
  "i.e.",
  "etc.",
  "fig.",
  "dr.",
  "mr.",
  "mrs.",
  "ms.",
  "prof.",
  "vs.",
  "cf.",
  "no.",
];

const WORD_PATTERN = /[\p{L}\p{M}\p{N}]+(?:[’'-][\p{L}\p{M}\p{N}]+)*/gu;
const SENTENCE_PATTERN = /[^.!?]+(?:[.!?]+["')\]]*)+|[^.!?]+$/g;
const ABBREVIATION_DOT_PLACEHOLDER = "<DOT>";

export function calculateLocalWritingAnalytics(document: DocumentModel): LocalWritingAnalytics {
  const proseParagraphs = document.paragraphs.filter(isProseParagraph);
  const headingCount = document.paragraphs.filter(isHeadingBlock).length;
  const excludedBlockCount = document.paragraphs.filter(isExcludedFromProseAnalytics).length;

  const paragraphLengths = proseParagraphs.map((paragraph, index) => ({
    paragraphId: paragraph.id,
    label: `P${index + 1}`,
    order: index,
    wordCount: countWords(paragraph.text),
    textPreview: previewText(paragraph.text),
  }));

  const sentenceLengths = proseParagraphs.flatMap((paragraph) =>
    splitSentences(paragraph.text).map((sentence, sentenceIndex) => {
      const wordCount = countWords(sentence);
      return {
        paragraphId: paragraph.id,
        sentenceIndex,
        text: sentence,
        wordCount,
        category: categorizeSentenceLength(wordCount),
      };
    }),
  );

  const wordCount = paragraphLengths.reduce((total, paragraph) => total + paragraph.wordCount, 0);
  const sentenceCount = sentenceLengths.length;

  return {
    overview: {
      wordCount,
      sentenceCount,
      paragraphCount: proseParagraphs.length,
      headingCount,
      averageSentenceLength: sentenceCount > 0 ? wordCount / sentenceCount : 0,
      excludedBlockCount,
    },
    paragraphLengths,
    sentenceLengths,
    sentenceDistribution: buildSentenceDistribution(sentenceLengths),
  };
}

export function countWords(text: string): number {
  return normalizedWhitespace(text).match(WORD_PATTERN)?.length ?? 0;
}

export function splitSentences(text: string): string[] {
  const normalized = normalizedWhitespace(text);
  if (!normalized) {
    return [];
  }

  const protectedText = protectSentenceInternalPeriods(normalized);
  const matches = protectedText.match(SENTENCE_PATTERN) ?? [];

  return matches
    .map((sentence) => sentence.split(ABBREVIATION_DOT_PLACEHOLDER).join(".").trim())
    .filter((sentence) => countWords(sentence) > 0);
}

export function categorizeSentenceLength(wordCount: number): SentenceLengthCategory {
  if (wordCount <= SENTENCE_LENGTH_THRESHOLDS.shortMaxWords) {
    return "Short";
  }
  if (wordCount <= SENTENCE_LENGTH_THRESHOLDS.mediumMaxWords) {
    return "Medium";
  }
  if (wordCount <= SENTENCE_LENGTH_THRESHOLDS.longMaxWords) {
    return "Long";
  }
  return "Very long";
}

export function isProseParagraph(block: ParagraphBlock): boolean {
  return block.type === "paragraph" && block.blockType === "paragraph";
}

function isHeadingBlock(block: ParagraphBlock): boolean {
  return block.type === "heading" || block.blockType === "heading";
}

function isExcludedFromProseAnalytics(block: ParagraphBlock): boolean {
  return !isProseParagraph(block) && !isHeadingBlock(block);
}

export function buildSentenceDistribution(sentenceLengths: SentenceLengthMetric[]): SentenceDistributionMetric[] {
  const counts = new Map<SentenceLengthCategory, number>();
  sentenceLengths.forEach((sentence) => {
    counts.set(sentence.category, (counts.get(sentence.category) ?? 0) + 1);
  });

  return SENTENCE_DISTRIBUTION_ORDER.map((category) => ({
    category,
    count: counts.get(category) ?? 0,
    rangeLabel: SENTENCE_RANGE_LABELS[category],
  }));
}

function protectSentenceInternalPeriods(text: string): string {
  let protectedText = text.replace(/(\p{N})\.(\p{N})/gu, `$1${ABBREVIATION_DOT_PLACEHOLDER}$2`);

  COMMON_ABBREVIATIONS.forEach((abbreviation) => {
    const escaped = abbreviation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    protectedText = protectedText.replace(new RegExp(escaped, "gi"), (match) =>
      match.split(".").join(ABBREVIATION_DOT_PLACEHOLDER),
    );
  });

  return protectedText;
}

function previewText(text: string): string {
  const normalized = normalizedWhitespace(text);
  if (normalized.length <= 92) {
    return normalized;
  }
  return `${normalized.slice(0, 89)}...`;
}

function normalizedWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
