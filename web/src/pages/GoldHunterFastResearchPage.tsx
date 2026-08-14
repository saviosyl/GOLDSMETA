/**
 * GOLD HUNTER FAST — live research capture monitor (READ-ONLY).
 * Polls /health + /recent-candidates. No trading controls.
 */
import { useEffect, useMemo, useRef, useState } from "react";

type ResearchHealth = {
  captureHealthy?: boolean;
  campaignValid?: boolean;
  dataIntegrityStatus?: string;
  connectionState?: string;
  spotSubscribed?: boolean;
  depthSubscribed?: boolean;
  spotAgeMs?: number | null;
  depthAgeMs?: number | null;
  eventsReceived?: number;
  eventsDropped?: number;
  observationA?: number;
  observationB?: number;
  observationC?: number;
  eligibleA?: number;
  eligibleB?: number;
  eligibleC?: number;
  selectedA?: number;
  selectedB?: number;
  selectedC?: number;
  candidateA?: number;
  candidateB?: number;
  candidateC?: number;
  lastBid?: number | null;
  lastAsk?: number | null;
  lastSpread?: number | null;
  marketDataNormalizationVersion?: string;
  inputNormalizationVerified?: boolean;
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
  permissionScope?: string;
  executionAdapter?: string;
  mutationSurface?: string;
  brokerRequests?: number;
  brokerOrders?: number;
  shadowOrders?: number;
  durableMode?: string;
  scopeVerified?: boolean;
};

type ResearchObservation = {
  observationId: number;
  label: string;
  kind: string;
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
};

type FeedFilter = "SELECTED" | "ELIGIBLE" | "ALL";

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

function fmtPx(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
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
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}

function Delta({
  current,
  previous
}: {
  current: number | undefined;
  previous: number | undefined;
}) {
  if (current == null || previous == null || current <= previous) return null;
  return (
    <span className="gm-ghr-up" aria-hidden>
      ↑
    </span>
  );
}

