from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .document_analytics import (
    DocumentAnalyticsRequest,
    DocumentAnalyticsResponse,
    analyze_document,
)
from .pdf_import import PdfImportError, PdfImportResponse, extract_pdf_content


class HealthResponse(BaseModel):
    status: str
    service: str
    phase: str


app = FastAPI(
    title="Writing Pattern Visualizer V4 API",
    version="0.1.0",
    description="Phase 2 backend foundation for the V4 writing workspace and editable PDF import.",
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
    return HealthResponse(
        status="ok",
        service="writing-pattern-visualizer-v4-backend",
        phase="phase-2",
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
