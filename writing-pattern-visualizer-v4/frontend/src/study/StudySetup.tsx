import { useState } from "react";
import type { StudyCondition, StudyTaskConfig, StudyTaskFinishResponse, StudyTaskOrder, StudyTextId } from "./types";

interface StudySetupProps {
  completedTask?: StudyTaskFinishResponse | null;
  error?: string | null;
  loading?: boolean;
  onStart: (config: StudyTaskConfig) => void;
}

export function StudySetup({ completedTask, error, loading = false, onStart }: StudySetupProps) {
  const [participantId, setParticipantId] = useState("P01");
  const [condition, setCondition] = useState<StudyCondition>("A");
  const [textId, setTextId] = useState<StudyTextId>("X");
  const [taskOrder, setTaskOrder] = useState<StudyTaskOrder>(1);
  const participantIdValid = /^P\d{2,}$/.test(participantId);

  return (
    <main className="study-setup-shell">
      <section className="study-setup-panel" aria-label="Study Mode setup">
        <p className="panel-kicker">Study Mode v1.0</p>
        <h1>Writing Pattern Visualizer</h1>
        <p className="study-setup-description">
          Configure the next counterbalanced writing task before handing the workspace to the participant.
        </p>

        {completedTask && (
          <div className="study-complete-note">
            <strong>Task complete.</strong>
            <span>The final text and interaction log were saved locally.</span>
          </div>
        )}

        <form
          className="study-setup-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!participantIdValid || loading) {
              return;
            }
            onStart({
              participantId,
              condition,
              textId,
              taskOrder,
            });
          }}
        >
          <label className="study-field" htmlFor="study-participant-id">
            <span>Participant ID</span>
            <input
              id="study-participant-id"
              value={participantId}
              onChange={(event) => setParticipantId(event.currentTarget.value.toUpperCase())}
              aria-invalid={!participantIdValid}
              placeholder="P03"
            />
            {!participantIdValid && <small>Use P01, P02, P03, ...</small>}
          </label>

          <fieldset className="study-choice-group">
            <legend>Condition</legend>
            <label>
              <input
                type="radio"
                name="condition"
                value="A"
                checked={condition === "A"}
                onChange={() => setCondition("A")}
              />
              A - Writing Analytics
            </label>
            <label>
              <input
                type="radio"
                name="condition"
                value="B"
                checked={condition === "B"}
                onChange={() => setCondition("B")}
              />
              B - Writing Analytics + AI
            </label>
          </fieldset>

          <fieldset className="study-choice-group">
            <legend>Study Text</legend>
            <label>
              <input type="radio" name="text" value="X" checked={textId === "X"} onChange={() => setTextId("X")} />
              X
            </label>
            <label>
              <input type="radio" name="text" value="Y" checked={textId === "Y"} onChange={() => setTextId("Y")} />
              Y
            </label>
          </fieldset>

          <fieldset className="study-choice-group">
            <legend>Task order</legend>
            <label>
              <input
                type="radio"
                name="taskOrder"
                value="1"
                checked={taskOrder === 1}
                onChange={() => setTaskOrder(1)}
              />
              1
            </label>
            <label>
              <input
                type="radio"
                name="taskOrder"
                value="2"
                checked={taskOrder === 2}
                onChange={() => setTaskOrder(2)}
              />
              2
            </label>
          </fieldset>

          <div className="study-setup-summary">
            {participantIdValid ? participantId : "Participant"} · Condition {condition} · Text {textId} · Task{" "}
            {taskOrder}
          </div>

          {error && <p className="study-error">{error}</p>}

          <button className="study-start-button" type="submit" disabled={!participantIdValid || loading}>
            {loading ? "Starting task..." : "Start Task"}
          </button>
        </form>
      </section>
    </main>
  );
}
