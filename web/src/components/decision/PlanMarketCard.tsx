import type { ReactNode } from "react";
import { Activity, ArrowDownToLine, ArrowUpToLine } from "lucide-react";
import { fmtPrice } from "../../lib/intradayFormat";

type Props = {
  livePrice?: number | null;
  vah?: number | null;
  poc?: number | null;
  val?: number | null;
  support?: number | null;
  resistance?: number | null;
};

function Cell({
  label,
  value,
  testId,
  icon
}: {
  label: string;
  value: number | null | undefined;
  testId: string;
  icon?: ReactNode;
}) {
  if (value == null || !Number.isFinite(value)) return null;
  return (
    <div data-testid={testId}>
      <span className="gm-label">
        {icon}
        {label}
      </span>
      <strong>{fmtPrice(value)}</strong>
    </div>
  );
}

/** Compact market structure card — only renders when at least one real level exists. */
export function PlanMarketCard({
  livePrice,
  vah,
  poc,
  val,
  support,
  resistance
}: Props) {
  const hasAny = [vah, poc, val, support, resistance, livePrice].some(
    (v) => v != null && Number.isFinite(v)
  );
  if (!hasAny) return null;

  return (
    <section
      className="gm-plan-market-card"
      aria-label="Market levels"
      data-testid="plan-market-card"
    >
      <div className="gm-plan-market-card__head">
        <Activity size={15} aria-hidden />
        <h2>Market levels</h2>
      </div>
      <div className="gm-plan-market-grid">
        <Cell label="Current Price" value={livePrice} testId="plan-market-price" />
        <Cell
          label="Resistance"
          value={resistance}
          testId="plan-market-resistance"
          icon={<ArrowUpToLine size={12} aria-hidden />}
        />
        <Cell label="VAH" value={vah} testId="plan-vah" />
        <Cell label="POC" value={poc} testId="plan-poc" />
        <Cell label="VAL" value={val} testId="plan-val" />
        <Cell
          label="Support"
          value={support}
          testId="plan-market-support"
          icon={<ArrowDownToLine size={12} aria-hidden />}
        />
      </div>
    </section>
  );
}
