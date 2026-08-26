import { EditorContent, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { clearAnalyticsHighlights, setAnalyticsHighlights } from "./analyticsHighlight";
import { createEditorExtensions } from "./extensions";
import { importedPdfToTipTapDocument } from "./importedDocument";
import { findDocumentNodeTarget, selectDocumentNode, type NavigableNodeType } from "./navigation";
import { serializeDocument } from "./serializer";
import { EditorToolbar } from "./EditorToolbar";
import { WritingAnalyticsPanel } from "../panels/WritingAnalyticsPanel";
import { AiWritingPanel } from "../panels/AiWritingPanel";
import type {
  ActiveAnalyticsHighlight,
  AnalyticsHighlightRequest,
  BackendAnalyticsState,
} from "../types/backendAnalytics";
import type { DocumentModel, EditorSelection, ImportRequest, ParagraphBlock } from "../types/document";

interface DocumentWorkspaceProps {
  title: string;
  document: DocumentModel;
  backendAnalytics: BackendAnalyticsState;
  importRequest: ImportRequest | null;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  selectedParagraph?: ParagraphBlock;
  selection: EditorSelection;
  onDocumentChange: (document: DocumentModel) => void;
  onSelectionChange: (selection: EditorSelection) => void;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
}

const INITIAL_CONTENT = `
  <h1>Academic Working Draft</h1>
  <p>Start writing or paste an academic text here. The editor is the single source of truth for the document content.</p>
  <p>Phase 1 focuses on the writing workspace foundation, paragraph identity, and document editing behavior.</p>
`;

export function DocumentWorkspace({
  title,
  document,
  backendAnalytics,
  importRequest,
  leftPanelOpen,
  rightPanelOpen,
  selectedParagraph,
  selection,
  onDocumentChange,
  onSelectionChange,
  onToggleLeftPanel,
  onToggleRightPanel,
}: DocumentWorkspaceProps) {
  const revisionRef = useRef(0);
  const pageStageRef = useRef<HTMLDivElement | null>(null);
  const highlightedNodeRef = useRef<HTMLElement | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const [activeAnalyticsHighlight, setActiveAnalyticsHighlight] = useState<ActiveAnalyticsHighlight | null>(null);

  const publishDocument = useCallback(
    (editorInstance: NonNullable<ReturnType<typeof useEditor>>, nextRevision: number) => {
      onDocumentChange(serializeDocument(editorInstance, title, nextRevision));
    },
    [onDocumentChange, title],
  );

  const editor = useEditor({
    extensions: createEditorExtensions(),
    content: INITIAL_CONTENT,
    autofocus: "end",
    editorProps: {
      attributes: {
        class: "document-editor",
        "aria-label": "Editable academic document",
      },
    },
    onCreate: ({ editor: editorInstance }) => {
      publishDocument(editorInstance, revisionRef.current);
      onSelectionChange({ paragraphId: getSelectedParagraphId(editorInstance) });
    },
    onUpdate: ({ editor: editorInstance }) => {
      revisionRef.current += 1;
      publishDocument(editorInstance, revisionRef.current);
      onSelectionChange({ paragraphId: getSelectedParagraphId(editorInstance) });
    },
    onSelectionUpdate: ({ editor: editorInstance }) => {
      onSelectionChange({ paragraphId: getSelectedParagraphId(editorInstance) });
    },
  });

  useEffect(() => {
    if (!editor || !importRequest) {
      return;
    }

    editor.commands.setContent(importedPdfToTipTapDocument(importRequest.document), true);
    editor.commands.focus("start");
    onSelectionChange({ paragraphId: getSelectedParagraphId(editor) });
  }, [editor, importRequest, onSelectionChange]);

  useEffect(() => {
    return () => {
      clearNavigationHighlight(highlightedNodeRef, highlightTimerRef);
    };
  }, []);

  const clearActiveAnalyticsHighlights = useCallback(() => {
    if (editor) {
      clearAnalyticsHighlights(editor);
    }
    setActiveAnalyticsHighlight(null);
  }, [editor]);

  const toggleAnalyticsHighlight = useCallback(
    (request: AnalyticsHighlightRequest) => {
      if (!editor) {
        return;
      }

      const isSameHighlight =
        activeAnalyticsHighlight?.type === request.type &&
        activeAnalyticsHighlight.key === request.key &&
        activeAnalyticsHighlight.revision === request.revision;

      if (isSameHighlight) {
        clearActiveAnalyticsHighlights();
        return;
      }

      if (request.revision !== document.revision || request.occurrences.length === 0) {
        clearActiveAnalyticsHighlights();
        return;
      }

      const resolvedCount = setAnalyticsHighlights(
        editor,
        request.occurrences.map((occurrence) => ({
          ...occurrence,
          kind: request.type,
        })),
      );

      if (resolvedCount !== request.occurrences.length) {
        clearAnalyticsHighlights(editor);
        setActiveAnalyticsHighlight(null);
        return;
      }

      setActiveAnalyticsHighlight({
        type: request.type,
        key: request.key,
        label: request.label,
        revision: request.revision,
        count: resolvedCount,
      });
    },
    [activeAnalyticsHighlight, clearActiveAnalyticsHighlights, document.revision, editor],
  );

  useEffect(() => {
    if (activeAnalyticsHighlight && activeAnalyticsHighlight.revision !== document.revision) {
      clearActiveAnalyticsHighlights();
    }
  }, [activeAnalyticsHighlight, clearActiveAnalyticsHighlights, document.revision]);

  useEffect(() => {
    if (!activeAnalyticsHighlight) {
      return;
    }

    const analyticsRevision = backendAnalytics.data?.revision;
    if (backendAnalytics.error || (analyticsRevision !== undefined && analyticsRevision !== activeAnalyticsHighlight.revision)) {
      clearActiveAnalyticsHighlights();
    }
  }, [activeAnalyticsHighlight, backendAnalytics.data?.revision, backendAnalytics.error, clearActiveAnalyticsHighlights]);

  const navigateToDocumentNode = useCallback(
    (nodeId: string, expectedType: NavigableNodeType) => {
      if (!editor) {
        return;
      }

      const target = findDocumentNodeTarget(editor, nodeId, expectedType);
      if (!target) {
        return;
      }

      const targetElement = editor.view.nodeDOM(target.position);
      const didSelect = selectDocumentNode(editor, target);
      if (!didSelect || !(targetElement instanceof HTMLElement)) {
        return;
      }

      scrollElementIntoPageStage(targetElement, pageStageRef.current);
      showNavigationHighlight(targetElement, highlightedNodeRef, highlightTimerRef);
    },
    [editor],
  );

  const selectedLabel = useMemo(
    () => selectedParagraph?.text || "Select a paragraph in the document to connect it with the panels.",
    [selectedParagraph],
  );

  return (
    <main className="workspace-grid">
      <aside className={leftPanelOpen ? "side-panel left-panel" : "side-panel left-panel collapsed"}>
        <button
          className="panel-toggle"
          type="button"
          onClick={onToggleLeftPanel}
          aria-expanded={leftPanelOpen}
        >
          {leftPanelOpen ? "<" : ">"}
        </button>
        {leftPanelOpen && (
          <WritingAnalyticsPanel
            document={document}
            backendAnalytics={backendAnalytics}
            revision={revisionRef.current}
            selectedParagraph={selectedParagraph}
            selectedParagraphId={selection.paragraphId}
            activeAnalyticsHighlight={activeAnalyticsHighlight}
            onNavigateToParagraph={(paragraphId) => navigateToDocumentNode(paragraphId, "paragraph")}
            onNavigateToHeading={(headingId) => navigateToDocumentNode(headingId, "heading")}
            onToggleAnalyticsHighlight={toggleAnalyticsHighlight}
            onClearAnalyticsHighlights={clearActiveAnalyticsHighlights}
          />
        )}
      </aside>

      <section className="document-area" aria-label="Document workspace">
        <EditorToolbar editor={editor} />
        <div className="ruler" aria-hidden="true">
          {Array.from({ length: 17 }, (_, index) => (
            <span key={index} className={index % 4 === 0 ? "ruler-tick major" : "ruler-tick"} />
          ))}
        </div>
        <div className="page-stage" ref={pageStageRef}>
          <article className="document-page">
            {editor ? <EditorContent editor={editor} /> : <div className="editor-loading">Loading editor...</div>}
          </article>
        </div>
        <footer className="workspace-status">
          <span>Selected paragraph: {selection.paragraphId || "none"}</span>
          <span className="workspace-status-text">{selectedLabel}</span>
        </footer>
      </section>

      <aside className={rightPanelOpen ? "side-panel right-panel" : "side-panel right-panel collapsed"}>
        <button
          className="panel-toggle"
          type="button"
          onClick={onToggleRightPanel}
          aria-expanded={rightPanelOpen}
        >
          {rightPanelOpen ? ">" : "<"}
        </button>
        {rightPanelOpen && (
          <AiWritingPanel
            document={document}
            selectedParagraph={selectedParagraph}
            selectedParagraphId={selection.paragraphId}
            onNavigateToParagraph={(paragraphId) => navigateToDocumentNode(paragraphId, "paragraph")}
          />
        )}
      </aside>
    </main>
  );
}

function getSelectedParagraphId(editor: NonNullable<ReturnType<typeof useEditor>>): string | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    const paragraphId = node.attrs.paragraphId;
    if (typeof paragraphId === "string" && paragraphId.length > 0) {
      return paragraphId;
    }
  }
  return null;
}

