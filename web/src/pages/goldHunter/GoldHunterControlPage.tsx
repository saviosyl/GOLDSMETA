import { useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import { formatEur, useGoldHunter } from "./GoldHunterShell";

const PRESETS = [500, 1000, 2500, 5000, 10_000] as const;

export function GoldHunterControlPage() {
  const { api } = useAuth();
  const { status, refresh } = useGoldHunter();
  const [alloc, setAlloc] = useState<string>("");
  const [riskPct, setRiskPct] = useState<string>("");
  const [dailyPct, setDailyPct] = useState<string>("");
  const [maxOpen, setMaxOpen] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmArm, setConfirmArm] = useState(false);
  const cfg = status?.config;
  useEffect(() => {
    if (!cfg) return;
    setAlloc(String(cfg.allocatedCapitalEur));
    setRiskPct(String(cfg.riskPerTradePct));
    setDailyPct(String(cfg.dailyLossLimitPct));
    setMaxOpen(String(cfg.maxOpenTrades));
  }, [cfg?.updatedAt]);

  if (!status || !cfg) return null;

  const riskBudget =
    (Number(alloc || cfg.allocatedCapitalEur) * Number(riskPct || cfg.riskPerTradePct)) / 100;
  const dailyBudget =
    (Number(alloc || cfg.allocatedCapitalEur) * Number(dailyPct || cfg.dailyLossLimitPct)) /
    100;
  const demoBal = status.broker.balance;
  const unallocated =
    demoBal != null ? Math.max(0, demoBal - Number(alloc || cfg.allocatedCapitalEur)) : null;

  async function savePatch(patch: Record<string, unknown>, label?: string) {
    setBusy(true);
    setMsg(null);
    try {
      await api.goldHunterUpdateConfig(patch);
      await refresh();
      setMsg(label ?? "Saved");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="gh-control">
      <div className="gh-card" style={{ marginBottom: 12 }}>
        <h3>Control Centre</h3>
        <p className="gh-kpi-label">Capital, risk and Demo AutoTrade</p>
      </div>

      <div className="gh-split">
        <section className="gh-card">
          <h3>cTrader Demo Account</h3>
          <div className="gh-trade-grid">
            <div>
              <span>Balance</span>
              <strong data-testid="gh-ctrl-balance">
                {demoBal != null ? `€${demoBal.toLocaleString()}` : "—"}
              </strong>
            </div>
            <div>
              <span>Equity</span>
              <strong>
                {status.broker.equity != null
                  ? `€${status.broker.equity.toLocaleString()}`
                  : "—"}
              </strong>
            </div>
            <div>
              <span>Margin used</span>
              <strong>—</strong>
            </div>
            <div>
              <span>Free margin</span>
              <strong>—</strong>
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <span className="gh-badge gh-badge--demo">DEMO</span>
          </div>
        </section>

        <section className="gh-card">
          <h3>Gold Hunter Allocation</h3>
          <div className="gh-field">
            <label htmlFor="gh-alloc">Allocated capital (€)</label>
            <input
              id="gh-alloc"
              className="gh-input"
              inputMode="decimal"
              value={alloc}
              onChange={(e) => setAlloc(e.target.value)}
              data-testid="gh-alloc-input"
            />
            <div className="gh-presets">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={Number(alloc) === p ? "active" : undefined}
                  onClick={() => setAlloc(String(p))}
                >
                  {p >= 1000 ? `€${p / 1000}K`.replace(".0", "") : `€${p}`}
                </button>
              ))}
            </div>
            <p className="hint">
              Demo equity {demoBal != null ? `€${demoBal.toLocaleString()}` : "—"}
              {unallocated != null ? ` · Unallocated €${unallocated.toLocaleString()}` : ""}
            </p>
            <p className="hint">Changes apply to future Demo trades only.</p>
          </div>
          <button
            type="button"
            className="gh-btn gh-btn-gold"
            disabled={busy}
            data-testid="gh-alloc-save"
            onClick={() =>
              void savePatch(
                { allocatedCapitalEur: Number(alloc) },
                "Allocation saved"
              )
            }
          >
            Save allocation
          </button>
        </section>
      </div>

      <section className="gh-card" style={{ marginTop: 12 }}>
        <h3>Risk</h3>
        <div className="gh-split">
          <div className="gh-field">
            <label htmlFor="gh-risk">Risk per trade (%)</label>
            <input
              id="gh-risk"
              className="gh-input"
              value={riskPct}
              onChange={(e) => setRiskPct(e.target.value)}
            />
            <p className="hint">Planned max risk {formatEur(riskBudget).replace("+", "")}</p>
          </div>
          <div className="gh-field">
            <label htmlFor="gh-daily">Daily loss limit (%)</label>
            <input
              id="gh-daily"
              className="gh-input"
              value={dailyPct}
              onChange={(e) => setDailyPct(e.target.value)}
            />
            <p className="hint">Daily loss budget {formatEur(dailyBudget).replace("+", "")}</p>
          </div>
          <div className="gh-field">
            <label htmlFor="gh-max">Maximum open Gold Hunter trades</label>
            <input
              id="gh-max"
              className="gh-input"
              value={maxOpen}
              onChange={(e) => setMaxOpen(e.target.value)}
            />
            <p className="hint">No artificial hourly trade quota</p>
          </div>
        </div>
        <button
          type="button"
          className="gh-btn"
          disabled={busy}
          onClick={() =>
            void savePatch({
              riskPerTradePct: Number(riskPct),
              dailyLossLimitPct: Number(dailyPct),
              maxOpenTrades: Math.max(1, Math.floor(Number(maxOpen) || 1))
            })
          }
        >
          Save risk settings
        </button>
      </section>

      <section className="gh-card" style={{ marginTop: 12 }}>
        <h3>Mode</h3>
        <div className="gh-presets" style={{ marginBottom: 12 }}>
          <button type="button" className={!cfg.demoAutoTradeEnabled ? "active" : undefined}>
            RESEARCH
          </button>
          <button type="button" className={cfg.demoAutoTradeEnabled ? "active" : undefined}>
            DEMO AUTO
          </button>
          <button
            type="button"
            disabled
            title="Live permanently locked"
            className="gh-live-locked"
          >
            LIVE LOCKED
          </button>
        </div>

        <div className="gh-btn-row">
          {!cfg.demoAutoTradeEnabled ? (
            <button
              type="button"
              className="gh-btn gh-btn-gold"
              disabled={busy}
              data-testid="gh-arm-open"
              onClick={() => setConfirmArm(true)}
            >
              Enable Demo AutoTrade
            </button>
          ) : (
            <button
              type="button"
              className="gh-btn"
              disabled={busy}
              data-testid="gh-disarm"
              onClick={() => void savePatch({ demoAutoTradeEnabled: false })}
            >
              Turn Demo AutoTrade OFF
            </button>
          )}

          <button
            type="button"
            className="gh-btn"
            disabled={busy}
            data-testid="gh-pause"
            onClick={() =>
              void savePatch({ pauseNewEntries: !cfg.pauseNewEntries })
            }
          >
            {cfg.pauseNewEntries ? "Resume new entries" : "Pause new entries"}
          </button>

          <button
            type="button"
            className="gh-btn gh-btn-danger"
            disabled={busy}
            data-testid="gh-estop"
            onClick={() => {
              if (
                window.confirm(
                  "EMERGENCY STOP Gold Hunter Demo AutoTrade? New entries halt. Existing positions are not auto-closed."
                )
              ) {
                void savePatch({ emergencyStopActive: true });
              }
            }}
          >
            Emergency Stop
          </button>
        </div>
        {msg ? (
          <p className="hint" style={{ marginTop: 10 }} data-testid="gh-control-msg">
            {msg}
          </p>
        ) : null}
      </section>

      {status.audit.length > 0 ? (
        <section className="gh-card" style={{ marginTop: 12 }}>
          <h3>Admin activity</h3>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: "0.78rem", color: "var(--gh-muted)" }}>
            {status.audit.slice(0, 8).map((a) => (
              <li key={a.id}>
                {a.detail} · {new Date(a.at).toLocaleString()}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {confirmArm ? (
        <div className="gh-modal-backdrop" role="presentation">
          <div
            className="gh-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gh-arm-title"
            data-testid="gh-arm-modal"
          >
            <h2 id="gh-arm-title">Enable Gold Hunter Demo AutoTrade?</h2>
            <p>Broker: cTrader DEMO</p>
            <dl>
              <dt>Allocation</dt>
              <dd>€{Number(alloc || cfg.allocatedCapitalEur).toLocaleString()}</dd>
              <dt>Risk / trade</dt>
              <dd>{riskPct || cfg.riskPerTradePct}%</dd>
              <dt>Daily loss limit</dt>
              <dd>{dailyPct || cfg.dailyLossLimitPct}%</dd>
              <dt>Max open trades</dt>
              <dd>{maxOpen || cfg.maxOpenTrades}</dd>
              <dt>Live trading</dt>
              <dd>DISABLED</dd>
            </dl>
            <div className="gh-btn-row">
              <button
                type="button"
                className="gh-btn gh-btn-gold"
                disabled={busy}
                data-testid="gh-arm-confirm"
                onClick={() => {
                  setConfirmArm(false);
                  void savePatch({
                    demoAutoTradeEnabled: true,
                    confirmDemoAutoTrade: true
                  });
                }}
              >
                Enable Demo
              </button>
              <button
                type="button"
                className="gh-btn"
                onClick={() => setConfirmArm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
