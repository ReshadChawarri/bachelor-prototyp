from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .config import get_settings
from .document_analytics import (
    DocumentAnalyticsRequest,
    DocumentAnalyticsResponse,
    analyze_document,
)
from .paragraph_ai_analysis import (
    ParagraphAIAnalysisError,
    ParagraphAIAnalysisService,
    ParagraphAnalysisRequest,
    ParagraphAnalysisResponse,
)
from .paragraph_revision import (
    ParagraphRevisionRequest,
    ParagraphRevisionResponse,
    ParagraphRevisionService,
)
from .pdf_import import PdfImportError, PdfImportResponse, extract_pdf_content
from .study import (
    StudyDataError,
    StudyEventRequest,
    StudyEventResponse,
    StudyTaskConfig,
    StudyTaskFinishRequest,
    StudyTaskFinishResponse,
    StudyTaskStartResponse,
    finish_study_task,
    log_study_event,
    start_study_task,
)


class HealthResponse(BaseModel):
    status: str
    service: str
    phase: str
    aiConfigured: bool
    openaiModel: str


app = FastAPI(
    title="Writing Pattern Visualizer V4 API",
    version="0.1.0",
    description="Backend for the V4 writing workspace, deterministic analytics, paragraph AI support, and Study Mode.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(
        status="ok",
        service="writing-pattern-visualizer-v4-backend",
        phase="study-mode-v1.0",
        aiConfigured=settings.ai_configured,
        openaiModel=settings.openai_model,
    )


@app.post("/api/import/pdf", response_model=PdfImportResponse)
async def import_pdf(file: UploadFile = File(...)) -> PdfImportResponse:
    filename = file.filename or "uploaded.pdf"
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Upload a valid .pdf file.")

    raw_pdf = await file.read()
    try:
        return extract_pdf_content(raw_pdf, filename)
    except PdfImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/analytics/document", response_model=DocumentAnalyticsResponse)
def document_analytics(request: DocumentAnalyticsRequest) -> DocumentAnalyticsResponse:
    return analyze_document(request)


@app.post("/api/ai/analyze-paragraph", response_model=ParagraphAnalysisResponse)
def analyze_paragraph(request: ParagraphAnalysisRequest) -> ParagraphAnalysisResponse:
    service = getattr(app.state, "paragraph_ai_analysis_service", None)
    if service is None:
        service = ParagraphAIAnalysisService()

    try:
        return service.analyze(request)
    except ParagraphAIAnalysisError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.user_message) from exc


@app.post("/api/ai/suggest-revision", response_model=ParagraphRevisionResponse)
def suggest_revision(request: ParagraphRevisionRequest) -> ParagraphRevisionResponse:
    service = getattr(app.state, "paragraph_revision_service", None)
    if service is None:
        service = ParagraphRevisionService()

    try:
        return service.suggest_revision(request)
    except ParagraphAIAnalysisError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.user_message) from exc


@app.post("/api/study/tasks/start", response_model=StudyTaskStartResponse)
def study_task_start(request: StudyTaskConfig) -> StudyTaskStartResponse:
    try:
        return start_study_task(request)
    except StudyDataError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/study/events", response_model=StudyEventResponse)
def study_event(request: StudyEventRequest) -> StudyEventResponse:
    try:
        return log_study_event(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/study/tasks/finish", response_model=StudyTaskFinishResponse)
def study_task_finish(request: StudyTaskFinishRequest) -> StudyTaskFinishResponse:
    try:
        return finish_study_task(request)
    except StudyDataError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
