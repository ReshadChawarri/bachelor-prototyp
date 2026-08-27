import { useMemo } from "react";
import { createWordDiff } from "../ai/revisionDiff";
import type { ParagraphRevisionAction, SuggestRevisionResponse } from "../types/aiAnalysis";

export const REVISION_ACTION_LABELS: Record<ParagraphRevisionAction, string> = {
  improve_clarity: "Improve clarity",
  improve_academic_tone: "Improve academic tone",
  improve_transition: "Improve transition",
  adjust_paragraph_length: "Adjust paragraph length",
};

export function RevisionSuggestionCard({
  originalText,
  suggestion,
  onReject,
  onAccept,
}: {
  originalText: string;
  suggestion: SuggestRevisionResponse;
  onReject: () => void;
  onAccept: () => void;
}) {
  return (
    <div className="revision-suggestion-card">
      <p className="revision-action-label">{formatRevisionActionLabel(suggestion.action)}</p>
      {suggestion.length && (
        <dl className="revision-length-facts" aria-label="Length revision word counts">
          <div>
            <dt>Current</dt>
            <dd>{suggestion.length.originalWordCount} words</dd>
          </div>
          <div>
            <dt>Target</dt>
            <dd>{suggestion.length.targetWordCount} words</dd>
          </div>
          <div>
            <dt>Suggested</dt>
            <dd>
              {suggestion.length.revisedWordCount} words
              {!suggestion.length.withinTolerance ? " · outside target range" : ""}
            </dd>
          </div>
        </dl>
      )}
      <RevisionDiffPreview originalText={originalText} revisedText={suggestion.suggestion.revisedText} />
      <p className="revision-summary">{suggestion.suggestion.summary}</p>
      <div className="revision-decision-row">
        <button className="revision-decision-button secondary" type="button" onClick={onReject}>
          Reject
        </button>
        <button className="revision-decision-button primary" type="button" onClick={onAccept}>
          Accept
        </button>
      </div>
    </div>
  );
}

export function formatRevisionActionLabel(action: ParagraphRevisionAction): string {
  return REVISION_ACTION_LABELS[action] ?? "Revision suggestion";
}

function RevisionDiffPreview({ originalText, revisedText }: { originalText: string; revisedText: string }) {
  const segments = useMemo(() => createWordDiff(originalText, revisedText), [originalText, revisedText]);

  return (
    <p className="revision-diff-preview" aria-label="Word-level preview of the proposed revision">
      {segments.map((segment, index) => (
        <span key={`${segment.kind}-${index}`} className={`revision-diff-segment ${segment.kind}`}>
          {segment.text}
          {index < segments.length - 1 ? " " : ""}
        </span>
      ))}
    </p>
  );
}
