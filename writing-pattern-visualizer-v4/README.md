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
- Remote Study Mode v1.0 for counterbalanced within-subject evaluation tasks

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

For remote deployments where the frontend and backend are not served from the same origin, set a specific HTTPS origin list:

```text
CORS_ALLOWED_ORIGINS=https://your-study-frontend.example
```

Avoid `*` in production study deployments.

## Remote Study Mode v1.0

Normal development is bypassed unless the participant opens a tokenized study URL. Remote Study Mode uses opaque one-task links:

```text
http://localhost:5173/study/t_7F3kP91x...
```

Participants do not configure participant ID, condition, text, or task order. The browser receives only the active task token, assigned condition, document ID, study text, and task status. The backend resolves participant metadata server-side from the token for logging and final-text storage.

### Researcher Link Generation

Create two task links from the backend directory:

```bash
cd writing-pattern-visualizer-v4/backend
source .venv/bin/activate
python scripts/create_study_links.py P03 \
  --task1-condition A \
  --task1-text Y \
  --task2-condition B \
  --task2-text X \
  --base-url https://your-study-site.example
```

The script prints one opaque URL per task and stores private token-assignment files under the configured study-data directory. These assignment files contain participant/task metadata and live tokens, so do not commit or publish them.

Condition A includes the editor and deterministic Writing Analytics only. It hides AI controls and prevents AI analysis or revision requests from being triggered.

Condition B includes the same deterministic interface plus the currently implemented paragraph-level AI analysis and AI revision suggestions.

The fixed study texts live in:

```text
writing-pattern-visualizer-v4/study-materials/text-x.txt
writing-pattern-visualizer-v4/study-materials/text-y.txt
```

These are replaceable master files. Starting a task loads a fresh copy, so edits from one participant or task do not modify the master text.

### Participant Flow

Opening a valid unused link shows a minimal waiting page:

```text
Academic Text Revision Task
Please wait until the researcher asks you to begin.
```

`Start Task` marks the token active server-side and emits one `task_started` event. Refreshing an active task resumes it through the same token and restores the current editor draft from browser storage when available. Completed task tokens show only the neutral completion screen and cannot be restarted.

### Deployment Notes

Deploy the frontend over HTTPS and configure the web server/static host to fall back to `index.html` for `/study/<token>` routes. The FastAPI backend must be reachable through `VITE_API_BASE_URL` or same-origin routing, and `STUDY_DATA_DIR` must point to persistent server storage before participant sessions begin.

## Remote Study Data

Study events and final edited texts are stored server-side by the backend:

```text
writing-pattern-visualizer-v4/backend/study-data/logs/
writing-pattern-visualizer-v4/backend/study-data/revised-texts/
writing-pattern-visualizer-v4/backend/study-data/assignments/
```

`study-data/` is ignored by Git and should not be committed. For deployment, set `STUDY_DATA_DIR` to a persistent mounted directory that survives process restarts and redeployments. The repository does not contain platform-specific deployment configuration, so verify persistence on the selected host before running the study.

Logged events use JSONL and pseudonymous participant IDs only. The client sends an event ID, sequence number, event name, and sanitized payload to the backend; the backend attaches participant ID, session ID, condition, text ID, task order, study version, and timestamp based on the task token.

Logged event types:

```text
task_started
task_revision_summary
task_finished
analytics_section_expanded
transition_highlight_applied
repetition_highlight_applied
paragraph_navigation_used
structure_navigation_used
ai_analysis_completed
revision_requested
revision_generated
revision_failed
revision_accepted
revision_rejected
```

The study log intentionally does not store keystrokes, mouse movement, screen recordings, names, emails, IP addresses, OpenAI prompts, API keys, full selected paragraph text, surrounding context, raw model responses, or stack traces. Final revised texts are saved separately from the JSONL interaction log.

To finish a task, use the `Finish Task` control and confirm. The backend saves the final text, writes the aggregate revision summary, emits `task_finished`, and closes that token. The researcher sends Task 2 as a separate URL.

### Export And Backup

Export collected study data from the backend host:

```bash
cd writing-pattern-visualizer-v4/backend
source .venv/bin/activate
python scripts/export_study_data.py
```

This creates a zip archive under `study-data/exports/` unless `--output` is provided. During the study, create a backup after each study day by copying or exporting the persistent `STUDY_DATA_DIR`. Do not upload participant data to GitHub.

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
- `GET /api/study/tasks/{token}`
- `POST /api/study/tasks/{token}/start`
- `POST /api/study/tasks/{token}/events`
- `POST /api/study/tasks/{token}/finish`

## Current Limitations

- Study texts X and Y are placeholders and should be replaced with final study material before evaluation.
- Remote Study Mode does not include questionnaires, consent forms, demographic surveys, or interview tooling.
- The default backend `study-data/` path is local. Set `STUDY_DATA_DIR` to a verified persistent storage path before a deployed remote study.
- PDF import supports text-based PDFs only; OCR and exact layout reconstruction remain out of scope.
- AI functionality is paragraph-scoped; no document-wide AI analysis or whole-document rewriting is included.
- AI revision suggestions are optional proposals and require explicit Accept before they modify the document.
