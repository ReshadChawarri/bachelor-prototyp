import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { buildSentenceDistribution, calculateLocalWritingAnalytics } from "../analytics/localAnalytics";
import type { ParagraphLengthMetric, SentenceDistributionMetric, SentenceLengthMetric } from "../analytics/localAnalytics";
import {
  isMeaningfulParagraphLengthTarget,
  PARAGRAPH_LENGTH_TARGET_POLICY,
  paragraphLengthTargetRange,
} from "../analytics/paragraphLengthTarget";
import { useParagraphRevisionSuggestion } from "../ai/useParagraphRevisionSuggestion";
import type { ParagraphRevisionLifecycleCallbacks, ParagraphRevisionState } from "../ai/useParagraphRevisionSuggestion";
import { RevisionSuggestionCard } from "./RevisionSuggestionCard";
import type {
  ActiveAnalyticsHighlight,
  AnalyticsLanguage,
  AnalyticsHighlightRequest,
  BackendAnalyticsState,
  DocumentAnalyticsResponse,
  RepetitionAnalytics,
  TransitionAnalytics,
  DocumentStructureAnalytics,
} from "../types/backendAnalytics";
import type { SuggestRevisionResponse } from "../types/aiAnalysis";
import type { DocumentModel, ParagraphBlock } from "../types/document";
import type { ParagraphRevisionApplyResult } from "../editor/revision";
import type { StudyEventLogger } from "../study/types";

interface WritingAnalyticsPanelProps {
  document: DocumentModel;
  backendAnalytics: BackendAnalyticsState;
  revision: number;
  selectedParagraph?: ParagraphBlock;
  selectedParagraphId: string | null;
  language?: AnalyticsLanguage;
  aiFeaturesEnabled?: boolean;
  activeAnalyticsHighlight?: ActiveAnalyticsHighlight | null;
  sentenceRevisionState?: ParagraphRevisionState;
  revisionLifecycleCallbacks?: ParagraphRevisionLifecycleCallbacks;
  onStudyEvent?: StudyEventLogger;
  onAcceptRevision?: (suggestion: SuggestRevisionResponse) => ParagraphRevisionApplyResult;
  onNavigateToParagraph?: (paragraphId: string) => void;
  onNavigateToHeading?: (headingId: string) => void;
  onToggleAnalyticsHighlight?: (request: AnalyticsHighlightRequest) => void;
  onClearAnalyticsHighlights?: () => void;
}

