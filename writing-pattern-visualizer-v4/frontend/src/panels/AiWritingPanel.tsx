import type { ParagraphBlock } from "../types/document";

interface AiWritingPanelProps {
  selectedParagraph?: ParagraphBlock;
  selectedParagraphId: string | null;
}

export function AiWritingPanel({ selectedParagraph, selectedParagraphId }: AiWritingPanelProps) {
  return (
    <div className="panel-content">
      <p className="panel-kicker">Future phase</p>
      <h2>AI Writing Analysis</h2>
      <p className="panel-description">
        Placeholder for paragraph role analysis, rhetorical moves, coherence observations, academic tone, and opt-in
        revision suggestions.
      </p>
      <dl className="panel-facts">
        <div>
          <dt>Selected paragraph ID</dt>
          <dd>{selectedParagraphId || "none"}</dd>
        </div>
        <div>
          <dt>AI status</dt>
          <dd>Not implemented in Phase 1.</dd>
        </div>
        <div>
          <dt>Selected context</dt>
          <dd>{selectedParagraph?.text || "Select a paragraph to prepare future AI context."}</dd>
        </div>
      </dl>
    </div>
  );
}

