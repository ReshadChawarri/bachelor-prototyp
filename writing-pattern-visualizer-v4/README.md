# Writing Pattern Visualizer V4

Phase 1 technical foundation for a React/TypeScript writing workspace with a FastAPI backend.

V4 is intentionally created in parallel to the existing V3 Streamlit prototype. Phase 1 does not implement PDF import, local analytics, OpenAI integration, AI analysis, revision generation, databases, API keys, or evaluation logging.

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
  "phase": "phase-1"
}
```

## Current Limitations

- Placeholder panels only
- No PDF import
- No deterministic analytics service yet
- No OpenAI API usage
- No AI writing analysis
- No paragraph revision suggestions
- No database or persistence
- No evaluation logging

