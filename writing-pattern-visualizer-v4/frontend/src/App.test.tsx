import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { fetchStudyTaskStatus, finishStudyTask, logStudyEvent, startStudyTask } from "./api/study";
import { saveRemoteStudyDraft } from "./study/studyDraft";
import type { DocumentModel } from "./types/document";

const workspaceSpy = vi.hoisted(() => vi.fn());

vi.mock("./editor/DocumentWorkspace", () => ({
  DocumentWorkspace: (props: Record<string, unknown>) => {
    workspaceSpy(props);
    return (
      <div data-testid="workspace">
        <button
          type="button"
          onClick={() => (props.onStudyEvent as ((event: string, payload: Record<string, unknown>) => void) | undefined)?.(
            "analytics_section_expanded",
            { section: "paragraph_length" },
          )}
        >
          Expand Paragraph Length
        </button>
      </div>
    );
  },
}));

vi.mock("./analytics/useBackendWritingAnalytics", () => ({
  useBackendWritingAnalytics: () => ({ data: null, loading: false, error: null }),
}));

vi.mock("./api/pdfImport", () => ({
  importPdf: vi.fn(),
}));

vi.mock("./api/study", () => ({
  fetchStudyTaskStatus: vi.fn(),
  startStudyTask: vi.fn(),
  logStudyEvent: vi.fn(),
  finishStudyTask: vi.fn(),
}));

const mockedFetchStudyTaskStatus = vi.mocked(fetchStudyTaskStatus);
const mockedStartStudyTask = vi.mocked(startStudyTask);
const mockedFinishStudyTask = vi.mocked(finishStudyTask);
const mockedLogStudyEvent = vi.mocked(logStudyEvent);

const STUDY_TOKEN_A = "t_remoteTokenA123456789";
const STUDY_TOKEN_B = "t_remoteTokenB123456789";

