import { useState } from "react";

type Props = {
  brokerName: string;
  accountMasked: string;
  currency: string;
  riskPerTrade: number;
  maxDailyLoss: number;
  maxTradesPerDay: number;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (phrase: string) => Promise<void>;
};

/**
 * Live AutoTrade confirmation — unmistakable real-money gate.
 * Does not enable order submission by itself.
 */
export function LiveActivationConfirm({
  brokerName,
  accountMasked,
  currency,
  riskPerTrade,
  maxDailyLoss,
  maxTradesPerDay,
  busy,
  onCancel,
  onConfirm
}: Props) {
  const [phrase, setPhrase] = useState("");
  const [accountOk, setAccountOk] = useState(false);
  const [settingsOk, setSettingsOk] = useState(false);
  const money = (n: number) =>
    new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency: currency || "EUR",
      maximumFractionDigits: 2
    }).format(n);

  const canSubmit =
    accountOk && settingsOk && phrase.trim().toUpperCase() === "ENABLE LIVE" && !busy;

  return (
    <div
      className="gm-live-confirm"
      data-testid="autotrade-live-confirm"
      role="dialog"
      aria-labelledby="live-confirm-title"
    >
      <h2 id="live-confirm-title">Live AutoTrade uses real funds</h2>
      <p className="gm-meta">
        This mode places trades with real money when order submission is later approved. Demo
        AutoTrade never turns this on automatically.
      </p>
      <dl className="gm-live-confirm-summary">
        <div>
          <dt>Selected broker</dt>
          <dd>{brokerName || "—"}</dd>
        </div>
        <div>
          <dt>Selected account</dt>
          <dd>{accountMasked || "—"}</dd>
        </div>
        <div>
          <dt>Account currency</dt>
          <dd>{currency || "—"}</dd>
        </div>
        <div>
          <dt>Risk per trade</dt>
          <dd>{money(riskPerTrade)}</dd>
        </div>
        <div>
          <dt>Maximum daily loss</dt>
          <dd>{money(maxDailyLoss)}</dd>
        </div>
        <div>
          <dt>Maximum trades per day</dt>
          <dd>{maxTradesPerDay}</dd>
        </div>
      </dl>
      <label className="gm-live-confirm-check">
        <input
          type="checkbox"
          checked={accountOk}
          onChange={(e) => setAccountOk(e.target.checked)}
        />
        I confirm this Live broker account
      </label>
      <label className="gm-live-confirm-check">
        <input
          type="checkbox"
          checked={settingsOk}
          onChange={(e) => setSettingsOk(e.target.checked)}
        />
        I have reviewed the Live AutoTrade settings
      </label>
      <label className="gm-live-confirm-phrase">
        Type ENABLE LIVE to confirm
        <input
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          data-testid="autotrade-live-phrase"
        />
      </label>
      <div className="gm-live-confirm-actions">
        <button type="button" className="gm-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="gm-btn gm-btn-danger"
          data-testid="autotrade-enable-live-auto"
          disabled={!canSubmit}
          onClick={() => void onConfirm(phrase)}
        >
          Enable Live AutoTrade
        </button>
      </div>
      <p className="gm-meta">
        Preview phase: confirmation is stored, but order submission and AutoTrade execution stay
        OFF.
      </p>
    </div>
  );
}
