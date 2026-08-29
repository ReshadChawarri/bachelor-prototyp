import { useEffect, useMemo, useRef, useState } from "react";
import type { ParagraphRevisionLifecycleCallbacks } from "./ai/useParagraphRevisionSuggestion";
import { importPdf } from "./api/pdfImport";
import { fetchStudyTaskStatus, finishStudyTask, startStudyTask } from "./api/study";
import { useBackendWritingAnalytics } from "./analytics/useBackendWritingAnalytics";
import { DocumentWorkspace } from "./editor/DocumentWorkspace";
import { RemoteStudyCompleted, RemoteStudyInvalidLink, RemoteStudyLanding, RemoteStudyLoading } from "./study/RemoteStudyLanding";
import { revisionGeneratedPayload, revisionFailedPayload, categorizeRevisionFailure } from "./study/revisionEvents";
import { clearRemoteStudyDraft, documentModelToImportedDocument, loadRemoteStudyDraft, saveRemoteStudyDraft } from "./study/studyDraft";
import { buildTaskRevisionSummary, documentToPlainText } from "./study/studySummary";
import { studyTextToImportedDocument } from "./study/studyText";
import { createStudyEventId, useStudyLogger } from "./study/useStudyLogger";
import type { RemoteStudyClientTask, RemoteStudyTaskStatusResponse, StudyTaskStartResponse } from "./study/types";
import type { DocumentModel, EditorSelection, ImportRequest } from "./types/document";

const EMPTY_DOCUMENT: DocumentModel = {
  documentId: "local-draft",
  revision: 0,
  title: "Untitled academic text",
  paragraphs: [],
};

const EMPTY_SELECTION: EditorSelection = {
  paragraphId: null,
};

type RemoteStudyStatus = "checking" | "landing" | "running" | "completed" | "invalid";

interface StudyRouteState {
  enabled: boolean;
  token: string | null;
}

interface ActiveStudyTaskStatusResponse extends RemoteStudyTaskStatusResponse {
  status: "active";
  task: RemoteStudyClientTask;
  studyText: string;
  filename: string;
}

