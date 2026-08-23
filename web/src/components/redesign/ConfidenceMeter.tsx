type SignalTone = "BUY" | "SELL" | "WAIT";

function normalizeConfidence(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  const pct = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, pct));
}

function strengthLabel(pct: number): string {
  if (pct >= 85) return "Very strong";
  if (pct >= 75) return "Strong";
  if (pct >= 65) return "Moderate";
  if (pct >= 50) return "Weak";
  return "Low conviction";
}

export function ConfidenceMeter({
  action,
  confidence,
  compact = false
}: {
  action: SignalTone;
  confidence: number | null | undefined;
  compact?: boolean;
}) {
  const pct = normalizeConfidence(confidence);
  const band = pct >= 85 ? "very-strong" : pct >= 75 ? "strong" : pct >= 65 ? "moderate" : pct >= 50 ? "weak" : "low";

  return (
    <div
      className={`gm26-confidence gm26-confidence--${action.toLowerCase()} gm26-confidence--${band}${compact ? " is-compact" : ""}`}
      data-testid="gm26-confidence-meter"
      aria-label={`${action} confidence ${Math.round(pct)} percent, ${strengthLabel(pct)}`}
    >
      <div className="gm26-confidence__top">
        <span>Confidence</span>
        <strong>{Math.round(pct)}%</strong>
      </div>
      <div className="gm26-confidence__track" aria-hidden>
        <span className="gm26-confidence__mid" />
        <span className="gm26-confidence__fill" style={{ width: `${pct}%` }} />
        <span className="gm26-confidence__thumb" style={{ left: `${pct}%` }} />
      </div>
      <div className="gm26-confidence__scale" aria-hidden>
        <span>0</span>
        <span>50</span>
        <span>100</span>
      </div>
      <span className="gm26-confidence__label">{strengthLabel(pct)}</span>
    </div>
  );
}
