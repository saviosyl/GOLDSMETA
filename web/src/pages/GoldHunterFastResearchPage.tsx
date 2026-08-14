/**
 * GOLD HUNTER FAST — live research capture monitor (READ-ONLY).
 * Polls the research collector /health (+ /recent-candidates).
 * No trading controls, no shadow/broker order actions.
 */
import { useEffect, useMemo, useRef, useState } from "react";

type ResearchHealth = {
  processHealthy?: boolean;
  captureHealthy?: boolean;
  campaignValid?: boolean;
  dataIntegrityStatus?: string;
  connectionState?: string;
  spotSubscribed?: boolean;
  depthSubscribed?: boolean;
  spotAgeMs?: number | null;
  depthAgeMs?: number | null;
  freshnessLimitMs?: number;
  eventsReceived?: number;
  eventsDropped?: number;
  candidateA?: number;
  candidateB?: number;
  candidateC?: number;
  heartbeatsPersisted?: number;
  chunksWritten?: number;
  chunksUploaded?: number;
  persistenceDroppedRows?: number;
  persistenceDroppedChunks?: number;
  queueLatencyP50?: number | null;
  queueLatencyP95?: number | null;
  queueLatencyP99?: number | null;
  eventLoopLagP50?: number | null;
  eventLoopLagP95?: number | null;
  eventLoopLagP99?: number | null;
  feedGapCount?: number;
  reconnectCount?: number;
  resyncCount?: number;
  bookCrossedCount?: number;
  captureDayIndex?: number | null;
  validatedIndependentDays?: number;
  captureDurationMs?: number;
  campaignStartUtcDate?: string | null;
  campaignStartedAt?: string | null;
  currentCaptureUtcDate?: string | null;
  permissionScope?: string;
  executionAdapter?: string;
  mutationSurface?: string;
  brokerRequests?: number;
  brokerOrders?: number;
  shadowOrders?: number;
  durableMode?: string;
  runId?: string;
  runtimeSha?: string;
  campaignStatus?: string;
  scopeVerified?: boolean;
  continuousOperation?: boolean;
  autoStopAfterFiveDays?: boolean;
  healthWarning?: string | null;
  captureUnhealthyReasons?: string[];
};

type ResearchObservation = {
  observationId: number;
  label: string;
  kind: string;
  setup: string;
  setupName: string;
  side: "BUY" | "SELL" | null;
  eligible: boolean;
  rawQuality: number | null;
  selectedCandidate: boolean;
  tsIso: string;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  imbalance: number | null;
  velocity1s: number | null;
  acceleration: number | null;
  distHigh5s: number | null;
  distLow5s: number | null;
  upTouches5s: number | null;
  downTouches5s: number | null;
};

type RecentCandidatesResponse = {
  observations?: ResearchObservation[];
  count?: number;
  label?: string;
};

const POLL_MS = 2000;
const STALE_AFTER_MS = 8000;

function researchHealthBaseUrl(): string {
  const raw = (
    import.meta.env.VITE_GOLD_HUNTER_FAST_RESEARCH_HEALTH_URL as
      | string
      | undefined
  )?.trim();
  if (!raw) return "";
  return raw.replace(/\/health\/?$/i, "").replace(/\/$/, "");
}

function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

function fmtMs(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n)}ms`;
}

function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${m}m ${r}s`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}

function boolLabel(v: boolean | undefined, yes = "YES", no = "NO"): string {
  if (v == null) return "—";
  return v ? yes : no;
}

function Delta({
  current,
  previous
}: {
  current: number | undefined;
  previous: number | undefined;
}) {
  if (current == null || previous == null || current <= previous) return null;
  return <span className="gm-ghr-up" aria-hidden>↑</span>;
}

function Kpi({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad" | "neutral";
}) {
  return (
    <div className={`gm-ghr-kpi${tone ? ` is-${tone}` : ""}`}>
      <span className="gm-ghr-kpi-label">{label}</span>
      <strong className="gm-ghr-kpi-value">{value}</strong>
    </div>
  );
}