function Kpi({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad";
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
  const [filter, setFilter] = useState<FeedFilter>("ELIGIBLE");
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
          fetch(`${base}/recent-candidates?limit=40&filter=${filter}`, {
            cache: "no-store"
          })
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
          const feed = (await cRes.json()) as {
            observations?: ResearchObservation[];
          };
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
  }, [base, filter]);

  useEffect(() => {
    let meta = document.querySelector('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "robots");
      document.head.appendChild(meta);
    }
    if (
      (import.meta.env.VITE_GOLD_HUNTER_FAST_RESEARCH_PREVIEW as string) ===
      "true"
    ) {
      meta.setAttribute("content", "noindex, nofollow");
      document.title = "GOLD HUNTER FAST — Research Preview (noindex)";
    }
  }, []);

  const ageSec =
    lastOkAt == null || nowTick === 0
      ? null
      : Math.max(0, Math.round((nowTick - lastOkAt) / 1000));
  const feedStale =
    lastOkAt == null ||
    nowTick === 0 ||
    nowTick - lastOkAt > STALE_AFTER_MS ||
    Boolean(fetchError);
  const live = !feedStale && Boolean(health?.captureHealthy);
  const feedLive =
    !feedStale &&
    Boolean(health?.spotSubscribed) &&
    (health?.spotAgeMs == null || health.spotAgeMs < 20_000);
  const unsafe =
    (health?.brokerRequests ?? 0) > 0 ||
    (health?.brokerOrders ?? 0) > 0 ||
    (health?.shadowOrders ?? 0) > 0 ||
    (health?.executionAdapter != null &&
      health.executionAdapter !== "NONE") ||
    (health?.mutationSurface != null && health.mutationSurface !== "NONE") ||
    (health?.permissionScope != null &&
      health.permissionScope !== "SCOPE_VIEW");

  const eligibleA = health?.eligibleA ?? health?.candidateA ?? 0;
  const eligibleB = health?.eligibleB ?? health?.candidateB ?? 0;
  const eligibleC = health?.eligibleC ?? health?.candidateC ?? 0;
  const selectedTotal =
    (health?.selectedA ?? 0) +
    (health?.selectedB ?? 0) +
    (health?.selectedC ?? 0);

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
          <span className="gm-ghr-pill">
            DAY {health?.captureDayIndex ?? "—"}
          </span>
          <span className="gm-ghr-pill">
            {health?.permissionScope ?? "SCOPE_VIEW"}
          </span>
          <span className="gm-ghr-pill is-warn">NO TRADING</span>
        </div>
      </header>

      <section className="gm-ghr-market" data-testid="gh-research-market">
        <span className="gm-ghr-sym">XAUUSD</span>
        <span>
          BID <strong>{fmtPx(health?.lastBid)}</strong>
        </span>
        <span>
          ASK <strong>{fmtPx(health?.lastAsk)}</strong>
        </span>
        <span>
          SPREAD <strong>{fmtPx(health?.lastSpread)}</strong>
        </span>
        <span className={`gm-ghr-pill ${feedLive ? "is-ok" : "is-bad"}`}>
          {feedLive ? "FEED LIVE" : "FEED OFF"}
        </span>
        <span className="gm-ghr-norm">
          {health?.marketDataNormalizationVersion ?? "—"}
          {health?.inputNormalizationVerified ? " · verified" : ""}
        </span>
      </section>

      <div className="gm-ghr-updated" data-testid="gh-research-updated">
        {feedStale ? (
          <span className="is-bad">
            {fetchError
              ? `DISCONNECTED — ${fetchError}`
              : "FEED STALE / DISCONNECTED"}
            {ageSec != null ? ` · last ok ${ageSec}s ago` : ""}
          </span>
        ) : (
          <span>
            Last updated: {ageSec ?? 0}s ago · poll {POLL_MS / 1000}s ·{" "}
            {fmtDuration(health?.captureDurationMs)}
          </span>
        )}
      </div>

      {unsafe ? (
        <div className="gm-ghr-unsafe" data-testid="gh-research-unsafe">
          SAFETY BREACH — unexpected trading surface detected.
        </div>
      ) : null}

      <section className="gm-ghr-activity" data-testid="gh-research-activity">
        <div className="gm-ghr-section-title">LIVE ACTIVITY</div>
        <div className="gm-ghr-activity-grid">
          <div className="gm-ghr-activity-row">
            <span>EVENTS</span>
            <strong>
              {fmtNum(health?.eventsReceived)}
              <Delta
                current={health?.eventsReceived}
                previous={prev?.eventsReceived}
              />
            </strong>
          </div>
          <div className="gm-ghr-activity-row">
            <span>A ELIGIBLE</span>
            <strong>
              {fmtNum(eligibleA)}
              <Delta current={eligibleA} previous={prev?.eligibleA ?? prev?.candidateA} />
            </strong>
          </div>
          <div className="gm-ghr-activity-row">
            <span>B ELIGIBLE</span>
            <strong>
              {fmtNum(eligibleB)}
              <Delta current={eligibleB} previous={prev?.eligibleB ?? prev?.candidateB} />
            </strong>
          </div>
          <div className="gm-ghr-activity-row">
            <span>C ELIGIBLE</span>
            <strong>
              {fmtNum(eligibleC)}
              <Delta current={eligibleC} previous={prev?.eligibleC ?? prev?.candidateC} />
            </strong>
          </div>
          <div className="gm-ghr-activity-row">
            <span>SELECTED OPPORTUNITIES</span>
            <strong>
              {fmtNum(selectedTotal)}
              <Delta
                current={selectedTotal}
                previous={
                  (prev?.selectedA ?? 0) +
                  (prev?.selectedB ?? 0) +
                  (prev?.selectedC ?? 0)
                }
              />
            </strong>
          </div>
        </div>
        <div className="gm-ghr-activity-secondary">
          <span>
            A OBS {fmtNum(health?.observationA)} · B OBS{" "}
            {fmtNum(health?.observationB)} · C OBS {fmtNum(health?.observationC)}
          </span>
          <span>
            HB {fmtNum(health?.heartbeatsPersisted)} · Chunks{" "}
            {fmtNum(health?.chunksUploaded)}
          </span>
        </div>
      </section>

      <section
        className="gm-ghr-feed"
        data-testid="gh-research-candidate-feed"
      >
        <div className="gm-ghr-section-title">
          OPPORTUNITY FEED
          <span className="gm-ghr-feed-note">
            RESEARCH OBSERVATION — NOT A TRADE
          </span>
        </div>
        <div className="gm-ghr-filters" data-testid="gh-research-filters">
          {(["SELECTED", "ELIGIBLE", "ALL"] as FeedFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`gm-ghr-filter${filter === f ? " is-active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "ALL" ? "ALL OBSERVATIONS" : f}
            </button>
          ))}
        </div>
        {!feedAvailable ? (
          <p className="gm-ghr-empty">Candidate feed unavailable.</p>
        ) : observations.length === 0 ? (
          <p className="gm-ghr-empty">
            No rows for filter {filter}. Waiting for eligible/selected setups.
          </p>
        ) : (
          <>
            <div className="gm-ghr-feed-desktop">
              <table className="gm-ghr-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Time</th>
                    <th>Setup</th>
                    <th>Side</th>
                    <th>Quality</th>
                    <th>Bid</th>
                    <th>Ask</th>
                    <th>Spread</th>
                    <th>Imbal</th>
                    <th>Vel</th>
                    <th>Accel</th>
                  </tr>
                </thead>
                <tbody>
                  {observations.map((o) => (
                    <tr key={o.observationId}>
                      <td>OBS {o.observationId}</td>
                      <td>{o.tsIso.slice(11, 19)}</td>
                      <td>
                        {o.setupName}
                        {o.selectedCandidate
                          ? " · SEL"
                          : o.eligible
                            ? " · ELIG"
                            : ""}
                      </td>
                      <td>{o.side ?? "—"}</td>
                      <td>
                        {o.rawQuality != null ? o.rawQuality.toFixed(2) : "—"}
                      </td>
                      <td>{fmtPx(o.bid)}</td>
                      <td>{fmtPx(o.ask)}</td>
                      <td>{fmtPx(o.spread)}</td>
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
                        OBS {o.observationId} · {o.setupName}
                      </span>
                      <span>{o.side ?? "—"}</span>
                    </div>
                    <div className="gm-ghr-mobile-sub">
                      {o.tsIso.slice(11, 19)} · {fmtPx(o.bid)}/{fmtPx(o.ask)} ·
                      spr {fmtPx(o.spread)}
                    </div>
                    <div className="gm-ghr-obs-label">{o.label}</div>
                    {open ? (
                      <div className="gm-ghr-mobile-expand">
                        <div>
                          Quality{" "}
                          {o.rawQuality != null ? o.rawQuality.toFixed(2) : "—"}
                        </div>
                        <div>
                          Imbal{" "}
                          {o.imbalance != null ? o.imbalance.toFixed(2) : "—"} ·
                          Vel{" "}
                          {o.velocity1s != null ? o.velocity1s.toFixed(3) : "—"}{" "}
                          · Accel{" "}
                          {o.acceleration != null
                            ? o.acceleration.toFixed(3)
                            : "—"}
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

      <section className="gm-ghr-kpis" data-testid="gh-research-kpis">
        <Kpi
          label="Capture Health"
          value={health?.captureHealthy ? "HEALTHY" : "UNHEALTHY"}
          tone={health?.captureHealthy ? "ok" : "warn"}
        />
        <Kpi
          label="Campaign Valid"
          value={health?.campaignValid ? "YES" : "NO"}
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
        <Kpi label="Spot age" value={fmtMs(health?.spotAgeMs)} />
        <Kpi label="Depth age" value={fmtMs(health?.depthAgeMs)} />
        <Kpi label="Events Dropped" value={fmtNum(health?.eventsDropped)} />
        <Kpi
          label="Persistence Drops"
          value={`${fmtNum(health?.persistenceDroppedRows)}/${fmtNum(health?.persistenceDroppedChunks)}`}
        />
        <Kpi
          label="Queue P50/P95/P99"
          value={`${fmtMs(health?.queueLatencyP50)}/${fmtMs(health?.queueLatencyP95)}/${fmtMs(health?.queueLatencyP99)}`}
        />
        <Kpi
          label="Lag P50/P95/P99"
          value={`${fmtMs(health?.eventLoopLagP50)}/${fmtMs(health?.eventLoopLagP95)}/${fmtMs(health?.eventLoopLagP99)}`}
        />
        <Kpi label="Gaps/Reconn/Resync" value={`${fmtNum(health?.feedGapCount)}/${fmtNum(health?.reconnectCount)}/${fmtNum(health?.resyncCount)}`} />
        <Kpi label="Crossed Book" value={fmtNum(health?.bookCrossedCount)} />
        <Kpi
          label="Day / Validated"
          value={`${fmtNum(health?.captureDayIndex ?? undefined)} / ${fmtNum(health?.validatedIndependentDays)}`}
        />
        <Kpi label="Durable" value={health?.durableMode ?? "—"} />
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
            <strong>{health?.scopeVerified ? "YES" : "NO"}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}
