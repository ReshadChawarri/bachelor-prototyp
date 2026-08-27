import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useParagraphAIAnalysis } from "../ai/useParagraphAIAnalysis";
import { useParagraphRevisionSuggestion } from "../ai/useParagraphRevisionSuggestion";
import { RevisionSuggestionCard, REVISION_ACTION_LABELS } from "./RevisionSuggestionCard";
import type {
  AcademicToneLevel,
  CoherenceLevel,
  ParagraphRevisionAction,
  ParagraphRoleLabel,
  RhetoricalMoveLabel,
  SuggestRevisionResponse,
} from "../types/aiAnalysis";
import type { AnalyticsLanguage } from "../types/backendAnalytics";
import type { DocumentModel, ParagraphBlock } from "../types/document";
import type { ParagraphRevisionApplyResult } from "../editor/revision";

interface AiWritingPanelProps {
  document: DocumentModel;
  selectedParagraph?: ParagraphBlock;
  selectedParagraphId: string | null;
  language?: AnalyticsLanguage;
  onAcceptRevision?: (suggestion: SuggestRevisionResponse) => ParagraphRevisionApplyResult;
}

const REVISION_ACTIONS: Array<{ action: ParagraphRevisionAction; label: string }> = [
  { action: "improve_clarity", label: REVISION_ACTION_LABELS.improve_clarity },
  { action: "improve_academic_tone", label: REVISION_ACTION_LABELS.improve_academic_tone },
  { action: "improve_transition", label: REVISION_ACTION_LABELS.improve_transition },
];

export function AiWritingPanel({
  document,
  selectedParagraph,
  selectedParagraphId,
  language = "English",
  onAcceptRevision,
}: AiWritingPanelProps) {
  const paragraphAnalysisState = useParagraphAIAnalysis(document, selectedParagraph, selectedParagraphId, language);
  const revisionState = useParagraphRevisionSuggestion(document, selectedParagraph, selectedParagraphId, language);
  const [acceptMessage, setAcceptMessage] = useState<string | null>(null);

  useEffect(() => {
    setAcceptMessage(null);
  }, [selectedParagraphId, selectedParagraph?.text]);

  const handleAcceptRevision = (suggestion: SuggestRevisionResponse) => {
    if (!onAcceptRevision) {
      setAcceptMessage("The revision cannot be applied in the current editor state.");
      return;
    }

    const result = onAcceptRevision(suggestion);
    if (result.applied) {
      revisionState.clear();
      setAcceptMessage(null);
      return;
    }

    revisionState.clear();
    setAcceptMessage(messageForApplyResult(result));
  };

  return (
    <div className="panel-content">
      <p className="panel-kicker">AI assisted</p>
      <h2>AI Writing Analysis</h2>
      <p className="panel-description">
        Analysis and revision suggestions are generated for the selected paragraph and limited local context. AI does
        not edit, rewrite, or grade the document unless you explicitly accept a suggestion.
      </p>

      <ParagraphAIAnalysisPanel
        analysisState={paragraphAnalysisState}
        revisionState={revisionState}
        selectedParagraph={selectedParagraph}
        acceptMessage={acceptMessage}
        onAcceptRevision={handleAcceptRevision}
      />

      <dl className="panel-facts debug-facts">
        <div>
          <dt>Selected paragraph ID</dt>
          <dd>{selectedParagraphId || "none"}</dd>
        </div>
      </dl>
    </div>
  );
}

