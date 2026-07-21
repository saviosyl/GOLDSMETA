import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { VerifiedDataMeta } from "../components/v5/VerifiedDataMeta";

const PAGE_SIZE = 12;
const MAX_FRAMES = 60;

type Frame = {
  barTime: string;
  analysisSummary: string | null;
  candidateStatus: string | null;
  planStatus: string | null;
  lifecycleNote: string | null;
  result: string | null;
};

/** Educational candle-by-candle replay — windowed to cap memory. */
export function ReplayPage() {
  const { api } = useAuth();
  const [frames, setFrames] = useState<Frame[]>([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [disclaimer, setDisclaimer] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    const ac = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const session = await api.v5Replay("LIVE", MAX_FRAMES);
        if (ac.signal.aborted || id !== requestId.current) return;
        const next = (session.frames ?? []).slice(0, MAX_FRAMES);
        setFrames(next);
        setDisclaimer(String(session.disclaimer ?? ""));
        setIndex(0);
        setPage(0);
        setError(null);
      } catch (err) {
        if (ac.signal.aborted || id !== requestId.current) return;
        setError(err instanceof Error ? err.message : "Replay unavailable");
      } finally {
        if (!ac.signal.aborted && id === requestId.current) setLoading(false);
      }
    })();
    return () => {
      ac.abort();
    };
  }, []);

  const pageCount = Math.max(1, Math.ceil(frames.length / PAGE_SIZE));
  const windowFrames = useMemo(() => {
    const start = page * PAGE_SIZE;
    return frames.slice(start, start + PAGE_SIZE).map((f, i) => ({
      ...f,
      absoluteIndex: start + i
    }));
  }, [frames, page]);

  const frame = frames[index];

  return (
    <div className="v5-page" data-testid="replay-page">
      <h1 className="brand" style={{ fontSize: "1.45rem" }}>
        Replay mode
      </h1>
      <p className="subtitle">Educational only — step through verified shadow history.</p>
      <VerifiedDataMeta
        symbol="XAUUSD"
        environment="LIVE"
        mode="SHADOW"
        freshness={frames.length ? "SHADOW" : "UNAVAILABLE"}
        sources={["V4 shadow analyses", "V4 shadow plans"]}
        missingWarning={
          !loading && !frames.length && !error
            ? "Insufficient verified data for replay."
            : null
        }
      />
      {loading && (
        <div className="card" role="status" data-testid="replay-loading">
          Loading replay…
        </div>
      )}
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {!frames.length && !error && !loading && (
        <p className="muted" data-testid="replay-empty">
          Insufficient verified data for replay.
        </p>
      )}
      {frame && (
        <section className="card v5-glass" data-testid="replay-frame">
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
              aria-label="Previous candle"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              Prev
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={index >= frames.length - 1}
              aria-label="Next candle"
              onClick={() => setIndex((i) => Math.min(frames.length - 1, i + 1))}
            >
              Next candle
            </button>
          </div>
        </section>
      )}

      {frames.length > 0 && (
        <section className="card" data-testid="replay-window">
          <h2 className="section-title">Timeline window</h2>
          <p className="muted">
            Showing {PAGE_SIZE} of {frames.length} bars (page {page + 1}/{pageCount}) to cap memory.
          </p>
          <ul className="list compact replay-window-list" data-testid="replay-window-list">
            {windowFrames.map((f) => (
              <li key={`${f.absoluteIndex}-${f.barTime}`}>
                <button
                  type="button"
                  className={`chip ${f.absoluteIndex === index ? "active" : ""}`}
                  onClick={() => setIndex(f.absoluteIndex)}
                >
                  #{f.absoluteIndex + 1} {f.barTime.slice(0, 16)}
                </button>
              </li>
            ))}
          </ul>
          <div className="btn-row">
            <button
              type="button"
              className="btn"
              disabled={page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Earlier
            </button>
            <button
              type="button"
              className="btn"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              Later
            </button>
          </div>
        </section>
      )}
      <p className="muted">{disclaimer}</p>
    </div>
  );
}
