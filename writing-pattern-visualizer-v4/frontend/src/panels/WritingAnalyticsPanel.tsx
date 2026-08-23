import type { ParagraphBlock } from "../types/document";

interface WritingAnalyticsPanelProps {
  revision: number;
  selectedParagraph?: ParagraphBlock;
  selectedParagraphId: string | null;
}

export function WritingAnalyticsPanel({
  revision,
  selectedParagraph,
  selectedParagraphId,
}: WritingAnalyticsPanelProps) {
  return (
    <div className="panel-content">
      <p className="panel-kicker">Deterministic</p>
      <h2>Writing Analytics</h2>
      <p className="panel-description">
        Placeholder for local metrics, charts, transition markers, section structure, and paragraph-linked analytics.
      </p>
      <dl className="panel-facts">
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