export function scrollElementIntoPageStage(targetElement: HTMLElement, pageStage: HTMLElement | null) {
  if (!pageStage) {
    return;
  }

  const targetRect = targetElement.getBoundingClientRect();
  const stageRect = pageStage.getBoundingClientRect();
  const targetOffset = targetRect.top - stageRect.top;
  const comfortableOffset = stageRect.height * 0.32;

  pageStage.scrollTo({
    top: pageStage.scrollTop + targetOffset - comfortableOffset,
    behavior: "smooth",
  });
}

function showNavigationHighlight(
  targetElement: HTMLElement,
  highlightedNodeRef: MutableRefObject<HTMLElement | null>,
  highlightTimerRef: MutableRefObject<number | null>,
) {
  clearNavigationHighlight(highlightedNodeRef, highlightTimerRef);

  targetElement.classList.add("navigation-target-highlight");
  highlightedNodeRef.current = targetElement;
  highlightTimerRef.current = window.setTimeout(() => {
    targetElement.classList.remove("navigation-target-highlight");
    if (highlightedNodeRef.current === targetElement) {
      highlightedNodeRef.current = null;
    }
    highlightTimerRef.current = null;
  }, 1600);
}

function clearNavigationHighlight(
  highlightedNodeRef: MutableRefObject<HTMLElement | null>,
  highlightTimerRef: MutableRefObject<number | null>,
) {
  if (highlightTimerRef.current !== null) {
    window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = null;
  }

  highlightedNodeRef.current?.classList.remove("navigation-target-highlight");
  highlightedNodeRef.current = null;
}
