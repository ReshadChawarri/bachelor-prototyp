import type { ImportedPdfDocument } from "../types/document";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

interface ApiErrorBody {
  detail?: string;
}

export async function importPdf(file: File): Promise<ImportedPdfDocument> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/api/import/pdf`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }

  return response.json() as Promise<ImportedPdfDocument>;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body.detail) {
      return body.detail;
    }
  } catch {
    // Fall through to the generic message below.
  }

  return "PDF import failed. The current document was not changed.";
}