export function WritingAnalyticsPanel({
  document,
  backendAnalytics,
  revision,
  selectedParagraph,
  selectedParagraphId,
  language = "English",
  aiFeaturesEnabled = true,
  activeAnalyticsHighlight,
  sentenceRevisionState: externalSentenceRevisionState,
  revisionLifecycleCallbacks,
  onStudyEvent,
  onAcceptRevision,
  onNavigateToParagraph,
  onNavigateToHeading,
  onToggleAnalyticsHighlight,
  onClearAnalyticsHighlights,
}: WritingAnalyticsPanelProps) {
  const [allParagraphsOpen, setAllParagraphsOpen] = useState(false);
  const [sentenceDistributionOpen, setSentenceDistributionOpen] = useState(false);
  const [transitionCategoriesOpen, setTransitionCategoriesOpen] = useState(false);
  const [repetitionTermsOpen, setRepetitionTermsOpen] = useState(false);
  const [documentStructureOpen, setDocumentStructureOpen] = useState(false);
  const [lengthAcceptMessage, setLengthAcceptMessage] = useState<string | null>(null);
  const analytics = useMemo(() => calculateLocalWritingAnalytics(document), [document]);
  const paragraphLengthRevisionState = useParagraphRevisionSuggestion(
    document,
    selectedParagraph,
    selectedParagraphId,
    language,
    aiFeaturesEnabled,
    revisionLifecycleCallbacks,
  );
  const localSentenceRevisionState = useParagraphRevisionSuggestion(
    document,
    selectedParagraph,
    selectedParagraphId,
    language,
    aiFeaturesEnabled,
    revisionLifecycleCallbacks,
  );
  const sentenceRevisionState = externalSentenceRevisionState ?? localSentenceRevisionState;
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
  const selectedSentenceProfile = useMemo(
    () => buildSelectedSentenceProfile(selectedParagraphLength, analytics.sentenceLengths),
    [analytics.sentenceLengths, selectedParagraphLength],
  );
  const currentBackendAnalytics =
    backendAnalytics.data?.revision === document.revision ? backendAnalytics.data : null;

  useEffect(() => {
    setLengthAcceptMessage(null);
  }, [selectedParagraphId, selectedParagraph?.text]);

  const handleAcceptLengthRevision = (suggestion: SuggestRevisionResponse) => {
    if (!onAcceptRevision) {
      setLengthAcceptMessage("The revision cannot be applied in the current editor state.");
      return;
    }

    const result = onAcceptRevision(suggestion);
    if (result.applied) {
      onStudyEvent?.("revision_accepted", {
        paragraphId: suggestion.paragraphId,
        action: suggestion.action,
      });
      paragraphLengthRevisionState.clear();
      setLengthAcceptMessage(null);
      return;
    }

    onStudyEvent?.("revision_failed", {
      paragraphId: suggestion.paragraphId,
      action: suggestion.action,
      category: result.reason === "stale" ? "stale" : "unknown",
    });
    paragraphLengthRevisionState.clear();
    setLengthAcceptMessage(messageForApplyResult(result));
  };

  return (
    <div className="panel-content">
      <p className="panel-kicker">Deterministic</p>
      <h2>Writing Analytics</h2>
      <p className="panel-description">
        Local metrics update directly from the editable document. Headings and imported non-prose blocks are kept
        separate from prose paragraph analytics.
      </p>
      {activeAnalyticsHighlight && (
        <div className="active-highlight-notice">
          <span>
            Highlighting {activeAnalyticsHighlight.count} occurrence
            {activeAnalyticsHighlight.count === 1 ? "" : "s"} of {activeAnalyticsHighlight.label}
          </span>
          <button type="button" className="clear-highlights-button" onClick={onClearAnalyticsHighlights}>
            Clear highlights
          </button>
        </div>
      )}

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
            <SelectedParagraphLengthView
              paragraph={selectedParagraphLength}
              selectedParagraph={selectedParagraph}
              maxParagraphWords={maxParagraphWords}
              revisionState={paragraphLengthRevisionState}
              aiFeaturesEnabled={aiFeaturesEnabled}
              acceptMessage={lengthAcceptMessage}
              onAcceptRevision={handleAcceptLengthRevision}
              onStudyEvent={onStudyEvent}
            />

            <button
              className="paragraph-overview-toggle"
              type="button"
              aria-expanded={allParagraphsOpen}
              onClick={() => {
                setAllParagraphsOpen((open) => {
                  if (!open) {
                    onStudyEvent?.("analytics_section_expanded", { section: "paragraph_length" });
                  }
                  return !open;
                });
              }}
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
        <SelectedSentenceLengthView
          profile={selectedSentenceProfile}
          revisionState={sentenceRevisionState}
          aiFeaturesEnabled={aiFeaturesEnabled}
          onStudyEvent={onStudyEvent}
        />

        <DisclosureToggle
          expanded={sentenceDistributionOpen}
          label="Document distribution"
          onToggle={() =>
            setSentenceDistributionOpen((open) => {
              if (!open) {
                onStudyEvent?.("analytics_section_expanded", { section: "sentence_length" });
              }
              return !open;
            })
          }
        />

        {sentenceDistributionOpen && (
          <SentenceDistributionList
            distribution={analytics.sentenceDistribution}
            maxSentenceBucketCount={maxSentenceBucketCount}
          />
        )}
      </section>

      <TransitionWordsSection
        analytics={currentBackendAnalytics}
        loading={backendAnalytics.loading}
        error={backendAnalytics.error}
        activeHighlight={activeAnalyticsHighlight}
        expanded={transitionCategoriesOpen}
        onToggleExpanded={() =>
          setTransitionCategoriesOpen((open) => {
            if (!open) {
              onStudyEvent?.("analytics_section_expanded", { section: "transition_words" });
            }
            return !open;
          })
        }
        onToggleAnalyticsHighlight={onToggleAnalyticsHighlight}
      />

      <RepetitionSection
        analytics={currentBackendAnalytics}
        loading={backendAnalytics.loading}
        error={backendAnalytics.error}
        activeHighlight={activeAnalyticsHighlight}
        expanded={repetitionTermsOpen}
        onToggleExpanded={() =>
          setRepetitionTermsOpen((open) => {
            if (!open) {
              onStudyEvent?.("analytics_section_expanded", { section: "repetition" });
            }
            return !open;
          })
        }
        onToggleAnalyticsHighlight={onToggleAnalyticsHighlight}
      />

      <DocumentStructureSection
        analytics={currentBackendAnalytics}
        loading={backendAnalytics.loading}
        error={backendAnalytics.error}
        selectedNodeId={selectedParagraphId}
        expanded={documentStructureOpen}
        onToggleExpanded={() =>
          setDocumentStructureOpen((open) => {
            if (!open) {
              onStudyEvent?.("analytics_section_expanded", { section: "document_structure" });
            }
            return !open;
          })
        }
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
  activeHighlight,
  expanded,
  onToggleExpanded,
  onToggleAnalyticsHighlight,
}: {
  analytics: DocumentAnalyticsResponse | null;
  loading: boolean;
  error: string | null;
  activeHighlight?: ActiveAnalyticsHighlight | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleAnalyticsHighlight?: (request: AnalyticsHighlightRequest) => void;
}) {
  return (
    <section className="analytics-section" aria-label="Transition words">
      <h3>Transition Words</h3>
      <BackendSectionState loading={loading} error={error} analytics={analytics}>
        {(current) => (
          <TransitionWordsContent
            transitions={current.transitions}
            revision={current.revision}
            activeHighlight={activeHighlight}
            expanded={expanded}
            onToggleExpanded={onToggleExpanded}
            onToggleAnalyticsHighlight={onToggleAnalyticsHighlight}
          />
        )}
      </BackendSectionState>
    </section>
  );
}

