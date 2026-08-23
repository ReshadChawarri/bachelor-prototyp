# Writing Pattern Visualizer V4

Phase 2 technical foundation for a React/TypeScript writing workspace with editable PDF import and a FastAPI backend.

V4 is intentionally created in parallel to the existing V3 Streamlit prototype. Phase 2 adds text-based PDF import only. It does not implement local analytics, OpenAI integration, AI analysis, revision generation, databases, API keys, OCR, or evaluation logging.

## Phase 1 Scope

- Google-Docs-like writing workspace without copying Google branding
- React + TypeScript + Vite frontend
- TipTap rich-text editor as the single source of truth
- Persistent `paragraphId` attributes on paragraph nodes
- Monotonically increasing frontend revision number for document mutations
- Collapsible left Writing Analytics panel with placeholders
- Collapsible right AI Writing Analysis panel with placeholders
- FastAPI backend foundation
- `GET /api/health`
- Development CORS for the Vite frontend

## Phase 2 Scope

- Adds **File -> Import PDF** in the frontend.
- Imports text-based `.pdf` files through the FastAPI backend.
- Uses `pdfplumber` as the primary extraction library.
- Reconstructs likely paragraphs conservatively instead of treating every visual line as a paragraph.
- Loads extracted text into TipTap as normal editable paragraph and heading nodes.
- Preserves the existing document if import fails.
- Does not add OCR, image extraction, exact layout reproduction, complex table handling, formulas, analytics, or AI behavior.

## Frontend Setup

```bash
cd writing-pattern-visualizer-v4/frontend
npm install
npm run dev
```

The frontend dev server defaults to:

```text
http://localhost:5173
```

If the backend runs on a different address, set:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000 npm run dev
```

## Frontend Build And Type Check

```bash
cd writing-pattern-visualizer-v4/frontend
npm run typecheck
npm run build
```

## Backend Setup

```bash
cd writing-pattern-visualizer-v4/backend
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The backend health endpoint is:

```text
http://localhost:8000/api/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "writing-pattern-visualizer-v4-backend",
  "phase": "phase-2"
}
```

## PDF Import Endpoint

```text
POST /api/import/pdf
```

The endpoint accepts a multipart `.pdf` upload and returns extracted editable text blocks. Phase 2 supports text-based PDFs only. OCR, image extraction, exact layout reproduction, complex tables, and mathematical formula reconstruction are intentionally out of scope.

## Backend Tests

```bash
cd writing-pattern-visualizer-v4/backend
source .venv/bin/activate
python -m unittest discover -s tests -v
```

## Current Limitations

- Placeholder panels only
- No deterministic analytics service yet
- No OpenAI API usage
- No AI writing analysis
- No paragraph revision suggestions
- No database or persistence
- No evaluation logging
- PDF import supports text-based PDFs only
- PDF import does not preserve exact layout, images, complex tables, formulas, or scanned text
