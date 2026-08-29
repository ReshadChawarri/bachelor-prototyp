import { useCallback, useEffect, useRef, useState } from "react";
import { logStudyEvent } from "../api/study";
import type { RemoteStudyClientTask, StudyEventLogger, StudyEventPayload, StudyEventRequest, StudyEventType } from "./types";

const EVENT_QUEUE_KEY_PREFIX = "wpv.remoteStudy.eventQueue.";
const EVENT_SEQUENCE_KEY_PREFIX = "wpv.remoteStudy.sequence.";
const RETRY_INTERVAL_MS = 5000;

export function useStudyLogger(task: RemoteStudyClientTask | null) {
  const [warning, setWarning] = useState<string | null>(null);
  const sequenceNumber = useRef(1);
  const queue = useRef<StudyEventRequest[]>([]);
  const processingPromise = useRef<Promise<void> | null>(null);

  const persistQueue = useCallback(() => {
    if (!task) {
      return;
    }
    window.localStorage.setItem(queueStorageKey(task.token), JSON.stringify(queue.current));
  }, [task]);

  const persistSequence = useCallback(() => {
    if (!task) {
      return;
    }
    window.localStorage.setItem(sequenceStorageKey(task.token), String(sequenceNumber.current));
  }, [task]);

  const processQueue = useCallback(
    async (strict = false) => {
      if (!task) {
        return;
      }

      if (processingPromise.current) {
        if (strict) {
          await processingPromise.current;
          if (queue.current.length > 0) {
            return processQueue(true);
          }
        }
        return;
      }

      let stoppedAfterFailure = false;
      const run = (async () => {
        while (queue.current.length > 0) {
          const event = queue.current[0];
          try {
            await logStudyEvent(task.token, event);
            queue.current = queue.current.slice(1);
            persistQueue();
            setWarning(null);
          } catch (error) {
            setWarning("Study logging encountered a network problem. The task can continue.");
            if (strict) {
              throw error;
            }
            stoppedAfterFailure = true;
            return;
          }
        }
      })();

      processingPromise.current = run;
      try {
        await run;
      } finally {
        processingPromise.current = null;
        if (!strict && !stoppedAfterFailure && queue.current.length > 0) {
          void processQueue();
        }
      }
    },
    [persistQueue, task],
  );

  useEffect(() => {
    if (!task) {
      queue.current = [];
      sequenceNumber.current = 1;
      setWarning(null);
      return;
    }

    queue.current = loadQueuedEvents(task.token);
    sequenceNumber.current = Math.max(loadSequenceNumber(task.token), ...queue.current.map((event) => event.sequenceNumber));
    persistSequence();
    setWarning(null);
    void processQueue();
  }, [persistSequence, processQueue, task]);

  useEffect(() => {
    if (!task) {
      return;
    }

    const retry = () => {
      void processQueue();
    };
    const interval = window.setInterval(retry, RETRY_INTERVAL_MS);
    window.addEventListener("online", retry);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", retry);
    };
  }, [processQueue, task]);

  const logEvent: StudyEventLogger = useCallback(
    (event: StudyEventType, payload: StudyEventPayload = {}) => {
      if (!task) {
        return;
      }
      sequenceNumber.current += 1;
      persistSequence();
      queue.current = [
        ...queue.current,
        {
          eventId: createStudyEventId(),
          sequenceNumber: sequenceNumber.current,
          event,
          payload,
        },
      ];
      persistQueue();
      void processQueue();
    },
    [persistQueue, persistSequence, processQueue, task],
  );

  const flushEvents = useCallback(async () => {
    await processQueue(true);
  }, [processQueue]);

  const reserveSequenceNumber = useCallback(() => {
    sequenceNumber.current += 1;
    persistSequence();
    return sequenceNumber.current;
  }, [persistSequence]);

  const clearStoredState = useCallback(() => {
    if (!task) {
      return;
    }
    queue.current = [];
    sequenceNumber.current = 1;
    window.localStorage.removeItem(queueStorageKey(task.token));
    window.localStorage.removeItem(sequenceStorageKey(task.token));
    setWarning(null);
  }, [task]);

  return {
    logEvent,
    warning,
    clearWarning: () => setWarning(null),
    reserveSequenceNumber,
    flushEvents,
    clearStoredState,
  };
}

export function createStudyEventId(): string {
  if (typeof window.crypto?.randomUUID === "function") {
    return `ev_${window.crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function loadQueuedEvents(token: string): StudyEventRequest[] {
  const raw = window.localStorage.getItem(queueStorageKey(token));
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isQueuedStudyEvent) : [];
  } catch {
    return [];
  }
}

function loadSequenceNumber(token: string): number {
  const raw = window.localStorage.getItem(sequenceStorageKey(token));
  const parsed = raw ? Number.parseInt(raw, 10) : 1;
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

function isQueuedStudyEvent(value: unknown): value is StudyEventRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<StudyEventRequest>;
  return (
    typeof candidate.eventId === "string" &&
    typeof candidate.sequenceNumber === "number" &&
    typeof candidate.event === "string" &&
    typeof candidate.payload === "object" &&
    candidate.payload !== null
  );
}

function queueStorageKey(token: string): string {
  return `${EVENT_QUEUE_KEY_PREFIX}${token}`;
}

function sequenceStorageKey(token: string): string {
  return `${EVENT_SEQUENCE_KEY_PREFIX}${token}`;
}
