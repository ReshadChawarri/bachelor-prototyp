import { useMemo, useRef, useState } from "react";
import { importPdf } from "./api/pdfImport";
import { DocumentWorkspace } from "./editor/DocumentWorkspace";
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importRequestCounter = useRef(0);

  const selectedParagraph = useMemo(
    () => documentModel.paragraphs.find((paragraph) => paragraph.id === selection.paragraphId),
    [documentModel.paragraphs, selection.paragraphId],
  );

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
            Local draft · Revision {documentModel.revision}
            {importing ? " · Importing document..." : ""}
          </div>
        </div>
        <nav className="menu-row" aria-label="Document menu">
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
      </header>

      <DocumentWorkspace
        title={documentTitle}
        importRequest={importRequest}
        leftPanelOpen={leftPanelOpen}
        rightPanelOpen={rightPanelOpen}
        selectedParagraph={selectedParagraph}
        selection={selection}
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

export default App;
