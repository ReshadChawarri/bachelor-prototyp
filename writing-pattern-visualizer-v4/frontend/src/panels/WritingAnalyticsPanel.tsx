import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { calculateLocalWritingAnalytics } from "../analytics/localAnalytics";
import type { ParagraphLengthMetric } from "../analytics/localAnalytics";
import type {
  BackendAnalyticsState,
  DocumentAnalyticsResponse,
  RepetitionAnalytics,
  TransitionAnalytics,
  DocumentStructureAnalytics,
} from "../types/backendAnalytics";
import type { DocumentModel, ParagraphBlock } from "../types/document";

interface WritingAnalyticsPanelProps {
  document: DocumentModel;
  backendAnalytics: BackendAnalyticsState;
  revision: number;
  selectedParagraph?: ParagraphBlock;
  selectedParagraphId: string | null;
  onNavigateToParagraph?: (paragraphId: string) => void;
  onNavigateToHeading?: (headingId: string) => void;
}

export function WritingAnalyticsPanel({
  document,
  backendAnalytics,
  revision,
  selectedParagraph,
  selectedParagraphId,
  onNavigateToParagraph,
  onNavigateToHeading,
}: WritingAnalyticsPanelProps) {
  const [allParagraphsOpen, setAllParagraphsOpen] = useState(false);
  const analytics = useMemo(() => calculateLocalWritingAnalytics(document), [document]);
  const maxParagraphWords = Math.max(1, ...analytics.paragraphLengths.map((paragraph) => paragraph.wordCount));
  const maxSentenceBucketCount = Math.max(1, ...analytics.sentenceDistribution.map((bucket) => bucket.count));
  const paragraphRows = useMemo(
    () =>
      analytics.paragraphLengths.map((paragraph) => ({
        ...paragraph,
        isSelected: paragraph.paragraphId === selectedParagraphId,
      })),
    [analytics.paragraphLengths, selectedParagraphId],
  );
  const selectedParagraphLength = paragraphRows.find((paragraph) => paragraph.isSelected);
  const currentBackendAnalytics =
    backendAnalytics.data?.revision === document.revision ? backendAnalytics.data : null;

  return (
    <div className="panel-content">
      <p className="panel-kicker">Deterministic</p>
      <h2>Writing Analytics</h2>
      <p className="panel-description">
        Local metrics update directly from the editable document. Headings and imported non-prose blocks are kept
        separate from prose paragraph analytics.
      </p>

      <section className="analytics-section" aria-label="Overview metrics">
        <h3>Overview</h3>
        <div className="analytics-metric-grid">
          <MetricCard label="Words" value={analytics.overview.wordCount} />
          <MetricCard label="Sentences" value={analytics.overview.sentenceCount} />
          <MetricCard label="Paragraphs" value={analytics.overview.paragraphCount} />
          <MetricCard label="Avg. sentence" value={formatAverage(analytics.overview.averageSentenceLength)} />
        </div>
        <p className="analytics-note">
          Prose paragraphs only. {analytics.overview.headingCount} heading
          {analytics.overview.headingCount === 1 ? "" : "s"} and {analytics.overview.excludedBlockCount} non-prose
          block{analytics.overview.excludedBlockCount === 1 ? "" : "s"} are excluded.
        </p>
      </section>

      <section className="analytics-section" aria-label="Paragraph length">
        <h3>Paragraph Length</h3>
        {analytics.paragraphLengths.length === 0 ? (
          <p className="analytics-empty">No prose paragraphs are available for paragraph-length analytics.</p>
        ) : (
          <>
            <SelectedParagraphLengthView paragraph={selectedParagraphLength} maxParagraphWords={maxParagraphWords} />

            <button
              className="paragraph-overview-toggle"
              type="button"
              aria-expanded={allParagraphsOpen}
              onClick={() => setAllParagraphsOpen((open) => !open)}
            >
              <span aria-hidden="true">{allParagraphsOpen ? "▾" : "▸"}</span>
              All paragraphs ({analytics.paragraphLengths.length})
            </button>

            {allParagraphsOpen && (
              <div className="analytics-bar-list paragraph-overview-list">
                {paragraphRows.map((paragraph) => (
                  <ParagraphLengthRow
                    key={paragraph.paragraphId}
                    paragraph={paragraph}
                    maxParagraphWords={maxParagraphWords}
                    onNavigate={onNavigateToParagraph}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section className="analytics-section" aria-label="Sentence length distribution">
        <h3>Sentence Length</h3>
        <div className="analytics-bar-list">
          {analytics.sentenceDistribution.map((bucket) => (
            <div key={bucket.category} className="analytics-distribution-row">
              <div className="analytics-distribution-label">
                <span>{bucket.category}</span>
                <small>{bucket.rangeLabel}</small>
              </div>
              <div className="analytics-bar-track" aria-hidden="true">
                <span
                  className="analytics-bar-fill sentence-fill"
                  style={{ width: `${bucket.count === 0 ? 0 : Math.max(6, (bucket.count / maxSentenceBucketCount) * 100)}%` }}
                />
              </div>
              <span className="analytics-bar-value">{bucket.count}</span>
            </div>
          ))}
        </div>
      </section>

      <TransitionWordsSection
        analytics={currentBackendAnalytics}
        loading={backendAnalytics.loading}
        error={backendAnalytics.error}
      />

      <RepetitionSection
        analytics={currentBackendAnalytics}
        loading={backendAnalytics.loading}
        error={backendAnalytics.error}
      />

      <DocumentStructureSection
        analytics={currentBackendAnalytics}
        loading={backendAnalytics.loading}
        error={backendAnalytics.error}
        selectedNodeId={selectedParagraphId}
        onNavigateToHeading={onNavigateToHeading}
      />

      <dl className="panel-facts debug-facts">
        <div>
          <dt>Frontend revision</dt>
          <dd>{revision}</dd>
        </div>
        <div>
          <dt>Selected paragraph ID</dt>
          <dd>{selectedParagraphId || "none"}</dd>
        </div>
        <div>
          <dt>Selected text block</dt>
          <dd>{selectedParagraph?.text || "No paragraph selected."}</dd>
        </div>
      </dl>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="analytics-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatAverage(value: number): string {
  return value === 0 ? "0" : value.toFixed(1);
}

function TransitionWordsSection({
  analytics,
  loading,
  error,
}: {
  analytics: DocumentAnalyticsResponse | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <section className="analytics-section" aria-label="Transition words">
      <h3>Transition Words</h3>
      <BackendSectionState loading={loading} error={error} analytics={analytics}>
        {(current) => <TransitionWordsContent transitions={current.transitions} />}
      </BackendSectionState>
    </section>
  );
}

function TransitionWordsContent({ transitions }: { transitions: TransitionAnalytics }) {
  const maxCategoryCount = Math.max(1, ...transitions.categories.map((category) => category.count));

  if (transitions.total === 0) {
    return <p className="analytics-empty">No transition words detected.</p>;
  }

  return (
    <div className="analytics-count-list">
      <div className="analytics-total-row">
        <span>Total</span>
        <strong>{transitions.total}</strong>
      </div>
      {transitions.categories.map((category) => (
        <CountBarRow
          key={category.name}
          label={category.name}
          count={category.count}
          maxCount={maxCategoryCount}
          fillClassName="transition-fill"
        />
      ))}
    </div>
  );
}

function RepetitionSection({
  analytics,
  loading,
  error,
}: {
  analytics: DocumentAnalyticsResponse | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <section className="analytics-section" aria-label="Repetition">
      <h3>Repetition</h3>
      <BackendSectionState loading={loading} error={error} analytics={analytics}>
        {(current) => <RepetitionContent repetition={current.repetition} />}
      </BackendSectionState>
    </section>
  );
}

function RepetitionContent({ repetition }: { repetition: RepetitionAnalytics }) {
  const maxTermCount = Math.max(1, ...repetition.terms.map((term) => term.count));

  if (repetition.terms.length === 0) {
    return <p className="analytics-empty">No notable repetition detected.</p>;
  }

  return (
    <div className="analytics-count-list">
      {repetition.terms.map((term) => (
        <CountBarRow
          key={term.term}
          label={term.term}
          count={term.count}
          maxCount={maxTermCount}
          fillClassName="repetition-fill"
        />
      ))}
    </div>
  );
}

function DocumentStructureSection({
  analytics,
  loading,
  error,
  selectedNodeId,
  onNavigateToHeading,
}: {
  analytics: DocumentAnalyticsResponse | null;
  loading: boolean;
  error: string | null;
  selectedNodeId: string | null;
  onNavigateToHeading?: (headingId: string) => void;
}) {
  return (
    <section className="analytics-section" aria-label="Document structure">
      <h3>Document Structure</h3>
      <BackendSectionState loading={loading} error={error} analytics={analytics}>
        {(current) => (
          <DocumentStructureContent
            structure={current.structure}
            selectedNodeId={selectedNodeId}
            onNavigateToHeading={onNavigateToHeading}
          />
        )}
      </BackendSectionState>
    </section>
  );
}

function DocumentStructureContent({
  structure,
  selectedNodeId,
  onNavigateToHeading,
}: {
  structure: DocumentStructureAnalytics;
  selectedNodeId: string | null;
  onNavigateToHeading?: (headingId: string) => void;
}) {
  if (structure.headings.length === 0) {
    return <p className="analytics-empty">No document headings detected.</p>;
  }

  return (
    <ol className="document-structure-list">
      {structure.headings.map((heading, index) => {
        const nodeId = structure.source === "explicit" ? (heading.nodeId ?? heading.paragraphId) : null;
        const level = Math.min(Math.max(heading.level, 1), 3);
        const isSelected = Boolean(nodeId && nodeId === selectedNodeId);

        return (
          <li key={`${nodeId ?? heading.paragraphId ?? "heading"}-${index}`}>
            {nodeId && onNavigateToHeading ? (
              <button
                className={isSelected ? `document-structure-item level-${level} selected` : `document-structure-item level-${level}`}
                type="button"
                data-node-id={nodeId}
                aria-current={isSelected ? "true" : undefined}
                onClick={() => onNavigateToHeading(nodeId)}
              >
                {heading.text}
              </button>
            ) : (
              <span className={`document-structure-item level-${level}`} data-node-id={nodeId ?? undefined}>
                {heading.text}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function BackendSectionState({
  loading,
  error,
  analytics,
  children,
}: {
  loading: boolean;
  error: string | null;
  analytics: DocumentAnalyticsResponse | null;
  children: (analytics: DocumentAnalyticsResponse) => ReactNode;
}) {
  if (error) {
    return <p className="analytics-empty">{error}</p>;
  }
  if (loading || !analytics) {
    return <p className="analytics-empty">Updating...</p>;
  }
  return <>{children(analytics)}</>;
}

function CountBarRow({
  label,
  count,
  maxCount,
  fillClassName,
}: {
  label: string;
  count: number;
  maxCount: number;
  fillClassName: string;
}) {
  return (
    <div className="analytics-count-row">
      <span className="analytics-count-label">{label}</span>
      <div className="analytics-bar-track" aria-hidden="true">
        <span className={`analytics-bar-fill ${fillClassName}`} style={{ width: barWidthPercent(count, maxCount) }} />
      </div>
      <span className="analytics-bar-value">{count}</span>
    </div>
  );
}

function SelectedParagraphLengthView({
  paragraph,
  maxParagraphWords,
}: {
  paragraph?: ParagraphLengthMetric;
  maxParagraphWords: number;
}) {
  if (!paragraph) {
    return (
      <div className="selected-paragraph-summary empty">
        <p>Select a paragraph in the document</p>
        <p>to view its length.</p>
      </div>
    );
  }

  return (
    <div
      className="selected-paragraph-summary"
      data-paragraph-id={paragraph.paragraphId}
      title={paragraph.textPreview}
    >
      <p className="selected-paragraph-meta">Selected paragraph · {paragraph.label}</p>
      <p className="selected-paragraph-word-count">
        {paragraph.wordCount} {paragraph.wordCount === 1 ? "word" : "words"}
      </p>
      <div className="analytics-bar-track selected-paragraph-track" aria-hidden="true">
        <span
          className="analytics-bar-fill paragraph-fill"
          style={{ width: barWidthPercent(paragraph.wordCount, maxParagraphWords) }}
        />
      </div>
    </div>
  );
}

function ParagraphLengthRow({
  paragraph,
  maxParagraphWords,
  onNavigate,
}: {
  paragraph: ParagraphLengthMetric & { isSelected: boolean };
  maxParagraphWords: number;
  onNavigate?: (paragraphId: string) => void;
}) {
  return (
    <button
      className={paragraph.isSelected ? "analytics-bar-row selected" : "analytics-bar-row"}
      type="button"
      title={paragraph.textPreview}
      data-paragraph-id={paragraph.paragraphId}
      aria-current={paragraph.isSelected ? "true" : undefined}
      onClick={() => onNavigate?.(paragraph.paragraphId)}
    >
      <span className="analytics-bar-label">{paragraph.label}</span>
      <div className="analytics-bar-track" aria-hidden="true">
        <span
          className="analytics-bar-fill paragraph-fill"
          style={{ width: barWidthPercent(paragraph.wordCount, maxParagraphWords) }}
        />
      </div>
      <span className="analytics-bar-value">{paragraph.wordCount}</span>
    </button>
  );
}

function barWidthPercent(wordCount: number, maxWords: number): string {
  if (wordCount <= 0) {
    return "0%";
  }
  return `${Math.max(6, (wordCount / maxWords) * 100)}%`;
}
