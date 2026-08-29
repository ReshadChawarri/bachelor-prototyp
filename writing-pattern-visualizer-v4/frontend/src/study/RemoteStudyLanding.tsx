interface RemoteStudyLandingProps {
  loading?: boolean;
  error?: string | null;
  onStart: () => void;
}

export function RemoteStudyLanding({ loading = false, error, onStart }: RemoteStudyLandingProps) {
  return (
    <main className="study-setup-shell">
      <section className="study-setup-panel" aria-label="Academic text revision task">
        <p className="panel-kicker">Study task</p>
        <h1>Academic Text Revision Task</h1>
        <p className="study-setup-description">Please wait until the researcher asks you to begin.</p>
        {error && <p className="study-error">{error}</p>}
        <button className="study-start-button" type="button" onClick={onStart} disabled={loading}>
          {loading ? "Starting task..." : "Start Task"}
        </button>
      </section>
    </main>
  );
}

export function RemoteStudyLoading() {
  return (
    <main className="study-setup-shell">
      <section className="study-setup-panel" aria-label="Loading study task">
        <p className="panel-kicker">Study task</p>
        <h1>Academic Text Revision Task</h1>
        <p className="study-setup-description">Loading study task...</p>
      </section>
    </main>
  );
}

export function RemoteStudyInvalidLink({ message = "This study link is not valid. Please contact the researcher." }) {
  const isDefaultMessage = message === "This study link is not valid. Please contact the researcher.";

  return (
    <main className="study-setup-shell">
      <section className="study-setup-panel" aria-label="Invalid study link">
        <p className="panel-kicker">Study task</p>
        <h1>Academic Text Revision Task</h1>
        {isDefaultMessage ? (
          <>
            <p className="study-setup-description">This study link is not valid.</p>
            <p className="study-setup-description">Please contact the researcher.</p>
          </>
        ) : (
          <p className="study-setup-description">{message}</p>
        )}
      </section>
    </main>
  );
}

export function RemoteStudyCompleted() {
  return (
    <main className="study-setup-shell">
      <section className="study-setup-panel" aria-label="Study task completed">
        <p className="panel-kicker">Study task</p>
        <h1>Task completed</h1>
        <p className="study-setup-description">Please return to the researcher before continuing.</p>
      </section>
    </main>
  );
}
