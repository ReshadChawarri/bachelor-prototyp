import type { DocumentAnalyticsRequest, DocumentAnalyticsResponse } from "../types/backendAnalytics";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

interface ApiErrorBody {
  detail?: string;
}

export async function analyzeDocument(
  request: DocumentAnalyticsRequest,
  signal?: AbortSignal,
): Promise<DocumentAnalyticsResponse> {
  const response = await fetch(`${API_BASE_URL}/api/analytics/document`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }

  return response.json() as Promise<DocumentAnalyticsResponse>;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body.detail) {
      return body.detail;
    }
  } catch {
    // Fall through to the stable user-facing message.
  }

  return "Deterministic writing analytics are temporarily unavailable.";
}
