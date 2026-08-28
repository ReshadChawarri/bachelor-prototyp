# Writing Pattern Visualizer V4

React/TypeScript + FastAPI prototype for exploring academic writing patterns in an editable document workspace.

V4 runs in parallel to the preserved V3 Streamlit prototype. It keeps TipTap as the single source of truth for document content, supports editable text-based PDF import, deterministic Writing Analytics, paragraph-linked navigation/highlighting, paragraph-level AI analysis, and explicit AI revision suggestions with Preview, Accept, and Reject.

The system does not grade writing, assign scores, generate citations, check plagiarism, or silently rewrite text. OpenAI calls run only through the backend and only for user-visible AI features.

## Features

- Google-Docs-like editable workspace with persistent paragraph and heading IDs
- Text-based PDF import into editable TipTap content
- Instant local metrics for words, sentences, paragraphs, paragraph length, and sentence length
- Backend deterministic analytics for transition words, repetition, and document structure
- Editor-to-analytics selection synchronization
- Analytics-to-editor navigation for paragraphs and headings
- Deterministic transition and repetition highlighting with non-mutating decorations
- Paragraph-level AI analysis for role, rhetorical moves, coherence, academic tone, and a concise observation
- Explicit AI revision suggestions for clarity, academic tone, transition/coherence, paragraph length, and sentence length
- Study Mode v1.0 for counterbalanced within-subject evaluation tasks

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

## OpenAI Local Setup

The backend includes a local `backend/.env` file for development. To enable paragraph-level AI analysis and revision suggestions:

1. Install backend dependencies with the command above.
2. Open `writing-pattern-visualizer-v4/backend/.env`.
3. Set:

```text
OPENAI_API_KEY=<your key>
OPENAI_MODEL=gpt-5.6-luna
```

4. Restart the FastAPI backend.
5. Start or refresh the frontend.
6. Select a prose paragraph in the editor.

The local `.env` file is ignored by Git. `backend/.env.example` contains placeholders only. Never commit an API key.

## Study Mode v1.0

Study Mode is entered explicitly and is bypassed during normal development:

```text
http://localhost:5173/?study=1
```

The researcher configures each task before the participant starts:

- Participant ID: `P01`, `P02`, `P03`, ...
- Condition: `A` or `B`
- Study Text: `X` or `Y`
- Task order: `1` or `2`

Condition A includes the editor and deterministic Writing Analytics only. It hides AI controls and prevents AI analysis or revision requests from being triggered.

Condition B includes the same deterministic interface plus the currently implemented paragraph-level AI analysis and AI revision suggestions.

The fixed study texts live in:

```text
writing-pattern-visualizer-v4/study-materials/text-x.txt
writing-pattern-visualizer-v4/study-materials/text-y.txt
```

These are replaceable master files. Starting a task loads a fresh copy, so edits from one participant or task do not modify the master text.

## Study Data

Study events and final edited texts are saved locally by the backend:

```text
writing-pattern-visualizer-v4/backend/study-data/logs/
writing-pattern-visualizer-v4/backend/study-data/revised-texts/
```

`study-data/` is ignored by Git and should not be committed. Before a real participant session, clear any smoke-test files from these folders.

Logged events use JSONL and pseudonymous participant IDs only. The study logger records meaningful interactions such as task start/finish, analytics expansion, highlighting, navigation, AI analysis completion, revision request/generated/failed/accepted/rejected, and an aggregate task revision summary.

The study log intentionally does not store keystrokes, mouse movement, screen recordings, names, emails, IP addresses, OpenAI prompts, API keys, full selected paragraph text, surrounding context, raw model responses, or stack traces.

To finish a task, use the `Finish Task` control and confirm. The backend saves the final text, writes the aggregate revision summary, and closes that task. Task 2 must be configured and started explicitly.

## Verification Commands

Frontend:

```bash
cd writing-pattern-visualizer-v4/frontend
npm run typecheck
npm test
npm run build
```

Backend:

```bash
cd writing-pattern-visualizer-v4/backend
source .venv/bin/activate
python -m unittest discover -s tests -v
python -m compileall -q app tests
```

## API Endpoints

- `GET /api/health`
- `POST /api/import/pdf`
- `POST /api/analytics/document`
- `POST /api/ai/analyze-paragraph`
- `POST /api/ai/suggest-revision`
- `POST /api/study/tasks/start`
- `POST /api/study/events`
- `POST /api/study/tasks/finish`

## Current Limitations

- Study texts X and Y are placeholders and should be replaced with final study material before evaluation.
- Study Mode does not include questionnaires, consent forms, demographic surveys, or interview tooling.
- PDF import supports text-based PDFs only; OCR and exact layout reconstruction remain out of scope.
- AI functionality is paragraph-scoped; no document-wide AI analysis or whole-document rewriting is included.
- AI revision suggestions are optional proposals and require explicit Accept before they modify the document.
