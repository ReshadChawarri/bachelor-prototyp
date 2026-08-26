import type { ReactNode } from "react";
import { useState } from "react";
import { useDocumentAIAnalysis } from "../ai/useDocumentAIAnalysis";
import { useParagraphAIAnalysis } from "../ai/useParagraphAIAnalysis";
import type {
  AcademicToneLevel,
  AnalyzeDocumentResponse,
  CoherenceLevel,
  ParagraphRoleLabel,
  RhetoricalMoveLabel,
} from "../types/aiAnalysis";
import type { AnalyticsLanguage } from "../types/backendAnalytics";
import type { DocumentModel, ParagraphBlock } from "../types/document";

interface AiWritingPanelProps {
  document: DocumentModel;
  selectedParagraph?: ParagraphBlock;
  selectedParagraphId: string | null;
  language?: AnalyticsLanguage;
  onNavigateToParagraph?: (paragraphId: string) => void;
}

export function AiWritingPanel({
  document,
  selectedParagraph,
  selectedParagraphId,
  language = "English",
  onNavigateToParagraph,
}: AiWritingPanelProps) {
  const [activeTab, setActiveTab] = useState<"document" | "paragraph">("paragraph");
  const paragraphAnalysisState = useParagraphAIAnalysis(
    document,
    selectedParagraph,
    selectedParagraphId,
    language,
    undefined,
    activeTab === "paragraph",
  );
  const documentAnalysisState = useDocumentAIAnalysis(document, language);

  return (
    <div className="panel-content">
      <p className="panel-kicker">AI assisted</p>
      <h2>AI Writing Analysis</h2>
      <p className="panel-description">
        Paragraph analysis is generated from the selected paragraph and limited local context. It does not edit,
        rewrite, or grade the document.
      </p>

      <div className="ai-tab-row" role="tablist" aria-label="AI analysis scope">
        <button
          className={activeTab === "document" ? "ai-tab active" : "ai-tab"}
          type="button"
          role="tab"
          aria-selected={activeTab === "document"}
          onClick={() => setActiveTab("document")}
        >
          Document
        </button>
        <button
          className={activeTab === "paragraph" ? "ai-tab active" : "ai-tab"}
          type="button"
          role="tab"
          aria-selected={activeTab === "paragraph"}
          onClick={() => setActiveTab("paragraph")}
        >
          Paragraph
        </button>
      </div>

      {activeTab === "document" ? (
        <DocumentAIAnalysisPanel
          state={documentAnalysisState}
          document={document}
          onNavigateToParagraph={onNavigateToParagraph}
        />
      ) : (
        <ParagraphAIAnalysisPanel analysisState={paragraphAnalysisState} />
      )}

      <dl className="panel-facts debug-facts">
        <div>
          <dt>Selected paragraph ID</dt>
          <dd>{selectedParagraphId || "none"}</dd>
        </div>
      </dl>
    </div>
  );
}