function TransitionWordsContent({
  transitions,
  revision,
  activeHighlight,
  expanded,
  onToggleExpanded,
  onToggleAnalyticsHighlight,
}: {
  transitions: TransitionAnalytics;
  revision: number;
  activeHighlight?: ActiveAnalyticsHighlight | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleAnalyticsHighlight?: (request: AnalyticsHighlightRequest) => void;
}) {
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
      <DisclosureToggle expanded={expanded} label="Show categories" onToggle={onToggleExpanded} />
      {expanded &&
        transitions.categories.map((category) => (
          <CountBarRow
            key={category.name}
            label={category.name}
            count={category.count}
            maxCount={maxCategoryCount}
            fillClassName="transition-fill"
            isActive={
              activeHighlight?.type === "transition" &&
              activeHighlight.key === category.name &&
              activeHighlight.revision === revision
            }
            ariaLabel={`Highlight ${category.count} ${category.name} transition occurrence${
              category.count === 1 ? "" : "s"
            }`}
            onActivate={
              onToggleAnalyticsHighlight
                ? () =>
                    onToggleAnalyticsHighlight({
                      type: "transition",
                      key: category.name,
                      label: category.name,
                      revision,
                      occurrences: category.occurrences.map(({ paragraphId, startOffset, endOffset }) => ({
                        paragraphId,
                        startOffset,
                        endOffset,
                      })),
                    })
                : undefined
            }
          />
        ))}
    </div>
  );
}

function RepetitionSection({
  analytics,
  loading,
  error,
  activeHighlight,
  expanded,
  onToggleExpanded,
  onToggleAnalyticsHighlight,
}: {
  analytics: DocumentAnalyticsResponse | null;
  loading: boolean;
  error: string | null;
  activeHighlight?: ActiveAnalyticsHighlight | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleAnalyticsHighlight?: (request: AnalyticsHighlightRequest) => void;
}) {
  return (
    <section className="analytics-section" aria-label="Repetition">
      <h3>Repetition</h3>
      <BackendSectionState loading={loading} error={error} analytics={analytics}>
        {(current) => (
          <RepetitionContent
            repetition={current.repetition}
            revision={current.revision}
            activeHighlight={activeHighlight}
            expanded={expanded}
            onToggleExpanded={onToggleExpanded}
            onToggleAnalyticsHighlight={onToggleAnalyticsHighlight}
          />
        )}
      </BackendSectionState>
    </section>
  );
}

