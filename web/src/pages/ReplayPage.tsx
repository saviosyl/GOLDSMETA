import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { VerifiedDataMeta } from "../components/v5/VerifiedDataMeta";
import { formatUserTimestamp } from "../lib/plainLanguage";
import {
  EmptyState,
  PageHeader,
  SectionCard
} from "../components/ui/primitives";

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setIndex((i) => Math.min(frames.length - 1, i + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [frames.length]);

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
    <div data-testid="replay-page">
      <PageHeader title="Replay" environment="LIVE" freshness="SHADOW" />
      <p className="gm-meta" style={{ marginTop: -8, marginBottom: 16 }}>
        Educational only — step through verified shadow history. Shortcuts: ← →
      </p>
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
        <SectionCard>
          <p className="gm-meta" role="status" data-testid="replay-loading">
            Loading replay…
          </p>
        </SectionCard>
      )}
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {!frames.length && !error && !loading && (
        <SectionCard>
          <EmptyState
            title="Insufficient verified data for replay."
            body="Replay appears when enough shadow history exists."
          />
          <p className="gm-meta" data-testid="replay-empty">
            Insufficient verified data for replay.
          </p>
        </SectionCard>
      )}

      {frame && (
        <div className="gm-two-col gm-replay-layout" data-testid="replay-frame">
          <SectionCard title="Candle navigation">
            <div className="price-row">
              <span>Bar</span>
              <strong>
                {index + 1} / {frames.length}
              </strong>
            </div>
            <div className="gm-metric" style={{ marginTop: 12 }}>
              <span className="gm-label">Time</span>
              <span className="gm-metric-value">{formatUserTimestamp(frame.barTime)}</span>
            </div>
            <div className="btn-row" style={{ marginTop: 16 }}>
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
          </SectionCard>

          <SectionCard title="Analysis">
            <p>
              <strong>Summary</strong>
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
          </SectionCard>

          <SectionCard title="Lifecycle">
            <p>
              <strong>Note</strong>
              <br />
              {frame.lifecycleNote ?? "—"}
            </p>
            <p>
              <strong>Result</strong>
              <br />
              {frame.result ?? "—"}
            </p>
          </SectionCard>
        </div>
      )}

      {frames.length > 0 && (
        <div data-testid="replay-window">
          <SectionCard title="Timeline">
            <p className="gm-meta">
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
                    #{f.absoluteIndex + 1} {formatUserTimestamp(f.barTime)}
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
          </SectionCard>
        </div>
      )}
      <p className="gm-meta">{disclaimer}</p>
    </div>
  );
}
