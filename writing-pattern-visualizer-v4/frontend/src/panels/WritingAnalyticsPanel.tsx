import { useMemo, useState } from "react";
import { calculateLocalWritingAnalytics } from "../analytics/localAnalytics";
import type { ParagraphLengthMetric } from "../analytics/localAnalytics";
import type { DocumentModel, ParagraphBlock } from "../types/document";

interface WritingAnalyticsPanelProps {
  document: DocumentModel;
  revision: number;
  selectedParagraph?: ParagraphBlock;
  selectedParagraphId: string | null;
}

export function WritingAnalyticsPanel({
  document,
  revision,
  selectedParagraph,
  selectedParagraphId,
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
}: {
  paragraph: ParagraphLengthMetric & { isSelected: boolean };
  maxParagraphWords: number;
}) {
  return (
    <div
      className={paragraph.isSelected ? "analytics-bar-row selected" : "analytics-bar-row"}
      title={paragraph.textPreview}
      data-paragraph-id={paragraph.paragraphId}
      aria-current={paragraph.isSelected ? "true" : undefined}
    >
      <span className="analytics-bar-label">{paragraph.label}</span>
      <div className="analytics-bar-track" aria-hidden="true">
        <span
          className="analytics-bar-fill paragraph-fill"
          style={{ width: barWidthPercent(paragraph.wordCount, maxParagraphWords) }}
        />
      </div>
      <span className="analytics-bar-value">{paragraph.wordCount}</span>
    </div>
  );
}

function barWidthPercent(wordCount: number, maxWords: number): string {
  if (wordCount <= 0) {
    return "0%";
  }
  return `${Math.max(6, (wordCount / maxWords) * 100)}%`;
}
