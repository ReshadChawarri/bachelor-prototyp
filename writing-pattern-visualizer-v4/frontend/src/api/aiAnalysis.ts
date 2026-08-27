import type {
  AnalyzeParagraphRequest,
  AnalyzeParagraphResponse,
  SuggestRevisionRequest,
  SuggestRevisionResponse,
} from "../types/aiAnalysis";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

interface ApiErrorBody {
  detail?: string;
}

export async function analyzeParagraph(
  request: AnalyzeParagraphRequest,
  signal?: AbortSignal,
): Promise<AnalyzeParagraphResponse> {
  const response = await fetch(`${API_BASE_URL}/api/ai/analyze-paragraph`, {
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

  return response.json() as Promise<AnalyzeParagraphResponse>;
}

export async function suggestRevision(
  request: SuggestRevisionRequest,
  signal?: AbortSignal,
): Promise<SuggestRevisionResponse> {
  const response = await fetch(`${API_BASE_URL}/api/ai/suggest-revision`, {
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

  return response.json() as Promise<SuggestRevisionResponse>;
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

  return "AI analysis is temporarily unavailable.";
}