function ParagraphAIAnalysisPanel({ analysisState }: { analysisState: ReturnType<typeof useParagraphAIAnalysis> }) {
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

function DocumentAIAnalysisPanel({
  state,
  document,
  onNavigateToParagraph,
}: {
  state: ReturnType<typeof useDocumentAIAnalysis>;
  document: DocumentModel;
  onNavigateToParagraph?: (paragraphId: string) => void;
}) {
  const [rolesExpanded, setRolesExpanded] = useState(false);
  const data = state.data;
  const buttonLabel = data ? (state.isStale ? "Update analysis" : "Re-analyze") : "Analyze document";
  const onPrimaryAction = data && !state.isStale ? state.reanalyze : state.analyze;

  return (
    <section className="ai-analysis-panel" aria-label="Document AI analysis">
      <div className="ai-analysis-heading-row">
        <h3>Document Analysis</h3>
        <button className="reanalyze-button" type="button" onClick={onPrimaryAction} disabled={!state.canAnalyze}>
          {state.status === "loading" ? "Analyzing..." : buttonLabel}
        </button>
      </div>

      {!data && state.status !== "loading" && state.status !== "error" ? (
        <p className="analytics-empty">{state.message}</p>
      ) : null}

      {state.status === "loading" && <p className="analytics-empty">Analyzing document...</p>}

      {state.status === "error" && (
        <p className="analytics-empty">{state.message || "AI analysis is temporarily unavailable."}</p>
      )}

      {data && (
        <div className="ai-result-stack">
          <p className={state.isStale ? "ai-stale-note" : "analytics-note"}>
            {state.isStale
              ? "Document changed since this analysis."
              : `Analysis based on Revision ${data.revision}`}
          </p>

          <DocumentRolesSection
            data={data}
            document={document}
            expanded={rolesExpanded}
            onToggleExpanded={() => setRolesExpanded((value) => !value)}
            onNavigateToParagraph={onNavigateToParagraph}
          />

          <AiResultSection title="Rhetorical Moves">
            {data.analysis.rhetoricalMoves.length === 0 ? (
              <p>No rhetorical moves identified across the analyzed paragraphs.</p>
            ) : (
              <div className="ai-move-distribution">
                {data.analysis.rhetoricalMoves.map((move) => (
                  <div className="ai-move-row" key={move.label}>
                    <span>{formatMoveLabel(move.label)}</span>
                    <div className="analytics-bar-track" aria-hidden="true">
                      <span
                        className="analytics-bar-fill transition-fill"
                        style={{
                          width: `${Math.max(8, (move.count / maxMoveCount(data)) * 100)}%`,
                        }}
                      />
                    </div>
                    <strong>{move.count}</strong>
                  </div>
                ))}
              </div>
            )}
          </AiResultSection>

          <AiResultSection title="Coherence">
            <QualitativeLabel label={formatAssessmentLabel(data.analysis.coherence.level)} />
            <p>{data.analysis.coherence.rationale}</p>
          </AiResultSection>

          <AiResultSection title="Academic Tone">
            <QualitativeLabel label={formatAssessmentLabel(data.analysis.academicTone.level)} />
            <p>{data.analysis.academicTone.rationale}</p>
          </AiResultSection>

          <AiResultSection title="Observation">
            <p>{data.analysis.observation}</p>
          </AiResultSection>

          <dl className="ai-analysis-metadata">
            <div>
              <dt>Model</dt>
              <dd>{data.model}</dd>
            </div>
            <div>
              <dt>Analysis</dt>
              <dd>{data.analysisVersion}</dd>
            </div>
            <div>
              <dt>Paragraphs</dt>
              <dd>{data.analyzedParagraphCount}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{state.fromCache ? "Cached" : "Fresh"}</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}

function DocumentRolesSection({
  data,
  document,
  expanded,
  onToggleExpanded,
  onNavigateToParagraph,
}: {
  data: AnalyzeDocumentResponse;
  document: DocumentModel;
  expanded: boolean;
  onToggleExpanded: () => void;
  onNavigateToParagraph?: (paragraphId: string) => void;
}) {
  const roles = data.analysis.paragraphRoles.map((role) => ({
    ...role,
    displayLabel: displayLabelForParagraph(document, role.paragraphId) ?? "P?",
  }));
  const visibleRoles = expanded ? roles : roles.slice(0, 5);

  return (
    <AiResultSection title="Paragraph Roles">
      <div className="ai-role-list">
        {visibleRoles.map((role) => {
          const content = (
            <>
              <span>{role.displayLabel}</span>
              <strong>{formatRoleLabel(role.role)}</strong>
            </>
          );
          return onNavigateToParagraph ? (
            <button
              key={role.paragraphId}
              className="ai-role-row interactive"
              type="button"
              onClick={() => onNavigateToParagraph(role.paragraphId)}
            >
              {content}
            </button>
          ) : (
            <div key={role.paragraphId} className="ai-role-row">
              {content}
            </div>
          );
        })}
      </div>
      {roles.length > 5 && (
        <button className="paragraph-overview-toggle" type="button" onClick={onToggleExpanded}>
          {expanded ? "▾" : "▸"} {expanded ? "Show fewer paragraphs" : `Show all paragraphs (${roles.length})`}
        </button>
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

function displayLabelForParagraph(document: DocumentModel, paragraphId: string): string | null {
  const proseParagraphs = [...document.paragraphs]
    .sort((left, right) => left.order - right.order)
    .filter((paragraph) => paragraph.type === "paragraph" && paragraph.blockType === "paragraph");
  const index = proseParagraphs.findIndex((paragraph) => paragraph.id === paragraphId);
  return index === -1 ? null : `P${index + 1}`;
}

function maxMoveCount(data: AnalyzeDocumentResponse): number {
  return Math.max(1, ...data.analysis.rhetoricalMoves.map((move) => move.count));
}
