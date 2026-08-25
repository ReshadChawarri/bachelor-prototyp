# Writing Pattern Visualizer V4

Phase 5A technical foundation for a React/TypeScript writing workspace, deterministic writing analytics, editable PDF import, and paragraph-level AI writing analysis through a FastAPI backend.

V4 is intentionally created in parallel to the existing V3 Streamlit prototype. Phase 5A adds OpenAI-backed semantic analysis for the currently selected prose paragraph only. It does not implement whole-document AI analysis, AI rewriting, revision generation, databases, OCR, or evaluation logging.

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

## Phase 5A Scope

- Adds `POST /api/ai/analyze-paragraph` in the FastAPI backend.
- Uses the OpenAI Responses API from the backend only.
- Reads `OPENAI_API_KEY` and `OPENAI_MODEL` from backend environment variables.
- Defaults the backend model to `gpt-5.6-luna`.
- Analyzes only the currently selected prose paragraph plus minimal local context.
- Displays paragraph role, rhetorical moves, coherence, academic tone, and one concise observation.
- Does not rewrite, correct, grade, score, or modify the document.
- Does not expose the OpenAI API key to the frontend.

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

For local AI analysis, create a backend `.env` or export these variables before starting `uvicorn`:

```bash
export OPENAI_API_KEY=sk-your-development-key
export OPENAI_MODEL=gpt-5.6-luna
```

The repository includes `backend/.env.example` with placeholders only. Real `.env` files are gitignored.

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

## Paragraph AI Analysis Endpoint

```text
POST /api/ai/analyze-paragraph
```

The endpoint accepts the selected paragraph, nearest heading, previous prose paragraph, and next prose paragraph. It returns validated structured analysis only. The endpoint does not accept full TipTap JSON and does not modify documents.

## Backend Tests

```bash
cd writing-pattern-visualizer-v4/backend
source .venv/bin/activate
python -m unittest discover -s tests -v
```

## Current Limitations

- Whole-document AI analysis is not implemented yet
- AI rewriting and Accept/Reject revision suggestions are not implemented
- No paragraph revision suggestions
- No database or persistence
- No evaluation logging
- PDF import supports text-based PDFs only
- PDF import does not preserve exact layout, images, complex tables, formulas, or scanned text
