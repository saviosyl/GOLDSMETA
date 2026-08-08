type OpenPositionView = {
  correlationId?: string;
  accountMasked?: string | null;
  symbol?: string;
  side?: string;
  entry?: number | null;
  current?: number | null;
  lots?: number | null;
  stopLoss?: number | null;
  tp1?: number | null;
  tp2?: number | null;
  tp3?: number | null;
  tp1Status?: string;
  tp2Status?: string;
  tp3Status?: string;
  pnl?: number | null;
  initialRisk?: number | null;
  currentRisk?: number | null;
  openedAt?: string;
  durationSeconds?: number | null;
  managementState?: string;
  fundsLabel?: string;
  lastRecommendation?: string | null;
};

function money(n: number | null | undefined, currency = "EUR"): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(n);
}

function num(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function tpLabel(status?: string): string {
  if (!status) return "Pending";
  if (status === "HIT" || status === "PARTIAL_CLOSED") return "Hit";
  return "Pending";
}

function stateLabel(state?: string): string {
  if (!state) return "HOLD";
  return state.replace(/_/g, " ");
}

export function OpenPositionCard(props: {
  position: OpenPositionView | null;
  currency?: string;
}) {
  const p = props.position;
  const currency = props.currency ?? "EUR";

  if (!p) {
    return (
      <article className="gm-at-card gm-open-pos" data-testid="autotrade-card-position">
        <h3>Open Position</h3>
        <p className="gm-meta">No open Demo Gold position.</p>
      </article>
    );
  }

  return (
    <article className="gm-at-card gm-open-pos" data-testid="autotrade-card-position">
      <header className="gm-open-pos__head">
        <div>
          <p className="gm-open-pos__funds">{p.fundsLabel ?? "DEMO FUNDS"}</p>
          <h3>
            {p.symbol ?? "XAUUSD"} {p.side}
          </h3>
        </div>
        <p className="gm-open-pos__account">Account {p.accountMasked ?? "—"}</p>
      </header>

      <dl className="gm-open-pos__grid">
        <div>
          <dt>Entry</dt>
          <dd>{num(p.entry, 2)}</dd>
        </div>
        <div>
          <dt>Current</dt>
          <dd>{num(p.current, 2)}</dd>
        </div>
        <div>
          <dt>Lots</dt>
          <dd>{num(p.lots, 2)}</dd>
        </div>
        <div>
          <dt>SL</dt>
          <dd>{num(p.stopLoss, 2)}</dd>
        </div>
        <div>
          <dt>TP1</dt>
          <dd>
            {num(p.tp1, 2)} · {tpLabel(p.tp1Status)}
          </dd>
        </div>
        <div>
          <dt>TP2</dt>
          <dd>
            {num(p.tp2, 2)} · {tpLabel(p.tp2Status)}
          </dd>
        </div>
        <div>
          <dt>TP3</dt>
          <dd>
            {num(p.tp3, 2)} · {tpLabel(p.tp3Status)}
          </dd>
        </div>
        <div>
          <dt>P/L</dt>
          <dd>{money(p.pnl, currency)}</dd>
        </div>
        <div>
          <dt>Initial risk</dt>
          <dd>{num(p.initialRisk, 2)}</dd>
        </div>
        <div>
          <dt>Current risk</dt>
          <dd>{num(p.currentRisk, 2)}</dd>
        </div>
        <div>
          <dt>Opened</dt>
          <dd>{p.openedAt ? new Date(p.openedAt).toLocaleString() : "—"}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{formatDuration(p.durationSeconds)}</dd>
        </div>
      </dl>

      <p className="gm-open-pos__state" data-testid="open-position-mgmt-state">
        {stateLabel(p.managementState)}
      </p>
      {p.lastRecommendation ? (
        <p className="gm-meta gm-open-pos__rec">{p.lastRecommendation}</p>
      ) : null}
    </article>
  );
}
