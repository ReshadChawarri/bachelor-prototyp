import { useCallback, useEffect, useRef, useState } from "react";
import { logStudyEvent } from "../api/study";
import type { StudyEventLogger, StudyEventPayload, StudyEventType, StudyTaskContext } from "./types";

export function useStudyLogger(task: StudyTaskContext | null) {
  const [warning, setWarning] = useState<string | null>(null);
  const sequenceNumber = useRef(1);
  const pendingWrites = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    sequenceNumber.current = 1;
    pendingWrites.current = Promise.resolve();
    setWarning(null);
  }, [task?.sessionId]);

  const logEvent: StudyEventLogger = useCallback(
    (event: StudyEventType, payload: StudyEventPayload = {}) => {
      if (!task) {
        return;
      }
      sequenceNumber.current += 1;
      const nextSequenceNumber = sequenceNumber.current;
      pendingWrites.current = pendingWrites.current
        .catch(() => undefined)
        .then(() =>
          logStudyEvent({
            task,
            sequenceNumber: nextSequenceNumber,
            event,
            payload,
          }),
        )
        .catch(() => {
          setWarning("Study logging encountered a problem. The writing task can continue.");
        });
    },
    [task],
  );

  const flushEvents = useCallback(async () => {
    await pendingWrites.current;
  }, []);

  const reserveSequenceNumber = useCallback(() => {
    sequenceNumber.current += 1;
    return sequenceNumber.current;
  }, []);

  return {
    logEvent,
    warning,
    clearWarning: () => setWarning(null),
    reserveSequenceNumber,
    flushEvents,
  };
}