function RepetitionContent({
  repetition,
  revision,
  activeHighlight,
  expanded,
  onToggleExpanded,
  onToggleAnalyticsHighlight,
}: {
  repetition: RepetitionAnalytics;
  revision: number;
  activeHighlight?: ActiveAnalyticsHighlight | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleAnalyticsHighlight?: (request: AnalyticsHighlightRequest) => void;
}) {
  const maxTermCount = Math.max(1, ...repetition.terms.map((term) => term.count));

  if (repetition.terms.length === 0) {
    return <p className="analytics-empty">No notable repetition detected.</p>;
  }

  return (
    <div className="analytics-count-list">
      <p className="analytics-compact-summary">
        {repetition.terms.length} repeated term{repetition.terms.length === 1 ? "" : "s"}
      </p>
      <DisclosureToggle expanded={expanded} label="Show repeated terms" onToggle={onToggleExpanded} />
      {expanded &&
        repetition.terms.map((term) => (
          <CountBarRow
            key={term.term}
            label={term.term}
            count={term.count}
            maxCount={maxTermCount}
            fillClassName="repetition-fill"
            isActive={
              activeHighlight?.type === "repetition" &&
              activeHighlight.key === term.term &&
              activeHighlight.revision === revision
            }
            ariaLabel={`Highlight ${term.count} occurrence${term.count === 1 ? "" : "s"} of ${term.term}`}
            onActivate={
              onToggleAnalyticsHighlight
                ? () =>
                    onToggleAnalyticsHighlight({
                      type: "repetition",
                      key: term.term,
                      label: term.term,
                      revision,
                      occurrences: term.occurrences.map(({ paragraphId, startOffset, endOffset }) => ({
                        paragraphId,
                        startOffset,
                        endOffset,
                      })),
                    })
                : undefined
            }
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
  expanded,
  onToggleExpanded,
  onNavigateToHeading,
}: {
  analytics: DocumentAnalyticsResponse | null;
  loading: boolean;
  error: string | null;
  selectedNodeId: string | null;
  expanded: boolean;
  onToggleExpanded: () => void;
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
            expanded={expanded}
            onToggleExpanded={onToggleExpanded}
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
  expanded,
  onToggleExpanded,
  onNavigateToHeading,
}: {
  structure: DocumentStructureAnalytics;
  selectedNodeId: string | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  onNavigateToHeading?: (headingId: string) => void;
}) {
  if (structure.headings.length === 0) {
    return <p className="analytics-empty">No document headings detected.</p>;
  }

  return (
    <>
      <p className="analytics-compact-summary">
        {structure.headings.length} heading{structure.headings.length === 1 ? "" : "s"}
      </p>
      <DisclosureToggle expanded={expanded} label="Show structure" onToggle={onToggleExpanded} />
      {expanded && (
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
      )}
    </>
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

interface SelectedSentenceProfile {
  paragraphId: string;
  label: string;
  sentenceCount: number;
  averageSentenceLength: number;
  distribution: SentenceDistributionMetric[];
}

function SelectedSentenceLengthView({
  profile,
  revisionState,
  aiFeaturesEnabled,
  onStudyEvent,
}: {
  profile?: SelectedSentenceProfile;
  revisionState: ParagraphRevisionState;
  aiFeaturesEnabled: boolean;
  onStudyEvent?: StudyEventLogger;
}) {
  if (!profile) {
    return (
      <div className="selected-paragraph-summary empty">
        <p>Select a paragraph to inspect</p>
        <p>its sentence structure.</p>
      </div>
    );
  }

  const maxSelectedSentenceCount = Math.max(1, ...profile.distribution.map((bucket) => bucket.count));
  const isSentenceRevisionLoading =
    revisionState.status === "loading" && revisionState.activeAction === "improve_sentence_length";
  const isSentenceRevisionError =
    revisionState.status === "error" && revisionState.activeAction === "improve_sentence_length";
  const isSentenceRevisionReady =
    revisionState.status === "success" && revisionState.suggestion?.action === "improve_sentence_length";

  return (
    <div className="selected-paragraph-summary" data-paragraph-id={profile.paragraphId}>
      <p className="selected-paragraph-meta">Selected paragraph · {profile.label}</p>
      <div className="sentence-profile-row">
        <span>Avg. sentence</span>
        <strong>{formatAverage(profile.averageSentenceLength)} words</strong>
      </div>
      <div className="sentence-profile-list" aria-label="Selected paragraph sentence profile">
        {profile.distribution.map((bucket) => (
          <div key={bucket.category} className="sentence-profile-item">
            <span>{bucket.category}</span>
            <div className="analytics-bar-track" aria-hidden="true">
              <span
                className="analytics-bar-fill sentence-fill"
                style={{ width: barWidthPercent(bucket.count, maxSelectedSentenceCount) }}
              />
            </div>
            <strong>{bucket.count}</strong>
          </div>
        ))}
      </div>
      {aiFeaturesEnabled && (
        <>
          <button
            className="paragraph-target-generate"
            type="button"
            disabled={!revisionState.canRequest}
            onClick={() => {
              onStudyEvent?.("revision_requested", {
                paragraphId: profile.paragraphId,
                action: "improve_sentence_length",
                originalAverageSentenceLength: Number(profile.averageSentenceLength.toFixed(1)),
                originalVeryLongSentenceCount:
                  profile.distribution.find((bucket) => bucket.category === "Very long")?.count ?? 0,
              });
              revisionState.requestRevision("improve_sentence_length");
            }}
          >
            Make sentences more concise
          </button>
          {isSentenceRevisionLoading && <p className="analytics-empty">Generating revision...</p>}
          {isSentenceRevisionError && (
            <p className="analytics-empty">{revisionState.message || "A revision could not be generated. No changes were made."}</p>
          )}
          {isSentenceRevisionReady && (
            <p className="analytics-empty">Revision suggestion is available in AI Writing Analysis.</p>
          )}
        </>
      )}
    </div>
  );
}

function SentenceDistributionList({
  distribution,
  maxSentenceBucketCount,
}: {
  distribution: SentenceDistributionMetric[];
  maxSentenceBucketCount: number;
}) {
  return (
    <div className="analytics-bar-list sentence-distribution-list">
      {distribution.map((bucket) => (
        <div key={bucket.category} className="analytics-distribution-row">
          <div className="analytics-distribution-label">
            <span>{bucket.category}</span>
            <small>{bucket.rangeLabel}</small>
          </div>
          <div className="analytics-bar-track" aria-hidden="true">
            <span
              className="analytics-bar-fill sentence-fill"
              style={{ width: barWidthPercent(bucket.count, maxSentenceBucketCount) }}
            />
          </div>
          <span className="analytics-bar-value">{bucket.count}</span>
        </div>
      ))}
    </div>
  );
}

function DisclosureToggle({
  expanded,
  label,
  onToggle,
}: {
  expanded: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button className="paragraph-overview-toggle" type="button" aria-expanded={expanded} onClick={onToggle}>
      <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
      {label}
    </button>
  );
}

function CountBarRow({
  label,
  count,
  maxCount,
  fillClassName,
  isActive = false,
  ariaLabel,
  onActivate,
}: {
  label: string;
  count: number;
  maxCount: number;
  fillClassName: string;
  isActive?: boolean;
  ariaLabel?: string;
  onActivate?: () => void;
}) {
  const className = [
    "analytics-count-row",
    onActivate ? "interactive" : "",
    isActive ? "selected" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const content = (
    <>
      <span className="analytics-count-label">{label}</span>
      <div className="analytics-bar-track" aria-hidden="true">
        <span className={`analytics-bar-fill ${fillClassName}`} style={{ width: barWidthPercent(count, maxCount) }} />
      </div>
      <span className="analytics-bar-value">{count}</span>
    </>
  );

  if (onActivate) {
    return (
      <button
        className={className}
        type="button"
        aria-label={ariaLabel}
        aria-pressed={isActive}
        onClick={onActivate}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={className}>
      {content}
    </div>
  );
}

function buildSelectedSentenceProfile(
  paragraph: ParagraphLengthMetric | undefined,
  sentenceLengths: SentenceLengthMetric[],
): SelectedSentenceProfile | undefined {
  if (!paragraph) {
    return undefined;
  }

  const sentences = sentenceLengths.filter((sentence) => sentence.paragraphId === paragraph.paragraphId);
  const wordCount = sentences.reduce((total, sentence) => total + sentence.wordCount, 0);
  return {
    paragraphId: paragraph.paragraphId,
    label: paragraph.label,
    sentenceCount: sentences.length,
    averageSentenceLength: sentences.length > 0 ? wordCount / sentences.length : 0,
    distribution: buildSentenceDistribution(sentences),
  };
}

function SelectedParagraphLengthView({
  paragraph,
  selectedParagraph,
  maxParagraphWords,
  revisionState,
  aiFeaturesEnabled,
  acceptMessage,
  onAcceptRevision,
  onStudyEvent,
}: {
  paragraph?: ParagraphLengthMetric;
  selectedParagraph?: ParagraphBlock;
  maxParagraphWords: number;
  revisionState: ReturnType<typeof useParagraphRevisionSuggestion>;
  aiFeaturesEnabled: boolean;
  acceptMessage: string | null;
  onAcceptRevision: (suggestion: SuggestRevisionResponse) => void;
  onStudyEvent?: StudyEventLogger;
}) {
  const [targetWordCount, setTargetWordCount] = useState(paragraph?.wordCount ?? 0);

  useEffect(() => {
    setTargetWordCount(paragraph?.wordCount ?? 0);
  }, [paragraph?.paragraphId, paragraph?.wordCount]);

  if (!paragraph) {
    return (
      <div className="selected-paragraph-summary empty">
        <p>Select a paragraph in the document</p>
        <p>to view its length.</p>
      </div>
    );
  }

  const targetRange = paragraphLengthTargetRange(paragraph.wordCount);
  const canGenerate =
    revisionState.canRequest && isMeaningfulParagraphLengthTarget(paragraph.wordCount, targetWordCount);
  const suggestion = revisionState.suggestion;

  return (
    <div
      className="selected-paragraph-summary"
      data-paragraph-id={paragraph.paragraphId}
      title={paragraph.textPreview}
    >
      <p className="selected-paragraph-meta">Selected paragraph · {paragraph.label}</p>
      <div className="paragraph-length-current-row">
        <span>Current</span>
        <strong>
          {paragraph.wordCount} {paragraph.wordCount === 1 ? "word" : "words"}
        </strong>
      </div>
      <div className="analytics-bar-track selected-paragraph-track" aria-hidden="true">
        <span
          className="analytics-bar-fill paragraph-fill"
          style={{ width: barWidthPercent(paragraph.wordCount, maxParagraphWords) }}
        />
      </div>

      {aiFeaturesEnabled && revisionState.status === "success" && suggestion?.action === "adjust_paragraph_length" && selectedParagraph ? (
        <div className="paragraph-length-revision-preview">
          <h4>Revision Suggestion</h4>
          <RevisionSuggestionCard
            originalText={selectedParagraph.text}
            suggestion={suggestion}
            onReject={() => {
              onStudyEvent?.("revision_rejected", {
                paragraphId: suggestion.paragraphId,
                action: suggestion.action,
              });
              revisionState.reject();
            }}
            onAccept={() => onAcceptRevision(suggestion)}
          />
        </div>
      ) : aiFeaturesEnabled ? (
        <div className="paragraph-target-control">
          <div className="paragraph-target-header">
            <label htmlFor={`target-length-${paragraph.paragraphId}`}>Target length</label>
            <strong>{targetWordCount} words</strong>
          </div>
          <input
            id={`target-length-${paragraph.paragraphId}`}
            type="range"
            min={targetRange.min}
            max={targetRange.max}
            step={1}
            value={targetWordCount}
            disabled={!targetRange.enabled || revisionState.status === "loading"}
            aria-label="Target length in words"
            aria-valuetext={`${targetWordCount} words`}
            onChange={(event) => {
              setTargetWordCount(Number(event.currentTarget.value));
              if (revisionState.suggestion) {
                revisionState.clear();
              }
            }}
          />
          <div className="paragraph-target-range">
            <span>{targetRange.min}</span>
            <span>{targetRange.max}</span>
          </div>
          {!targetRange.enabled && (
            <p className="analytics-empty">
              Length adjustment is available for paragraphs with at least{" "}
              {PARAGRAPH_LENGTH_TARGET_POLICY.minimumAdjustableWords} words.
            </p>
          )}
          {targetRange.enabled && targetWordCount === paragraph.wordCount && (
            <p className="analytics-empty">Choose a different target length to generate a revision.</p>
          )}
          {revisionState.status === "loading" && <p className="analytics-empty">Generating revision...</p>}
          {revisionState.status === "error" && (
            <p className="analytics-empty">{revisionState.message || "A revision could not be generated. No changes were made."}</p>
          )}
          {acceptMessage && <p className="analytics-empty">{acceptMessage}</p>}
          <button
            className="paragraph-target-generate"
            type="button"
            disabled={!canGenerate}
            onClick={() => {
              onStudyEvent?.("revision_requested", {
                paragraphId: paragraph.paragraphId,
                action: "adjust_paragraph_length",
                currentWordCount: paragraph.wordCount,
                targetWordCount,
              });
              revisionState.requestRevision("adjust_paragraph_length", {
                targetWordCount,
              });
            }}
          >
            Generate revision
          </button>
        </div>
      ) : null}
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

function messageForApplyResult(result: Exclude<ParagraphRevisionApplyResult, { applied: true }>): string {
  if (result.reason === "stale") {
    return "This paragraph changed after the suggestion was generated. Generate a new revision before applying it.";
  }
  if (result.reason === "missing") {
    return "The target paragraph is no longer available. No changes were made.";
  }
  return "The revision could not be applied safely. No changes were made.";
}
