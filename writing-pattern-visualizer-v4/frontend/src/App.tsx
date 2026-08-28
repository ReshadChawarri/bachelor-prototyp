import { useMemo, useRef, useState } from "react";
import type { ParagraphRevisionLifecycleCallbacks } from "./ai/useParagraphRevisionSuggestion";
import { importPdf } from "./api/pdfImport";
import { finishStudyTask, startStudyTask } from "./api/study";
import { useBackendWritingAnalytics } from "./analytics/useBackendWritingAnalytics";
import { DocumentWorkspace } from "./editor/DocumentWorkspace";
import { StudySetup } from "./study/StudySetup";
import { revisionGeneratedPayload, revisionFailedPayload, categorizeRevisionFailure } from "./study/revisionEvents";
import { buildTaskRevisionSummary, documentToPlainText } from "./study/studySummary";
import { studyTextToImportedDocument } from "./study/studyText";
import { useStudyLogger } from "./study/useStudyLogger";
import type { StudyTaskConfig, StudyTaskContext, StudyTaskFinishResponse } from "./study/types";
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

function App() {
  const studyModeEnabled = useMemo(() => isStudyModeEnabled(), []);
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
  const [studyTask, setStudyTask] = useState<StudyTaskContext | null>(null);
  const [initialStudyBlocks, setInitialStudyBlocks] = useState<ImportRequest["document"]["blocks"]>([]);
  const [studyStartError, setStudyStartError] = useState<string | null>(null);
  const [studyStarting, setStudyStarting] = useState(false);
  const [finishConfirming, setFinishConfirming] = useState(false);
  const [finishingStudyTask, setFinishingStudyTask] = useState(false);
  const [completedStudyTask, setCompletedStudyTask] = useState<StudyTaskFinishResponse | null>(null);
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

  const handleStartStudyTask = async (config: StudyTaskConfig) => {
    setStudyStarting(true);
    setStudyStartError(null);
    setCompletedStudyTask(null);
    try {
      const response = await startStudyTask(config);
      const importedDocument = studyTextToImportedDocument(response.studyText, response.filename);
      importRequestCounter.current += 1;
      setStudyTask(response.task);
      setInitialStudyBlocks(importedDocument.blocks);
      setDocumentTitle(`Study Text ${response.task.textId}`);
      setDocumentModel({
        documentId: response.task.sessionId,
        revision: 0,
        title: `Study Text ${response.task.textId}`,
        paragraphs: [],
      });
      setSelection(EMPTY_SELECTION);
      setImportRequest({
        requestId: importRequestCounter.current,
        document: importedDocument,
      });
      setImportMessage(null);
      setImportError(null);
      setLeftPanelOpen(true);
      setRightPanelOpen(response.task.condition === "B");
      setFinishConfirming(false);
      setFinishError(null);
    } catch (error) {
      setStudyStartError(error instanceof Error ? error.message : "Study task could not be started.");
    } finally {
      setStudyStarting(false);
    }
  };

  const handleFinishStudyTask = async () => {
    if (!studyTask || finishingStudyTask) {
      return;
    }
    setFinishingStudyTask(true);
    setFinishError(null);
    try {
      await studyLogger.flushEvents();
      const finalText = documentToPlainText(documentModel);
      const summary = buildTaskRevisionSummary(initialStudyBlocks, documentModel);
      const response = await finishStudyTask({
        task: studyTask,
        summarySequenceNumber: studyLogger.reserveSequenceNumber(),
        finishedSequenceNumber: studyLogger.reserveSequenceNumber(),
        finalText,
        summary,
      });
      setCompletedStudyTask(response);
      setStudyTask(null);
      setInitialStudyBlocks([]);
      setImportRequest(null);
      setSelection(EMPTY_SELECTION);
      setDocumentModel(EMPTY_DOCUMENT);
      setDocumentTitle("Untitled academic text");
      setFinishConfirming(false);
    } catch (error) {
      setFinishError(error instanceof Error ? error.message : "Study task could not be finished.");
    } finally {
      setFinishingStudyTask(false);
    }
  };

  if (studyModeEnabled && !studyTask) {
    return (
      <StudySetup
        completedTask={completedStudyTask}
        error={studyStartError}
        loading={studyStarting}
        onStart={handleStartStudyTask}
      />
    );
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
          />
          <div className="document-status">
            {studyTask
              ? `${studyTask.participantId} · Condition ${studyTask.condition} · Text ${studyTask.textId} · Task ${studyTask.taskOrder}`
              : "Local draft"}{" "}
            · Revision {documentModel.revision}
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
              <strong>Finish this study task?</strong>
              <span>The final text and interaction log will be saved.</span>
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
        key={studyTask?.sessionId ?? "normal-workspace"}
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
        onDocumentChange={(nextDocument) => {
          setDocumentModel({ ...nextDocument, title: documentTitle });
        }}
        onSelectionChange={setSelection}
        onToggleLeftPanel={() => setLeftPanelOpen((open) => !open)}
        onToggleRightPanel={() => setRightPanelOpen((open) => !open)}
      />
    </div>
  );
}

function isStudyModeEnabled(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get("study") === "1" || window.location.pathname.endsWith("/study");
}

export default App;