export function GoldHunterFastResearchPage() {
  const base = researchHealthBaseUrl();
  const [health, setHealth] = useState<ResearchHealth | null>(null);
  const [prev, setPrev] = useState<ResearchHealth | null>(null);
  const [observations, setObservations] = useState<ResearchObservation[]>([]);
  const [feedAvailable, setFeedAvailable] = useState(false);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(0);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const prevHealthRef = useRef<ResearchHealth | null>(null);

  useEffect(() => {
    setNowTick(Date.now());
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const [hRes, cRes] = await Promise.all([
          fetch(`${base}/health`, { cache: "no-store" }),
          fetch(`${base}/recent-candidates?limit=40`, { cache: "no-store" })
        ]);
        if (!hRes.ok) throw new Error(`health HTTP ${hRes.status}`);
        const h = (await hRes.json()) as ResearchHealth;
        if (cancelled) return;
        setPrev(prevHealthRef.current);
        prevHealthRef.current = h;
        setHealth(h);
        setLastOkAt(Date.now());
        setFetchError(null);
        if (cRes.ok) {
          const feed = (await cRes.json()) as RecentCandidatesResponse;
          setObservations(feed.observations ?? []);
          setFeedAvailable(true);
        } else {
          setFeedAvailable(false);
        }
      } catch (e) {
        if (cancelled) return;
        setFetchError(e instanceof Error ? e.message : String(e));
      }
    };
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [base]);

  const ageSec =
    lastOkAt == null ? null : Math.max(0, Math.round((nowTick - lastOkAt) / 1000));
  const feedStale =
    lastOkAt == null || nowTick - lastOkAt > STALE_AFTER_MS || Boolean(fetchError);
  const live = !feedStale && Boolean(health?.captureHealthy);
  const unsafe =
    (health?.brokerRequests ?? 0) > 0 ||
    (health?.brokerOrders ?? 0) > 0 ||
    (health?.shadowOrders ?? 0) > 0 ||
    (health?.executionAdapter != null &&
      health.executionAdapter !== "NONE") ||
    (health?.mutationSurface != null && health.mutationSurface !== "NONE") ||
    (health?.permissionScope != null &&
      health.permissionScope !== "SCOPE_VIEW");

  const statusTone = useMemo(() => {
    if (feedStale) return "bad";
    if (!health?.captureHealthy) return "warn";
    return "ok";
  }, [feedStale, health?.captureHealthy]);

  if (!base) {
    return (
      <div className="gm-page gm-ghr-page" data-testid="gh-research-monitor">
        <div className="gm-banner gm-banner-danger">
          Set VITE_GOLD_HUNTER_FAST_RESEARCH_HEALTH_URL to the research
          collector /health URL.
        </div>
      </div>
    );
  }

  return (
    <div className="gm-page gm-ghr-page" data-testid="gh-research-monitor">
      <header className="gm-ghr-header">
        <div>
          <h1 className="gm-ghr-brand" data-testid="gh-research-brand">
            GOLD HUNTER FAST
          </h1>
          <p className="gm-ghr-subtitle">LIVE RESEARCH — OBSERVATION ONLY</p>
        </div>
        <div className="gm-ghr-top-status" data-testid="gh-research-top-status">
          <span className={`gm-ghr-pill is-${statusTone}`}>
            {feedStale ? "FEED STALE" : live ? "CAPTURE LIVE" : "CAPTURE OFF"}
          </span>
          <span className="gm-ghr-pill">XAUUSD</span>
          <span className="gm-ghr-pill">
            DAY {health?.captureDayIndex ?? "—"}
          </span>
          <span className="gm-ghr-pill">
            {health?.permissionScope ?? "SCOPE_VIEW"}
          </span>
          <span className="gm-ghr-pill is-warn">NO TRADING</span>
        </div>
      </header>

      <div className="gm-ghr-updated" data-testid="gh-research-updated">
        {feedStale ? (
          <span className="is-bad">
            {fetchError ? `DISCONNECTED — ${fetchError}` : "FEED STALE / DISCONNECTED"}
            {ageSec != null ? ` · last ok ${ageSec}s ago` : ""}
          </span>
        ) : (
          <span>Last updated: {ageSec ?? 0}s ago · poll {POLL_MS / 1000}s</span>
        )}
      </div>

      {unsafe ? (
        <div className="gm-ghr-unsafe" data-testid="gh-research-unsafe">
          SAFETY BREACH — unexpected trading surface detected. RESEARCH ONLY
          expected: SCOPE_VIEW / NONE / zeros.
        </div>
      ) : null}

      <section className="gm-ghr-activity" data-testid="gh-research-activity">
        <div className="gm-ghr-section-title">LIVE ACTIVITY</div>
        <div className="gm-ghr-activity-grid">
          <div className="gm-ghr-activity-row">
            <span>EVENTS CAPTURED</span>
            <strong>
              {fmtNum(health?.eventsReceived)}
              <Delta
                current={health?.eventsReceived}
                previous={prev?.eventsReceived}
              />
            </strong>
          </div>
          <div className="gm-ghr-activity-row">
            <span>A MOMENTUM IGNITION</span>
            <strong>
              {fmtNum(health?.candidateA)}
              <Delta current={health?.candidateA} previous={prev?.candidateA} />
            </strong>
          </div>
          <div className="gm-ghr-activity-row">
            <span>B FAST BREAKOUT</span>
            <strong>
              {fmtNum(health?.candidateB)}
              <Delta current={health?.candidateB} previous={prev?.candidateB} />
            </strong>
          </div>
          <div className="gm-ghr-activity-row">
            <span>C PULLBACK</span>
            <strong>
              {fmtNum(health?.candidateC)}
              <Delta current={health?.candidateC} previous={prev?.candidateC} />
            </strong>
          </div>
          <div className="gm-ghr-activity-row">
            <span>HEARTBEATS</span>
            <strong>
              {fmtNum(health?.heartbeatsPersisted)}
              <Delta
                current={health?.heartbeatsPersisted}
                previous={prev?.heartbeatsPersisted}
              />
            </strong>
          </div>
          <div className="gm-ghr-activity-row">
            <span>CHUNKS UPLOADED</span>
            <strong>
              {fmtNum(health?.chunksUploaded)}
              <Delta
                current={health?.chunksUploaded}
                previous={prev?.chunksUploaded}
              />
            </strong>
          </div>
        </div>
      </section>

      <section className="gm-ghr-kpis" data-testid="gh-research-kpis">
        <Kpi
          label="Capture Health"
          value={boolLabel(health?.captureHealthy, "HEALTHY", "UNHEALTHY")}
          tone={health?.captureHealthy ? "ok" : "warn"}
        />
        <Kpi
          label="Campaign Valid"
          value={boolLabel(health?.campaignValid)}
          tone={health?.campaignValid ? "ok" : "warn"}
        />
        <Kpi
          label="Data Integrity"
          value={health?.dataIntegrityStatus ?? "—"}
          tone={
            health?.dataIntegrityStatus === "CLEAN"
              ? "ok"
              : health?.dataIntegrityStatus === "FAILED"
                ? "bad"
                : "warn"
          }
        />
        <Kpi label="Connection" value={health?.connectionState ?? "—"} />
        <Kpi
          label="Spot subscribed"
          value={boolLabel(health?.spotSubscribed)}
        />
        <Kpi label="Spot age" value={fmtMs(health?.spotAgeMs)} />
        <Kpi
          label="Depth subscribed"
          value={boolLabel(health?.depthSubscribed)}
        />
        <Kpi label="Depth age" value={fmtMs(health?.depthAgeMs)} />
        <Kpi label="Events Received" value={fmtNum(health?.eventsReceived)} />
        <Kpi label="Events Dropped" value={fmtNum(health?.eventsDropped)} />
        <Kpi label="Setup A" value={fmtNum(health?.candidateA)} />
        <Kpi label="Setup B" value={fmtNum(health?.candidateB)} />
        <Kpi label="Setup C" value={fmtNum(health?.candidateC)} />
        <Kpi label="Heartbeats" value={fmtNum(health?.heartbeatsPersisted)} />
        <Kpi label="Chunks Written" value={fmtNum(health?.chunksWritten)} />
        <Kpi label="Chunks Uploaded" value={fmtNum(health?.chunksUploaded)} />
        <Kpi
          label="Persistence Drops"
          value={`${fmtNum(health?.persistenceDroppedRows)} / ${fmtNum(health?.persistenceDroppedChunks)}`}
        />
        <Kpi
          label="Queue Latency P50/P95/P99"
          value={`${fmtMs(health?.queueLatencyP50)} / ${fmtMs(health?.queueLatencyP95)} / ${fmtMs(health?.queueLatencyP99)}`}
        />
        <Kpi
          label="Event Loop Lag P50/P95/P99"
          value={`${fmtMs(health?.eventLoopLagP50)} / ${fmtMs(health?.eventLoopLagP95)} / ${fmtMs(health?.eventLoopLagP99)}`}
        />
        <Kpi label="Feed Gaps" value={fmtNum(health?.feedGapCount)} />
        <Kpi label="Reconnects" value={fmtNum(health?.reconnectCount)} />
        <Kpi label="Resyncs" value={fmtNum(health?.resyncCount)} />
        <Kpi label="Crossed Book" value={fmtNum(health?.bookCrossedCount)} />
        <Kpi
          label="captureDayIndex"
          value={fmtNum(health?.captureDayIndex ?? undefined)}
        />
        <Kpi
          label="validatedIndependentDays"
          value={fmtNum(health?.validatedIndependentDays)}
        />
        <Kpi
          label="captureDuration"
          value={fmtDuration(health?.captureDurationMs)}
        />
        <Kpi label="Durable mode" value={health?.durableMode ?? "—"} />
      </section>

      <section
        className="gm-ghr-feed"
        data-testid="gh-research-candidate-feed"
      >
        <div className="gm-ghr-section-title">
          LIVE CANDIDATE FEED
          <span className="gm-ghr-feed-note">
            {feedAvailable
              ? "RESEARCH OBSERVATION — NOT A TRADE"
              : "waiting for /recent-candidates"}
          </span>
        </div>
        {!feedAvailable ? (
          <p className="gm-ghr-empty">
            Candidate list endpoint not available yet. KPI counters above still
            update live.
          </p>
        ) : observations.length === 0 ? (
          <p className="gm-ghr-empty">
            No specialist observations yet — waiting for A/B/C detections.
          </p>
        ) : (
          <>
            <div className="gm-ghr-feed-desktop">
              <table className="gm-ghr-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Time</th>
                    <th>Kind</th>
                    <th>Setup</th>
                    <th>Side</th>
                    <th>Eligible</th>
                    <th>Quality</th>
                    <th>Spread</th>
                    <th>Bid/Ask</th>
                    <th>Imbal</th>
                    <th>Vel1s</th>
                    <th>Accel</th>
                  </tr>
                </thead>
                <tbody>
                  {observations.map((o) => (
                    <tr key={o.observationId}>
                      <td>OBS {o.observationId}</td>
                      <td>{o.tsIso.slice(11, 19)}</td>
                      <td>{o.kind.replace("_", " ")}</td>
                      <td>{o.setupName}</td>
                      <td>{o.side ?? "—"}</td>
                      <td>{o.eligible ? "YES" : "NO"}</td>
                      <td>
                        {o.rawQuality != null ? o.rawQuality.toFixed(2) : "—"}
                      </td>
                      <td>
                        {o.spread != null ? o.spread.toFixed(2) : "—"}
                      </td>
                      <td>
                        {o.bid != null && o.ask != null
                          ? `${o.bid.toFixed(2)}/${o.ask.toFixed(2)}`
                          : "—"}
                      </td>
                      <td>
                        {o.imbalance != null ? o.imbalance.toFixed(2) : "—"}
                      </td>
                      <td>
                        {o.velocity1s != null ? o.velocity1s.toFixed(3) : "—"}
                      </td>
                      <td>
                        {o.acceleration != null
                          ? o.acceleration.toFixed(3)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="gm-ghr-feed-mobile">
              {observations.map((o) => {
                const open = expandedId === o.observationId;
                return (
                  <button
                    key={o.observationId}
                    type="button"
                    className="gm-ghr-mobile-row"
                    onClick={() =>
                      setExpandedId(open ? null : o.observationId)
                    }
                  >
                    <div className="gm-ghr-mobile-main">
                      <span>
                        OBSERVATION {o.observationId} · {o.kind.replace("_", " ")}
                      </span>
                      <span>{o.side ?? "—"}</span>
                    </div>
                    <div className="gm-ghr-mobile-sub">
                      {o.setupName} · {o.tsIso.slice(11, 19)} ·{" "}
                      {o.eligible ? "eligible" : "watch"}
                    </div>
                    <div className="gm-ghr-obs-label">{o.label}</div>
                    {open ? (
                      <div className="gm-ghr-mobile-expand">
                        <div>
                          Quality{" "}
                          {o.rawQuality != null ? o.rawQuality.toFixed(2) : "—"}
                        </div>
                        <div>
                          Spread {o.spread != null ? o.spread.toFixed(2) : "—"}
                        </div>
                        <div>
                          Bid/Ask{" "}
                          {o.bid != null && o.ask != null
                            ? `${o.bid.toFixed(2)}/${o.ask.toFixed(2)}`
                            : "—"}
                        </div>
                        <div>
                          Imbalance{" "}
                          {o.imbalance != null ? o.imbalance.toFixed(2) : "—"}
                        </div>
                        <div>
                          Velocity {o.velocity1s != null ? o.velocity1s.toFixed(3) : "—"}{" "}
                          · Accel{" "}
                          {o.acceleration != null
                            ? o.acceleration.toFixed(3)
                            : "—"}
                        </div>
                        <div>
                          Dist H/L{" "}
                          {o.distHigh5s != null ? o.distHigh5s.toFixed(2) : "—"}/
                          {o.distLow5s != null ? o.distLow5s.toFixed(2) : "—"} ·
                          Touches {o.upTouches5s ?? "—"}/{o.downTouches5s ?? "—"}
                        </div>
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>

      <section
        className={`gm-ghr-safety${unsafe ? " is-unsafe" : ""}`}
        data-testid="gh-research-safety"
      >
        <div className="gm-ghr-section-title">SAFETY</div>
        <div className="gm-ghr-safety-grid">
          <div>
            <span>Mode</span>
            <strong>RESEARCH ONLY</strong>
          </div>
          <div>
            <span>Permission</span>
            <strong>{health?.permissionScope ?? "SCOPE_VIEW"}</strong>
          </div>
          <div>
            <span>Execution Adapter</span>
            <strong>{health?.executionAdapter ?? "NONE"}</strong>
          </div>
          <div>
            <span>Broker Requests</span>
            <strong>{health?.brokerRequests ?? 0}</strong>
          </div>
          <div>
            <span>Broker Orders</span>
            <strong>{health?.brokerOrders ?? 0}</strong>
          </div>
          <div>
            <span>Shadow Orders</span>
            <strong>{health?.shadowOrders ?? 0}</strong>
          </div>
          <div>
            <span>Mutation Surface</span>
            <strong>{health?.mutationSurface ?? "NONE"}</strong>
          </div>
          <div>
            <span>Scope verified</span>
            <strong>{boolLabel(health?.scopeVerified)}</strong>
          </div>
        </div>
        <p className="gm-ghr-safety-foot">
          Architecture is extendable for future FAST V2 Shadow ENTER/EXIT/P/L —
          trading is not enabled on this page.
        </p>
      </section>
    </div>
  );
}
