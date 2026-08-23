import { useMemo, useState } from "react";
import { DocumentWorkspace } from "./editor/DocumentWorkspace";
import type { DocumentModel, EditorSelection } from "./types/document";

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
          <div className="document-status">Local draft · Revision {documentModel.revision}</div>
        </div>
        <nav className="menu-row" aria-label="Document menu">
          <button type="button">File</button>
          <button type="button">Edit</button>
          <button type="button">View</button>
          <button type="button">Insert</button>
          <button type="button">Format</button>
          <button type="button">Tools</button>
        </nav>
      </header>

      <DocumentWorkspace
        title={documentTitle}
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