function App() {
  const studyRoute = useMemo(() => studyRouteFromPath(), []);
  const [remoteStudyStatus, setRemoteStudyStatus] = useState<RemoteStudyStatus>(
    studyRoute.enabled ? "checking" : "running",
  );
  const [documentTitle, setDocumentTitle] = useState("Untitled academic text");
  const [documentModel, setDocumentModel] = useState<DocumentModel>(EMPTY_DOCUMENT);
  const [selection, setSelection] = useState<EditorSelection>(EMPTY_SELECTION);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importRequest, setImportRequest] = useState<ImportRequest | null>(null);
  const [studyTask, setStudyTask] = useState<RemoteStudyClientTask | null>(null);
  const [initialStudyBlocks, setInitialStudyBlocks] = useState<ImportRequest["document"]["blocks"]>([]);
  const [studyStartError, setStudyStartError] = useState<string | null>(null);
  const [studyStarting, setStudyStarting] = useState(false);
  const [finishConfirming, setFinishConfirming] = useState(false);
  const [finishingStudyTask, setFinishingStudyTask] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importRequestCounter = useRef(0);
  const backendAnalytics = useBackendWritingAnalytics(documentModel, "English");
  const studyLogger = useStudyLogger(studyTask);
  const aiFeaturesEnabled = !studyTask || studyTask.condition === "B";

  const selectedParagraph = useMemo(
    () => documentModel.paragraphs.find((paragraph) => paragraph.id === selection.paragraphId),
    [documentModel.paragraphs, selection.paragraphId],
  );

  const loadStudyTask = (response: StudyTaskStartResponse, options: { restoreDraft: boolean }) => {
    const importedDocument = studyTextToImportedDocument(response.studyText, response.filename);
    const restoredDraft = options.restoreDraft
      ? loadRemoteStudyDraft(response.task.token, response.task.documentId)
      : null;
    const documentTitle = "Academic Text Revision Task";
    const nextDocument: DocumentModel = restoredDraft?.document ?? {
      documentId: response.task.documentId,
      revision: 0,
      title: documentTitle,
      paragraphs: [],
    };

    importRequestCounter.current += 1;
    setStudyTask(response.task);
    setInitialStudyBlocks(restoredDraft?.initialBlocks ?? importedDocument.blocks);
    setDocumentTitle(restoredDraft?.title ?? documentTitle);
    setDocumentModel({ ...nextDocument, title: restoredDraft?.title ?? documentTitle });
    setSelection(EMPTY_SELECTION);
    setImportRequest({
      requestId: importRequestCounter.current,
      document: restoredDraft
        ? documentModelToImportedDocument(restoredDraft.document, response.filename)
        : importedDocument,
    });
    setImportMessage(null);
    setImportError(null);
    setLeftPanelOpen(true);
    setRightPanelOpen(response.task.condition === "B");
    setFinishConfirming(false);
    setFinishError(null);
    setRemoteStudyStatus("running");
  };

  useEffect(() => {
    if (!studyRoute.enabled) {
      return;
    }
    if (!studyRoute.token) {
      setRemoteStudyStatus("invalid");
      return;
    }

    let cancelled = false;
    setRemoteStudyStatus("checking");
    fetchStudyTaskStatus(studyRoute.token)
      .then((response) => {
        if (cancelled) {
          return;
        }
        if (response.status === "unused") {
          clearRemoteStudyDraft(studyRoute.token ?? "");
          setRemoteStudyStatus("landing");
          return;
        }
        if (response.status === "completed") {
          clearRemoteStudyDraft(studyRoute.token ?? "");
          setRemoteStudyStatus("completed");
          return;
        }
        if (isActiveStudyTaskResponse(response)) {
          loadStudyTask(response, { restoreDraft: true });
          return;
        }
        setRemoteStudyStatus("invalid");
      })
      .catch(() => {
        if (!cancelled) {
          setRemoteStudyStatus("invalid");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [studyRoute.enabled, studyRoute.token]);

  const revisionLifecycleCallbacks = useMemo<ParagraphRevisionLifecycleCallbacks>(
    () => ({
      onRequestGenerated: (response, generationLatencyMs) => {
        if (studyTask?.condition === "B") {
          studyLogger.logEvent("revision_generated", revisionGeneratedPayload(response, generationLatencyMs));
        }
      },
      onRequestFailed: (details, error, generationLatencyMs) => {
        if (studyTask?.condition === "B") {
          studyLogger.logEvent(
            "revision_failed",
            revisionFailedPayload(
              details.paragraphId,
              details.action,
              categorizeRevisionFailure(error),
              generationLatencyMs,
            ),
          );
        }
      },
    }),
    [studyLogger, studyTask?.condition],
  );

  const handleStartStudyTask = async () => {
    if (!studyRoute.token || studyStarting) {
      return;
    }
    setStudyStarting(true);
    setStudyStartError(null);
    try {
      clearRemoteStudyDraft(studyRoute.token);
      const response = await startStudyTask(studyRoute.token);
      loadStudyTask(response, { restoreDraft: false });
    } catch (error) {
      setStudyStartError(error instanceof Error ? error.message : "Study task could not be started.");
    } finally {
      setStudyStarting(false);
    }
  };

  const handleFinishStudyTask = async () => {
    if (!studyTask || !studyRoute.token || finishingStudyTask) {
      return;
    }
    setFinishingStudyTask(true);
    setFinishError(null);
    try {
      await studyLogger.flushEvents();
      const finalText = documentToPlainText(documentModel);
      const summary = buildTaskRevisionSummary(initialStudyBlocks, documentModel);
      await finishStudyTask(studyRoute.token, {
        summaryEventId: createStudyEventId(),
        finishedEventId: createStudyEventId(),
        summarySequenceNumber: studyLogger.reserveSequenceNumber(),
        finishedSequenceNumber: studyLogger.reserveSequenceNumber(),
        finalText,
        summary,
      });
      studyLogger.clearStoredState();
      clearRemoteStudyDraft(studyRoute.token);
      setStudyTask(null);
      setInitialStudyBlocks([]);
      setImportRequest(null);
      setSelection(EMPTY_SELECTION);
      setDocumentModel(EMPTY_DOCUMENT);
      setDocumentTitle("Untitled academic text");
      setFinishConfirming(false);
      setRemoteStudyStatus("completed");
    } catch (error) {
      setFinishError(error instanceof Error ? error.message : "Study task could not be finished.");
    } finally {
      setFinishingStudyTask(false);
    }
  };

  const handleDocumentChange = (nextDocument: DocumentModel) => {
    const titledDocument = { ...nextDocument, title: documentTitle };
    setDocumentModel(titledDocument);
    if (studyTask) {
      saveRemoteStudyDraft(studyTask.token, {
        documentId: studyTask.documentId,
        title: documentTitle,
        document: titledDocument,
        initialBlocks: initialStudyBlocks,
      });
    }
  };

  if (studyRoute.enabled && remoteStudyStatus === "checking") {
    return <RemoteStudyLoading />;
  }

  if (studyRoute.enabled && remoteStudyStatus === "invalid") {
    return <RemoteStudyInvalidLink />;
  }

  if (studyRoute.enabled && remoteStudyStatus === "completed") {
    return <RemoteStudyCompleted />;
  }

  if (studyRoute.enabled && !studyTask) {
    return <RemoteStudyLanding error={studyStartError} loading={studyStarting} onStart={handleStartStudyTask} />;
  }

  return (
    <div className="app-shell">
      <header className="top-chrome" aria-label="Document controls">
        <div className="title-row">
          <div className="app-mark" aria-hidden="true">
            W
          </div>
          <input
            className="document-title-input"
            value={documentTitle}
            onChange={(event) => setDocumentTitle(event.target.value)}
            aria-label="Document title"
            disabled={Boolean(studyTask)}
          />
          <div className="document-status">
            {studyTask ? "Study task" : "Local draft"} · Revision {documentModel.revision}
            {importing ? " · Importing document..." : ""}
          </div>
          {studyTask && (
            <button
              className="finish-task-button"
              type="button"
              disabled={finishingStudyTask}
              onClick={() => setFinishConfirming(true)}
            >
              Finish Task
            </button>
          )}
        </div>
        <nav className="menu-row" aria-label="Document menu">
          {!studyTask && (
            <div className="menu-item">
              <button type="button" onClick={() => setFileMenuOpen((open) => !open)} aria-haspopup="menu">
                File
              </button>
              {fileMenuOpen && (
                <div className="menu-popover" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setFileMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                  >
                    Import PDF
                  </button>
                </div>
              )}
            </div>
          )}
          <button type="button">Edit</button>
          <button type="button">View</button>
          <button type="button">Insert</button>
          <button type="button">Format</button>
          <button type="button">Tools</button>
        </nav>
        <input
          ref={fileInputRef}
          className="hidden-file-input"
          type="file"
          accept="application/pdf,.pdf"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (!file) {
              return;
            }

            setImporting(true);
            setImportError(null);
            setImportMessage(null);
            try {
              const importedDocument = await importPdf(file);
              importRequestCounter.current += 1;
              setImportRequest({
                requestId: importRequestCounter.current,
                document: importedDocument,
              });
              setImportMessage(
                `Imported ${importedDocument.blocks.length} editable text blocks from ${importedDocument.filename}.`,
              );
            } catch (error) {
              setImportError(error instanceof Error ? error.message : "PDF import failed.");
            } finally {
              setImporting(false);
            }
          }}
        />
        {(importMessage || importError) && (
          <div className={importError ? "import-banner error" : "import-banner"}>
            {importError || importMessage}
          </div>
        )}
        {studyLogger.warning && <div className="study-warning-banner">{studyLogger.warning}</div>}
        {finishError && <div className="study-warning-banner">{finishError}</div>}
        {finishConfirming && studyTask && (
          <div className="finish-confirmation" role="dialog" aria-label="Finish study task">
            <div>
              <strong>Finish this task?</strong>
              <span>Your final text and study interactions will be saved.</span>
            </div>
            <div className="finish-confirmation-actions">
              <button type="button" onClick={() => setFinishConfirming(false)} disabled={finishingStudyTask}>
                Cancel
              </button>
              <button type="button" onClick={handleFinishStudyTask} disabled={finishingStudyTask}>
                {finishingStudyTask ? "Finishing..." : "Finish"}
              </button>
            </div>
          </div>
        )}
      </header>

      <DocumentWorkspace
        key={studyTask?.token ?? "normal-workspace"}
        title={documentTitle}
        document={documentModel}
        backendAnalytics={backendAnalytics}
        importRequest={importRequest}
        leftPanelOpen={leftPanelOpen}
        rightPanelOpen={rightPanelOpen}
        selectedParagraph={selectedParagraph}
        selection={selection}
        aiFeaturesEnabled={aiFeaturesEnabled}
        revisionLifecycleCallbacks={revisionLifecycleCallbacks}
        onStudyEvent={studyTask ? studyLogger.logEvent : undefined}
        onDocumentChange={handleDocumentChange}
        onSelectionChange={setSelection}
        onToggleLeftPanel={() => setLeftPanelOpen((open) => !open)}
        onToggleRightPanel={() => setRightPanelOpen((open) => !open)}
      />
    </div>
  );
}

function studyRouteFromPath(): StudyRouteState {
  const match = window.location.pathname.match(/^\/study\/([^/?#]+)$/);
  if (match) {
    return { enabled: true, token: decodeURIComponent(match[1]) };
  }
  if (window.location.pathname === "/study" || window.location.pathname.startsWith("/study/")) {
    return { enabled: true, token: null };
  }
  return { enabled: false, token: null };
}

function isActiveStudyTaskResponse(response: RemoteStudyTaskStatusResponse): response is ActiveStudyTaskStatusResponse {
  return response.status === "active" && Boolean(response.task && response.studyText && response.filename);
}

export default App;
