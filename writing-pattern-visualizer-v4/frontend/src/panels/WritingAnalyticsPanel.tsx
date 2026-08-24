import { useMemo } from "react";
import { calculateLocalWritingAnalytics } from "../analytics/localAnalytics";
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
  const analytics = useMemo(() => calculateLocalWritingAnalytics(document), [document]);
  const maxParagraphWords = Math.max(1, ...analytics.paragraphLengths.map((paragraph) => paragraph.wordCount));
  const maxSentenceBucketCount = Math.max(1, ...analytics.sentenceDistribution.map((bucket) => bucket.count));

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
          <div className="analytics-bar-list">
            {analytics.paragraphLengths.map((paragraph) => (
              <div key={paragraph.paragraphId} className="analytics-bar-row" title={paragraph.textPreview}>
                <span className="analytics-bar-label">{paragraph.label}</span>
                <div className="analytics-bar-track" aria-hidden="true">
                  <span
                    className="analytics-bar-fill paragraph-fill"
                    style={{ width: `${Math.max(6, (paragraph.wordCount / maxParagraphWords) * 100)}%` }}
                  />
                </div>
                <span className="analytics-bar-value">{paragraph.wordCount}</span>
              </div>
            ))}
          </div>
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