function ParagraphAIAnalysisPanel({
  analysisState,
  revisionState,
  selectedParagraph,
  acceptMessage,
  onAcceptRevision,
}: {
  analysisState: ReturnType<typeof useParagraphAIAnalysis>;
  revisionState: ReturnType<typeof useParagraphRevisionSuggestion>;
  selectedParagraph?: ParagraphBlock;
  acceptMessage: string | null;
  onAcceptRevision: (suggestion: SuggestRevisionResponse) => void;
}) {
  const canShowActions = analysisState.status === "success" && Boolean(analysisState.data);

  return (
    <section className="ai-analysis-panel" aria-label="Paragraph AI analysis">
      <div className="ai-analysis-heading-row">
        <h3>{analysisState.displayLabel ? `Paragraph ${analysisState.displayLabel}` : "Paragraph"}</h3>
        {analysisState.status === "success" && (
          <button className="reanalyze-button" type="button" onClick={analysisState.reanalyze}>
            Re-analyze
          </button>
        )}
      </div>

      {analysisState.status === "idle" || analysisState.status === "insufficient" ? (
        <p className="analytics-empty">{analysisState.message}</p>
      ) : null}

      {analysisState.status === "loading" && <p className="analytics-empty">Analyzing paragraph...</p>}

      {analysisState.status === "error" && (
        <p className="analytics-empty">{analysisState.message || "AI analysis is temporarily unavailable."}</p>
      )}

      {analysisState.status === "success" && analysisState.data && (
        <div className="ai-result-stack">
          <AiResultSection title="Paragraph Role">
            <QualitativeLabel label={formatRoleLabel(analysisState.data.analysis.paragraphRole.label)} />
            <p>{analysisState.data.analysis.paragraphRole.rationale}</p>
          </AiResultSection>

          <AiResultSection title="Rhetorical Moves">
            {analysisState.data.analysis.rhetoricalMoves.length === 0 ? (
              <p>No distinct rhetorical moves identified.</p>
            ) : (
              <div className="ai-chip-list">
                {analysisState.data.analysis.rhetoricalMoves.map((move) => (
                  <span key={`${move.label}-${move.rationale}`} className="ai-chip" title={move.rationale}>
                    {formatMoveLabel(move.label)}
                  </span>
                ))}
              </div>
            )}
          </AiResultSection>

          <AiResultSection title="Coherence">
            <QualitativeLabel label={formatAssessmentLabel(analysisState.data.analysis.coherence.level)} />
            <p>{analysisState.data.analysis.coherence.rationale}</p>
          </AiResultSection>

          <AiResultSection title="Academic Tone">
            <QualitativeLabel label={formatAssessmentLabel(analysisState.data.analysis.academicTone.level)} />
            <p>{analysisState.data.analysis.academicTone.rationale}</p>
          </AiResultSection>

          <AiResultSection title="Observation">
            <p>{analysisState.data.analysis.observation}</p>
          </AiResultSection>

          <RevisionActionsSection
            canShowActions={canShowActions}
            revisionState={revisionState}
            selectedParagraph={selectedParagraph}
            acceptMessage={acceptMessage}
            onAcceptRevision={onAcceptRevision}
          />

          <dl className="ai-analysis-metadata">
            <div>
              <dt>Model</dt>
              <dd>{analysisState.data.model}</dd>
            </div>
            <div>
              <dt>Analysis</dt>
              <dd>{analysisState.data.analysisVersion}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{analysisState.fromCache ? "Cached" : "Fresh"}</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}

function RevisionActionsSection({
  canShowActions,
  revisionState,
  selectedParagraph,
  acceptMessage,
  onAcceptRevision,
}: {
  canShowActions: boolean;
  revisionState: ReturnType<typeof useParagraphRevisionSuggestion>;
  selectedParagraph?: ParagraphBlock;
  acceptMessage: string | null;
  onAcceptRevision: (suggestion: SuggestRevisionResponse) => void;
}) {
  if (!canShowActions) {
    return null;
  }

  const suggestion = revisionState.suggestion;

  return (
    <AiResultSection title={revisionState.suggestion ? "Revision Suggestion" : "Suggested Actions"}>
      {revisionState.status === "success" && suggestion && selectedParagraph ? (
        <RevisionSuggestionCard
          originalText={selectedParagraph.text}
          suggestion={suggestion}
          onReject={revisionState.reject}
          onAccept={() => onAcceptRevision(suggestion)}
        />
      ) : (
        <div className="revision-action-stack">
          <div className="revision-action-grid">
            {REVISION_ACTIONS.map((item) => (
              <button
                key={item.action}
                className="revision-action-button"
                type="button"
                onClick={() => revisionState.requestRevision(item.action)}
                disabled={!revisionState.canRequest}
              >
                {item.label}
              </button>
            ))}
          </div>

          {revisionState.status === "loading" && <p className="analytics-empty">Generating revision...</p>}
          {revisionState.status === "error" && (
            <p className="analytics-empty">{revisionState.message || "A revision could not be generated. Please try again."}</p>
          )}
          {acceptMessage && <p className="analytics-empty">{acceptMessage}</p>}
        </div>
      )}
    </AiResultSection>
  );
}

function AiResultSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ai-result-section">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function QualitativeLabel({ label }: { label: string }) {
  return <span className="ai-qualitative-label">{label}</span>;
}

function formatRoleLabel(label: ParagraphRoleLabel): string {
  return label
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" / ");
}

function formatMoveLabel(label: RhetoricalMoveLabel): string {
  return label.charAt(0).toUpperCase() + label.slice(1).replace(/_/g, " ");
}

function formatAssessmentLabel(label: CoherenceLevel | AcademicToneLevel): string {
  return label
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function messageForApplyResult(result: Exclude<ParagraphRevisionApplyResult, { applied: true }>): string {
  if (result.reason === "stale") {
    return "This paragraph changed after the suggestion was generated. Generate a new revision before applying it.";
  }
  if (result.reason === "missing") {
    return "The target paragraph is no longer available. No changes were made.";
  }
  return "The revision could not be applied safely. No changes were made.";
}