describe("App Remote Study Mode", () => {
  beforeEach(() => {
    window.localStorage.clear();
    workspaceSpy.mockClear();
    mockedFetchStudyTaskStatus.mockResolvedValue({
      status: "unused",
      task: null,
      studyText: null,
      filename: null,
    });
    mockedStartStudyTask.mockResolvedValue({
      task: {
        token: STUDY_TOKEN_A,
        status: "active",
        condition: "A",
        documentId: "doc_remote_a",
        studyVersion: "1.0",
      },
      studyText: "Text X\n\n1 Introduction\n\nStudents inspect writing patterns.",
      filename: "text-x.txt",
    });
    mockedFinishStudyTask.mockResolvedValue({
      ok: true,
      status: "completed",
    });
    mockedLogStudyEvent.mockResolvedValue();
  });

  afterEach(() => {
    window.history.pushState({}, "", "/");
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("bypasses Study Mode during normal development", () => {
    render(<App />);

    expect(screen.getByTestId("workspace")).toBeInTheDocument();
    expect(workspaceSpy.mock.calls[workspaceSpy.mock.calls.length - 1]?.[0]).toMatchObject({
      aiFeaturesEnabled: true,
    });
    expect(mockedFetchStudyTaskStatus).not.toHaveBeenCalled();
    expect(screen.queryByText("Academic Text Revision Task")).not.toBeInTheDocument();
  });

  it("shows a neutral landing page for a valid unused remote task token", async () => {
    window.history.pushState({}, "", `/study/${STUDY_TOKEN_A}`);

    render(<App />);

    expect(await screen.findByRole("button", { name: "Start Task" })).toBeInTheDocument();
    expect(screen.getByText("Academic Text Revision Task")).toBeInTheDocument();
    expect(screen.getByText("Please wait until the researcher asks you to begin.")).toBeInTheDocument();
    expect(screen.queryByText(/Participant ID/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Condition/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Text X|Text Y/i)).not.toBeInTheDocument();
    expect(mockedFetchStudyTaskStatus).toHaveBeenCalledWith(STUDY_TOKEN_A);
  });

  it("starts Condition A from the token and exposes deterministic analytics only", async () => {
    window.history.pushState({}, "", `/study/${STUDY_TOKEN_A}`);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Start Task" }));

    await waitFor(() => expect(screen.getByTestId("workspace")).toBeInTheDocument());
    const props = workspaceSpy.mock.calls[workspaceSpy.mock.calls.length - 1]?.[0] as Record<string, unknown>;
    expect(props.aiFeaturesEnabled).toBe(false);
    expect(props.onStudyEvent).toEqual(expect.any(Function));
    expect(props.importRequest).toMatchObject({
      document: {
        filename: "text-x.txt",
      },
    });
    expect(mockedStartStudyTask).toHaveBeenCalledWith(STUDY_TOKEN_A);
    expect(screen.getByText(/Study task · Revision/)).toBeInTheDocument();
    expect(screen.queryByText(/P03|Condition A|Text X|Task 1/)).not.toBeInTheDocument();
  });

  it("starts Condition B with AI features enabled", async () => {
    window.history.pushState({}, "", `/study/${STUDY_TOKEN_B}`);
    mockedStartStudyTask.mockResolvedValueOnce({
      task: {
        token: STUDY_TOKEN_B,
        status: "active",
        condition: "B",
        documentId: "doc_remote_b",
        studyVersion: "1.0",
      },
      studyText: "Text Y\n\n1 Methodology\n\nStudents revise academic prose with support.",
      filename: "text-y.txt",
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Start Task" }));

    await waitFor(() => expect(screen.getByTestId("workspace")).toBeInTheDocument());
    const props = workspaceSpy.mock.calls[workspaceSpy.mock.calls.length - 1]?.[0] as Record<string, unknown>;
    expect(props.aiFeaturesEnabled).toBe(true);
    expect(mockedStartStudyTask).toHaveBeenCalledWith(STUDY_TOKEN_B);
  });

  it("resumes an active token without creating another start event", async () => {
    window.history.pushState({}, "", `/study/${STUDY_TOKEN_A}`);
    mockedFetchStudyTaskStatus.mockResolvedValueOnce({
      status: "active",
      task: {
        token: STUDY_TOKEN_A,
        status: "active",
        condition: "A",
        documentId: "doc_remote_a",
        studyVersion: "1.0",
      },
      studyText: "Text X\n\nResume this text.",
      filename: "text-x.txt",
    });

    render(<App />);

    await waitFor(() => expect(screen.getByTestId("workspace")).toBeInTheDocument());
    expect(mockedStartStudyTask).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Start Task" })).not.toBeInTheDocument();
  });

  it("restores an active token draft after refresh without exposing assignment metadata", async () => {
    window.history.pushState({}, "", `/study/${STUDY_TOKEN_A}`);
    const draftDocument: DocumentModel = {
      documentId: "doc_remote_a",
      revision: 5,
      title: "Academic Text Revision Task",
      paragraphs: [
        {
          id: "p_saved",
          type: "paragraph",
          blockType: "paragraph",
          order: 1,
          text: "Edited text restored after refresh.",
        },
      ],
    };
    saveRemoteStudyDraft(STUDY_TOKEN_A, {
      documentId: "doc_remote_a",
      title: "Academic Text Revision Task",
      document: draftDocument,
      initialBlocks: [{ kind: "paragraph", text: "Original study text." }],
    });
    mockedFetchStudyTaskStatus.mockResolvedValueOnce({
      status: "active",
      task: {
        token: STUDY_TOKEN_A,
        status: "active",
        condition: "A",
        documentId: "doc_remote_a",
        studyVersion: "1.0",
      },
      studyText: "Text X\n\nOriginal study text.",
      filename: "text-x.txt",
    });

    render(<App />);

    await waitFor(() => expect(screen.getByTestId("workspace")).toBeInTheDocument());
    const props = workspaceSpy.mock.calls[workspaceSpy.mock.calls.length - 1]?.[0] as Record<string, unknown>;
    expect(props.document).toMatchObject({
      documentId: "doc_remote_a",
      revision: 5,
    });
    expect(props.importRequest).toMatchObject({
      document: {
        blocks: [
          {
            paragraph_id: "p_saved",
            text: "Edited text restored after refresh.",
          },
        ],
      },
    });
    expect(screen.queryByText(/P03|Condition A|Text X/)).not.toBeInTheDocument();
  });

  it("shows completed tasks as closed and does not allow restart", async () => {
    window.history.pushState({}, "", `/study/${STUDY_TOKEN_A}`);
    mockedFetchStudyTaskStatus.mockResolvedValueOnce({
      status: "completed",
      task: null,
      studyText: null,
      filename: null,
    });

    render(<App />);

    expect(await screen.findByText("Task completed")).toBeInTheDocument();
    expect(screen.getByText("Please return to the researcher before continuing.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Task" })).not.toBeInTheDocument();
    expect(mockedStartStudyTask).not.toHaveBeenCalled();
  });

  it("shows invalid study links without revealing metadata", async () => {
    window.history.pushState({}, "", "/study/not-a-token");
    mockedFetchStudyTaskStatus.mockRejectedValueOnce(new Error("This study link is not valid."));

    render(<App />);

    expect(await screen.findByText("This study link is not valid.")).toBeInTheDocument();
    expect(screen.getByText("Please contact the researcher.")).toBeInTheDocument();
    expect(screen.queryByText(/P03|Condition A|Text X/)).not.toBeInTheDocument();
  });

  it("queues intentional analytics events through the study token", async () => {
    window.history.pushState({}, "", `/study/${STUDY_TOKEN_A}`);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Start Task" }));
    await user.click(await screen.findByRole("button", { name: "Expand Paragraph Length" }));

    await waitFor(() => expect(mockedLogStudyEvent).toHaveBeenCalledTimes(1));
    expect(mockedLogStudyEvent.mock.calls[0][0]).toBe(STUDY_TOKEN_A);
    expect(mockedLogStudyEvent.mock.calls[0][1]).toMatchObject({
      sequenceNumber: 2,
      event: "analytics_section_expanded",
      payload: {
        section: "paragraph_length",
      },
    });
    expect(mockedLogStudyEvent.mock.calls[0][1].eventId).toMatch(/^ev_/);
  });

  it("requires explicit finish confirmation and closes the token task", async () => {
    window.history.pushState({}, "", `/study/${STUDY_TOKEN_A}`);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Start Task" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Finish Task" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Finish Task" }));

    expect(screen.getByText("Finish this task?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(screen.getByText("Task completed")).toBeInTheDocument());
    expect(mockedFinishStudyTask).toHaveBeenCalledTimes(1);
    expect(mockedFinishStudyTask.mock.calls[0][0]).toBe(STUDY_TOKEN_A);
    expect(mockedFinishStudyTask.mock.calls[0][1]).toMatchObject({
      summarySequenceNumber: 2,
      finishedSequenceNumber: 3,
      summary: {
        changedParagraphCount: expect.any(Number),
      },
    });
    expect(mockedFinishStudyTask.mock.calls[0][1].summaryEventId).toMatch(/^ev_/);
    expect(mockedFinishStudyTask.mock.calls[0][1].finishedEventId).toMatch(/^ev_/);
  });
});
