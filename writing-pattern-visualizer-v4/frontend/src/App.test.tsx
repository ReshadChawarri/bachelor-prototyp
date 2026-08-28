import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { startStudyTask, finishStudyTask, logStudyEvent } from "./api/study";

const workspaceSpy = vi.hoisted(() => vi.fn());

vi.mock("./editor/DocumentWorkspace", () => ({
  DocumentWorkspace: (props: Record<string, unknown>) => {
    workspaceSpy(props);
    return <div data-testid="workspace">Workspace</div>;
  },
}));

vi.mock("./analytics/useBackendWritingAnalytics", () => ({
  useBackendWritingAnalytics: () => ({ data: null, loading: false, error: null }),
}));

vi.mock("./api/pdfImport", () => ({
  importPdf: vi.fn(),
}));

vi.mock("./api/study", () => ({
  startStudyTask: vi.fn(),
  logStudyEvent: vi.fn(),
  finishStudyTask: vi.fn(),
}));

const mockedStartStudyTask = vi.mocked(startStudyTask);
const mockedFinishStudyTask = vi.mocked(finishStudyTask);
const mockedLogStudyEvent = vi.mocked(logStudyEvent);

describe("App Study Mode", () => {
  beforeEach(() => {
    workspaceSpy.mockClear();
    mockedStartStudyTask.mockImplementation(async (config) => ({
      task: {
        ...config,
        sessionId: `S-${config.participantId}-20260903-140501`,
        studyVersion: "1.0",
      },
      studyText: "Text X\n\n1 Introduction\n\nStudents inspect writing patterns.",
      filename: config.textId === "X" ? "text-x.txt" : "text-y.txt",
    }));
    mockedFinishStudyTask.mockResolvedValue({
      ok: true,
      finalTextPath: "/tmp/final.txt",
      logPath: "/tmp/events.jsonl",
    });
    mockedLogStudyEvent.mockResolvedValue();
  });

  afterEach(() => {
    window.history.pushState({}, "", "/");
    vi.clearAllMocks();
  });

  it("bypasses Study Mode during normal development", () => {
    render(<App />);

    expect(screen.getByTestId("workspace")).toBeInTheDocument();
    expect(workspaceSpy.mock.calls[workspaceSpy.mock.calls.length - 1]?.[0]).toMatchObject({
      aiFeaturesEnabled: true,
    });
    expect(screen.queryByLabelText("Study Mode setup")).not.toBeInTheDocument();
  });

  it("starts Condition A with deterministic analytics only", async () => {
    window.history.pushState({}, "", "/?study=1");
    const user = userEvent.setup();
    render(<App />);

    await user.clear(screen.getByLabelText(/Participant ID/));
    await user.type(screen.getByLabelText(/Participant ID/), "P03");
    await user.click(screen.getByLabelText("A - Writing Analytics"));
    await user.click(screen.getByLabelText("X"));
    await user.click(screen.getByLabelText("1"));
    await user.click(screen.getByRole("button", { name: "Start Task" }));

    await waitFor(() => expect(screen.getByTestId("workspace")).toBeInTheDocument());
    const props = workspaceSpy.mock.calls[workspaceSpy.mock.calls.length - 1]?.[0] as Record<string, unknown>;
    expect(props.aiFeaturesEnabled).toBe(false);
    expect(props.onStudyEvent).toEqual(expect.any(Function));
    expect(props.importRequest).toMatchObject({
      document: {
        filename: "text-x.txt",
      },
    });
    expect(mockedStartStudyTask).toHaveBeenCalledWith({
      participantId: "P03",
      condition: "A",
      textId: "X",
      taskOrder: 1,
    });
  });

  it("starts Condition B with AI features enabled", async () => {
    window.history.pushState({}, "", "/?study=1");
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByLabelText("B - Writing Analytics + AI"));
    await user.click(screen.getByLabelText("Y"));
    await user.click(screen.getByLabelText("2"));
    await user.click(screen.getByRole("button", { name: "Start Task" }));

    await waitFor(() => expect(screen.getByTestId("workspace")).toBeInTheDocument());
    const props = workspaceSpy.mock.calls[workspaceSpy.mock.calls.length - 1]?.[0] as Record<string, unknown>;
    expect(props.aiFeaturesEnabled).toBe(true);
    expect(mockedStartStudyTask).toHaveBeenCalledWith({
      participantId: "P01",
      condition: "B",
      textId: "Y",
      taskOrder: 2,
    });
  });

  it("requires explicit finish confirmation and saves the task", async () => {
    window.history.pushState({}, "", "/?study=1");
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Start Task" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Finish Task" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Finish Task" }));

    expect(screen.getByText("Finish this study task?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(screen.getByLabelText("Study Mode setup")).toBeInTheDocument());
    expect(mockedFinishStudyTask).toHaveBeenCalledTimes(1);
    expect(mockedFinishStudyTask.mock.calls[0][0]).toMatchObject({
      summarySequenceNumber: 2,
      finishedSequenceNumber: 3,
      summary: {
        changedParagraphCount: expect.any(Number),
      },
    });
  });
});
