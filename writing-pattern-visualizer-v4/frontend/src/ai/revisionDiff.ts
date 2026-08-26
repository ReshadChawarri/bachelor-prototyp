export type RevisionDiffKind = "equal" | "insert" | "delete";

export interface RevisionDiffSegment {
  kind: RevisionDiffKind;
  text: string;
}

export function createWordDiff(original: string, revised: string): RevisionDiffSegment[] {
  const originalTokens = tokenize(original);
  const revisedTokens = tokenize(revised);
  const table = buildLcsTable(originalTokens, revisedTokens);
  const segments: RevisionDiffSegment[] = [];
  let left = originalTokens.length;
  let right = revisedTokens.length;

  while (left > 0 || right > 0) {
    if (left > 0 && right > 0 && originalTokens[left - 1] === revisedTokens[right - 1]) {
      prependSegment(segments, "equal", originalTokens[left - 1]);
      left -= 1;
      right -= 1;
    } else if (right > 0 && (left === 0 || table[left][right - 1] >= table[left - 1][right])) {
      prependSegment(segments, "insert", revisedTokens[right - 1]);
      right -= 1;
    } else if (left > 0) {
      prependSegment(segments, "delete", originalTokens[left - 1]);
      left -= 1;
    }
  }

  return segments;
}

function tokenize(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function buildLcsTable(left: string[], right: string[]): number[][] {
  const table = Array.from({ length: left.length + 1 }, () => Array.from({ length: right.length + 1 }, () => 0));

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      table[leftIndex][rightIndex] =
        left[leftIndex - 1] === right[rightIndex - 1]
          ? table[leftIndex - 1][rightIndex - 1] + 1
          : Math.max(table[leftIndex - 1][rightIndex], table[leftIndex][rightIndex - 1]);
    }
  }

  return table;
}

function prependSegment(segments: RevisionDiffSegment[], kind: RevisionDiffKind, token: string) {
  if (segments[0]?.kind === kind) {
    segments[0] = {
      kind,
      text: `${token} ${segments[0].text}`,
    };
    return;
  }

  segments.unshift({
    kind,
    text: token,
  });
}
