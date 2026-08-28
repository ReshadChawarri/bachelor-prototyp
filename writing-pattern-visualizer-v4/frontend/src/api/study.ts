import type {
  StudyEventRequest,
  StudyTaskConfig,
  StudyTaskFinishRequest,
  StudyTaskFinishResponse,
  StudyTaskStartResponse,
} from "../study/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

interface ApiErrorBody {
  detail?: string;
}

export async function startStudyTask(config: StudyTaskConfig): Promise<StudyTaskStartResponse> {
  const response = await fetch(`${API_BASE_URL}/api/study/tasks/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    throw new Error(await errorMessage(response, "Study task could not be started."));
  }

  return response.json() as Promise<StudyTaskStartResponse>;
}

export async function logStudyEvent(request: StudyEventRequest): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/study/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(await errorMessage(response, "Study event could not be saved."));
  }
}

export async function finishStudyTask(request: StudyTaskFinishRequest): Promise<StudyTaskFinishResponse> {
  const response = await fetch(`${API_BASE_URL}/api/study/tasks/finish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(await errorMessage(response, "Study task could not be finished."));
  }

  return response.json() as Promise<StudyTaskFinishResponse>;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body.detail) {
      return body.detail;
    }
  } catch {
    // Fall through to the stable user-facing message.
  }

  return fallback;
}
