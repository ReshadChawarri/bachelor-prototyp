import { describe, expect, it } from "vitest";
import {
  isMeaningfulParagraphLengthTarget,
  PARAGRAPH_LENGTH_TARGET_POLICY,
  paragraphLengthTargetRange,
} from "./paragraphLengthTarget";

describe("paragraph length target policy", () => {
  it("disables manipulation for paragraphs below the minimum meaningful length", () => {
    const range = paragraphLengthTargetRange(PARAGRAPH_LENGTH_TARGET_POLICY.minimumAdjustableWords - 1);

    expect(range).toEqual({ min: 19, max: 19, enabled: false });
  });

  it("derives a bounded shortening and lengthening range from the current word count", () => {
    const range = paragraphLengthTargetRange(80);

    expect(range).toEqual({ min: 40, max: 140, enabled: true });
  });

  it("keeps the lower bound useful for short but adjustable paragraphs", () => {
    const range = paragraphLengthTargetRange(24);

    expect(range.min).toBe(20);
    expect(range.max).toBe(42);
    expect(range.enabled).toBe(true);
  });

  it("treats unchanged or out-of-range targets as non-meaningful", () => {
    expect(isMeaningfulParagraphLengthTarget(80, 80)).toBe(false);
    expect(isMeaningfulParagraphLengthTarget(80, 39)).toBe(false);
    expect(isMeaningfulParagraphLengthTarget(80, 141)).toBe(false);
    expect(isMeaningfulParagraphLengthTarget(80, 60)).toBe(true);
    expect(isMeaningfulParagraphLengthTarget(80, 100)).toBe(true);
  });
});
