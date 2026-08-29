import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logStudyEvent } from "../api/study";
import type { RemoteStudyClientTask } from "./types";
import { useStudyLogger } from "./useStudyLogger";

vi.mock("../api/study", () => ({
  logStudyEvent: vi.fn(),
}));

const mockedLogStudyEvent = vi.mocked(logStudyEvent);

const TASK: RemoteStudyClientTask = {
  token: "t_remoteToken123456789",
  status: "active",
  condition: "B",
  documentId: "doc_remote",
  studyVersion: "1.0",
};

describe("useStudyLogger", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockedLogStudyEvent.mockResolvedValue();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("sends queued events with a token, event ID, and monotonic sequence number", async () => {
    const { result } = renderHook(() => useStudyLogger(TASK));

    act(() => {
      result.current.logEvent("analytics_section_expanded", { section: "paragraph_length" });
    });

    await waitFor(() => expect(mockedLogStudyEvent).toHaveBeenCalledTimes(1));
    expect(mockedLogStudyEvent.mock.calls[0][0]).toBe(TASK.token);
    expect(mockedLogStudyEvent.mock.calls[0][1]).toMatchObject({
      sequenceNumber: 2,
      event: "analytics_section_expanded",
      payload: {
        section: "paragraph_length",
      },
    });
    expect(mockedLogStudyEvent.mock.calls[0][1].eventId).toMatch(/^ev_/);
  });

  it("keeps failed events queued and retries them idempotently", async () => {
    mockedLogStudyEvent.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useStudyLogger(TASK));

    act(() => {
      result.current.logEvent("repetition_highlight_applied", { term: "privacy" });
    });

    await waitFor(() => expect(result.current.warning).toContain("Study logging encountered"));
    expect(mockedLogStudyEvent).toHaveBeenCalledTimes(1);
    const firstEventId = mockedLogStudyEvent.mock.calls[0][1].eventId;

    mockedLogStudyEvent.mockResolvedValueOnce();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => expect(mockedLogStudyEvent).toHaveBeenCalledTimes(2));
    expect(mockedLogStudyEvent.mock.calls[1][1].eventId).toBe(firstEventId);
    await waitFor(() => expect(result.current.warning).toBeNull());
  });

  it("reserves finish sequence numbers after queued interaction events", async () => {
    const { result } = renderHook(() => useStudyLogger(TASK));

    act(() => {
      result.current.logEvent("structure_navigation_used", { headingId: "h_abc" });
    });
    await waitFor(() => expect(mockedLogStudyEvent).toHaveBeenCalledTimes(1));

    expect(result.current.reserveSequenceNumber()).toBe(3);
    expect(result.current.reserveSequenceNumber()).toBe(4);
  });
});
