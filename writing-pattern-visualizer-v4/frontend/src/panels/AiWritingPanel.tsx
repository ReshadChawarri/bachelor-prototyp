import type { ReactNode } from "react";
import { useParagraphAIAnalysis } from "../ai/useParagraphAIAnalysis";
import type { AcademicToneLevel, CoherenceLevel, ParagraphRoleLabel, RhetoricalMoveLabel } from "../types/aiAnalysis";
import type { AnalyticsLanguage } from "../types/backendAnalytics";
import type { DocumentModel, ParagraphBlock } from "../types/document";

interface AiWritingPanelProps {
  document: DocumentModel;
  selectedParagraph?: ParagraphBlock;
  selectedParagraphId: string | null;
  language?: AnalyticsLanguage;
}

export function AiWritingPanel({
  document,
  selectedParagraph,
  selectedParagraphId,
  language = "English",
}: AiWritingPanelProps) {
  const analysisState = useParagraphAIAnalysis(document, selectedParagraph, selectedParagraphId, language);

  return (
    <div className="panel-content">
      <p className="panel-kicker">AI assisted</p>
      <h2>AI Writing Analysis</h2>
      <p className="panel-description">
        Paragraph analysis is generated from the selected paragraph and limited local context. It does not edit,
        rewrite, or grade the document.
      </p>

      <div className="ai-tab-row" role="tablist" aria-label="AI analysis scope">
        <button className="ai-tab disabled" type="button" role="tab" aria-selected="false" aria-disabled="true" disabled>
          Document
        </button>
        <button className="ai-tab active" type="button" role="tab" aria-selected="true">
          Paragraph
        </button>
      </div>

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

      <dl className="panel-facts debug-facts">
        <div>
          <dt>Selected paragraph ID</dt>
          <dd>{selectedParagraphId || "none"}</dd>
        </div>
      </dl>
    </div>
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
