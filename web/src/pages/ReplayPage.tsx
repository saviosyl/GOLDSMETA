import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";

/** Educational candle-by-candle replay of stored V4 shadow history. */
export function ReplayPage() {
  const { api } = useAuth();
  const [frames, setFrames] = useState<
    Array<{
      barTime: string;
      analysisSummary: string | null;
      candidateStatus: string | null;
      planStatus: string | null;
      lifecycleNote: string | null;
      result: string | null;
    }>
  >([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [disclaimer, setDisclaimer] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const session = await api.v5Replay("LIVE", 60);
        setFrames(session.frames ?? []);
        setDisclaimer(String(session.disclaimer ?? ""));
        setIndex(0);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Replay unavailable");
      }
    })();
  }, [api]);

  const frame = frames[index];

  return (
    <div className="v5-page" data-testid="replay-page">
      <h1 className="brand" style={{ fontSize: "1.45rem" }}>
        Replay mode
      </h1>
      <p className="subtitle">Educational only — step through verified shadow history.</p>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {!frames.length && !error && <p className="muted">Insufficient verified data for replay.</p>}
      {frame && (
        <section className="card v5-glass">
          <div className="price-row">
            <span>Bar</span>
            <strong>
              {index + 1} / {frames.length}
            </strong>
          </div>
          <div className="metric">
            <span className="label">Time</span>
            <span className="value">{frame.barTime}</span>
          </div>
          <p>
            <strong>Analysis</strong>
            <br />
            {frame.analysisSummary ?? "—"}
          </p>
          <p>
            <strong>Candidate</strong>
            <br />
            {frame.candidateStatus ?? "—"}
          </p>
          <p>
            <strong>Shadow plan</strong>
            <br />
            {frame.planStatus ?? "—"}
          </p>
          <p>
            <strong>Lifecycle</strong>
            <br />
            {frame.lifecycleNote ?? "—"}
          </p>
          <p>
            <strong>Result</strong>
            <br />
            {frame.result ?? "—"}
          </p>
          <div className="btn-row">
            <button
              type="button"
              className="btn"
              disabled={index <= 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              Prev
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={index >= frames.length - 1}
              onClick={() => setIndex((i) => Math.min(frames.length - 1, i + 1))}
            >
              Next candle
            </button>
          </div>
        </section>
      )}
      <p className="muted">{disclaimer}</p>
    </div>
  );
}
