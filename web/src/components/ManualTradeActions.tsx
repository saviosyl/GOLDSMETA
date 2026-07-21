import { useState } from "react";
import type { ManualExecutionAction, ManualRiskSettings, SetupRecord } from "../types/models";
import type { ManualExecutionPatch } from "../lib/api";
import { formatClientError } from "../lib/errors";

const SKIP_ACTIONS: Array<{ action: ManualExecutionAction; label: string }> = [
  { action: "SKIPPED", label: "I skipped this trade" },
  { action: "ENTERED_LATE", label: "I entered late" },
  { action: "INCORRECT_SIZE", label: "Incorrect position size" },
  { action: "SPREAD_TOO_HIGH", label: "Spread too high" },
  { action: "NEWS_RISK", label: "News risk" },
  { action: "SETUP_NOT_CLEAR", label: "Setup not clear" },
  { action: "OTHER", label: "Other" }
];

interface Props {
  setup: SetupRecord;
  risk: ManualRiskSettings;
  ackRequired: boolean;
  disabled?: boolean;
  onSaved: (setup: SetupRecord) => void;
  save: (setupId: string, patch: ManualExecutionPatch) => Promise<SetupRecord>;
}

export function ManualTradeActions({
  setup,
  risk,
  ackRequired,
  disabled,
  onSaved,
  save
}: Props) {
  const [mode, setMode] = useState<"menu" | "enter" | "skip">("menu");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState(
    setup.levels.entryPrice != null ? String(setup.levels.entryPrice) : ""
  );
  const [size, setSize] = useState("");
  const [broker, setBroker] = useState("IG");
  const [cashRisk, setCashRisk] = useState(String(risk.maxCashRiskPerTrade));
  const [stop, setStop] = useState(setup.levels.stopLoss != null ? String(setup.levels.stopLoss) : "");
  const [tp1, setTp1] = useState(setup.levels.tp1 != null ? String(setup.levels.tp1) : "");
  const [tp2, setTp2] = useState(setup.levels.tp2 != null ? String(setup.levels.tp2) : "");
  const [tp3, setTp3] = useState(setup.levels.tp3 != null ? String(setup.levels.tp3) : "");
  const [notes, setNotes] = useState("");
  const [screenshotRef, setScreenshotRef] = useState("");
  const [skipAction, setSkipAction] = useState<ManualExecutionAction>("SKIPPED");
  const [skipReason, setSkipReason] = useState("");

  if (setup.environment !== "LIVE") {
    return (
      <section className="card" data-testid="manual-trade-test-note">
        <h2 className="section-title">Manual journal</h2>
        <p className="muted">Manual trade journal applies to LIVE setups only.</p>
      </section>
    );
  }

  if (setup.manualExecution) {
    return (
      <section className="card" data-testid="manual-trade-recorded">
        <h2 className="section-title">Manual journal</h2>
        <p>
          Recorded: <strong>{setup.manualExecution.action.replaceAll("_", " ")}</strong>
        </p>
        {setup.manualExecution.actualEntryPrice != null && (
          <p className="muted">Entry {setup.manualExecution.actualEntryPrice}</p>
        )}
        {setup.manualExecution.actualPnl != null && (
          <p className="muted">P/L {setup.manualExecution.actualPnl}</p>
        )}
        <p className="muted">
          System outcome remains unchanged ({setup.outcome.rawResolution}).
        </p>
      </section>
    );
  }

  const locked = disabled || ackRequired;

  const submitEnter = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await save(setup.setupId, {
        action: "ENTERED",
        actualEntryPrice: entry ? Number(entry) : undefined,
        positionSize: size ? Number(size) : undefined,
        broker: broker || undefined,
        tradedAt: new Date().toISOString(),
        cashRiskIntended: cashRisk ? Number(cashRisk) : undefined,
        actualStop: stop ? Number(stop) : undefined,
        actualTp1: tp1 ? Number(tp1) : undefined,
        actualTp2: tp2 ? Number(tp2) : undefined,
        actualTp3: tp3 ? Number(tp3) : undefined,
        notes: notes || undefined,
        screenshotRef: screenshotRef || undefined
      });
      onSaved(updated);
      setMode("menu");
    } catch (err) {
      setError(formatClientError(err, "Failed to save manual entry"));
    } finally {
      setBusy(false);
    }
  };

  const submitSkip = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await save(setup.setupId, {
        action: skipAction,
        skipReason: skipReason || undefined,
        notes: notes || undefined
      });
      onSaved(updated);
      setMode("menu");
    } catch (err) {
      setError(formatClientError(err, "Failed to save skip reason"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card manual-trade-actions" data-testid="manual-trade-actions">
      <h2 className="section-title">Manual trade journal</h2>
      <p className="muted">
        Journal only. Does not change GoldMeta’s theoretical setup outcome.
      </p>

      {ackRequired && (
        <div className="banner stale" role="status">
          Acknowledge LIVE forward testing above before using journal buttons.
        </div>
      )}

      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      {mode === "menu" && (
        <div className="btn-stack">
          <button
            type="button"
            className="btn primary"
            disabled={locked || busy}
            onClick={() => setMode("enter")}
          >
            I entered this trade
          </button>
          <button
            type="button"
            className="btn"
            disabled={locked || busy}
            onClick={() => setMode("skip")}
          >
            Skip / other reason…
          </button>
        </div>
      )}

      {mode === "enter" && (
        <div className="form-grid">
          <label className="field">
            <span>Actual entry</span>
            <input type="number" inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} />
          </label>
          <label className="field">
            <span>Position size</span>
            <input type="number" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} />
          </label>
          <label className="field">
            <span>Broker</span>
            <input type="text" value={broker} onChange={(e) => setBroker(e.target.value)} />
          </label>
          <label className="field">
            <span>Cash risk intended</span>
            <input type="number" inputMode="decimal" value={cashRisk} onChange={(e) => setCashRisk(e.target.value)} />
          </label>
          <label className="field">
            <span>Actual stop</span>
            <input type="number" inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} />
          </label>
          <label className="field">
            <span>TP1</span>
            <input type="number" inputMode="decimal" value={tp1} onChange={(e) => setTp1(e.target.value)} />
          </label>
          <label className="field">
            <span>TP2</span>
            <input type="number" inputMode="decimal" value={tp2} onChange={(e) => setTp2(e.target.value)} />
          </label>
          <label className="field">
            <span>TP3</span>
            <input type="number" inputMode="decimal" value={tp3} onChange={(e) => setTp3(e.target.value)} />
          </label>
          <label className="field full">
            <span>Screenshot / note ref</span>
            <input type="text" value={screenshotRef} onChange={(e) => setScreenshotRef(e.target.value)} />
          </label>
          <label className="field full">
            <span>Notes</span>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="btn-stack full">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void submitEnter()}>
              Save entry journal
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setMode("menu")}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "skip" && (
        <div className="form-grid">
          <label className="field full">
            <span>Reason</span>
            <select
              value={skipAction}
              onChange={(e) => setSkipAction(e.target.value as ManualExecutionAction)}
            >
              {SKIP_ACTIONS.map((a) => (
                <option key={a.action} value={a.action}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field full">
            <span>Detail</span>
            <textarea rows={3} value={skipReason} onChange={(e) => setSkipReason(e.target.value)} />
          </label>
          <div className="btn-stack full">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void submitSkip()}>
              Save reason
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setMode("menu")}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
