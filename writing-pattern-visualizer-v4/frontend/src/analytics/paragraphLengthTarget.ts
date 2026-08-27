export const PARAGRAPH_LENGTH_TARGET_POLICY = {
  minimumAdjustableWords: 20,
  shorteningRatio: 0.5,
  lengtheningRatio: 1.75,
} as const;

export interface ParagraphLengthTargetRange {
  min: number;
  max: number;
  enabled: boolean;
}

// Phase 6B.1 intentionally limits each AI length adjustment to a moderate change.
export function paragraphLengthTargetRange(currentWordCount: number): ParagraphLengthTargetRange {
  if (currentWordCount < PARAGRAPH_LENGTH_TARGET_POLICY.minimumAdjustableWords) {
    return {
      min: currentWordCount,
      max: currentWordCount,
      enabled: false,
    };
  }

  const min = Math.max(
    PARAGRAPH_LENGTH_TARGET_POLICY.minimumAdjustableWords,
    Math.round(currentWordCount * PARAGRAPH_LENGTH_TARGET_POLICY.shorteningRatio),
  );
  const max = Math.max(min, Math.round(currentWordCount * PARAGRAPH_LENGTH_TARGET_POLICY.lengtheningRatio));

  return {
    min,
    max,
    enabled: true,
  };
}

export function isMeaningfulParagraphLengthTarget(currentWordCount: number, targetWordCount: number): boolean {
  const range = paragraphLengthTargetRange(currentWordCount);
  return range.enabled && targetWordCount >= range.min && targetWordCount <= range.max && targetWordCount !== currentWordCount;
}
