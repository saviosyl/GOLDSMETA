import type { ReactNode } from "react";
import type { LessonDiagramId } from "../../lib/learn/types";

/** Small educational SVGs in GoldMeta navy/gold — decorative, info is also in text. */
export function LearnDiagram({ id }: { id: LessonDiagramId }) {
  if (!id) return null;
  switch (id) {
    case "candle":
      return <CandleDiagram />;
    case "support-resistance":
      return <SupportResistanceDiagram />;
    case "market-structure":
      return <MarketStructureDiagram />;
    case "value-area":
      return <ValueAreaDiagram />;
    case "risk-reward":
      return <RiskRewardDiagram />;
    case "buy-sell-wait":
      return <BuySellWaitDiagram />;
    case "sessions":
      return <SessionsDiagram />;
    case "score":
      return <ScoreDiagram />;
    default:
      return null;
  }
}

function Frame({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <figure className="gm-learn-diagram" data-testid="learn-diagram" aria-label={title}>
      <figcaption className="gm-learn-diagram-caption">{title}</figcaption>
      {children}
    </figure>
  );
}

function CandleDiagram() {
  return (
    <Frame title="Green candle and red candle">
      <svg viewBox="0 0 280 140" className="gm-learn-svg" role="img">
        <text x="70" y="18" className="gm-learn-svg-label">
          Green
        </text>
        <line x1="70" y1="28" x2="70" y2="120" stroke="#20a85b" strokeWidth="2" />
        <rect x="58" y="45" width="24" height="50" rx="3" fill="#20a85b" />
        <text x="58" y="138" className="gm-learn-svg-tiny">
          open→close up
        </text>

        <text x="200" y="18" className="gm-learn-svg-label">
          Red
        </text>
        <line x1="200" y1="28" x2="200" y2="120" stroke="#e43d3d" strokeWidth="2" />
        <rect x="188" y="45" width="24" height="50" rx="3" fill="#e43d3d" />
        <text x="178" y="138" className="gm-learn-svg-tiny">
          open→close down
        </text>
      </svg>
    </Frame>
  );
}

function SupportResistanceDiagram() {
  return (
    <Frame title="Support floor and resistance ceiling">
      <svg viewBox="0 0 280 140" className="gm-learn-svg" role="img">
        <line x1="24" y1="36" x2="256" y2="36" stroke="#c98700" strokeWidth="3" strokeDasharray="6 4" />
        <text x="24" y="28" className="gm-learn-svg-label">
          Resistance (ceiling)
        </text>
        <path
          d="M40 100 C80 40, 120 110, 160 55 S240 90, 250 70"
          fill="none"
          stroke="#0a2345"
          strokeWidth="2.5"
        />
        <line x1="24" y1="118" x2="256" y2="118" stroke="#0a2345" strokeWidth="3" strokeDasharray="6 4" />
        <text x="24" y="136" className="gm-learn-svg-label">
          Support (floor)
        </text>
      </svg>
    </Frame>
  );
}

function MarketStructureDiagram() {
  return (
    <Frame title="Up stairs, down stairs, sideways">
      <svg viewBox="0 0 280 120" className="gm-learn-svg" role="img">
        <polyline
          points="10,90 35,70 50,78 75,50 90,58 115,30"
          fill="none"
          stroke="#20a85b"
          strokeWidth="2.5"
        />
        <text x="10" y="110" className="gm-learn-svg-tiny">
          Higher highs
        </text>
        <polyline
          points="140,30 165,50 180,42 205,70 220,62 255,95"
          fill="none"
          stroke="#e43d3d"
          strokeWidth="2.5"
        />
        <text x="150" y="110" className="gm-learn-svg-tiny">
          Lower highs
        </text>
      </svg>
    </Frame>
  );
}

function ValueAreaDiagram() {
  return (
    <Frame title="Busy value area (VAL · POC · VAH)">
      <svg viewBox="0 0 280 140" className="gm-learn-svg" role="img">
        <rect x="80" y="28" width="120" height="84" rx="8" fill="#fff7e6" stroke="#e2a400" strokeWidth="2" />
        <line x1="80" y1="70" x2="200" y2="70" stroke="#0a2345" strokeWidth="2" />
        <text x="210" y="34" className="gm-learn-svg-label">
          VAH
        </text>
        <text x="210" y="74" className="gm-learn-svg-label">
          POC
        </text>
        <text x="210" y="112" className="gm-learn-svg-label">
          VAL
        </text>
        <text x="100" y="78" className="gm-learn-svg-tiny">
          busiest zone
        </text>
      </svg>
    </Frame>
  );
}

function RiskRewardDiagram() {
  return (
    <Frame title="Risk versus reward">
      <svg viewBox="0 0 280 140" className="gm-learn-svg" role="img">
        <line x1="40" y1="70" x2="240" y2="70" stroke="#cfd8e6" strokeWidth="2" />
        <circle cx="100" cy="70" r="7" fill="#0a2345" />
        <text x="88" y="58" className="gm-learn-svg-tiny">
          Entry
        </text>
        <circle cx="60" cy="70" r="6" fill="#e43d3d" />
        <text x="42" y="92" className="gm-learn-svg-tiny">
          Stop
        </text>
        <circle cx="180" cy="70" r="6" fill="#20a85b" />
        <text x="168" y="58" className="gm-learn-svg-tiny">
          TP1
        </text>
        <circle cx="230" cy="70" r="6" fill="#20a85b" />
        <text x="218" y="92" className="gm-learn-svg-tiny">
          TP2
        </text>
        <text x="70" y="120" className="gm-learn-svg-label">
          Risk 1 → aim for 2+
        </text>
      </svg>
    </Frame>
  );
}

function BuySellWaitDiagram() {
  return (
    <Frame title="BUY · SELL · WAIT">
      <div className="gm-learn-bsw" role="group" aria-label="BUY SELL WAIT cards">
        <div className="gm-learn-bsw-card gm-learn-bsw-buy">
          <strong>BUY</strong>
          <span>Up conditions</span>
        </div>
        <div className="gm-learn-bsw-card gm-learn-bsw-sell">
          <strong>SELL</strong>
          <span>Down conditions</span>
        </div>
        <div className="gm-learn-bsw-card gm-learn-bsw-wait">
          <strong>WAIT</strong>
          <span>Not ready yet</span>
        </div>
      </div>
    </Frame>
  );
}

function SessionsDiagram() {
  return (
    <Frame title="World sessions">
      <div className="gm-learn-sessions" role="list">
        <div className="gm-learn-session" role="listitem">
          <strong>Asia</strong>
          <span>Earlier hours</span>
        </div>
        <div className="gm-learn-session" role="listitem">
          <strong>London</strong>
          <span>Europe active</span>
        </div>
        <div className="gm-learn-session" role="listitem">
          <strong>New York</strong>
          <span>America active</span>
        </div>
      </div>
    </Frame>
  );
}

function ScoreDiagram() {
  return (
    <Frame title="Score is quality — not win chance">
      <div className="gm-learn-score-callout" data-testid="learn-score-warning">
        <div className="gm-learn-score-ring" aria-hidden>
          80
        </div>
        <p>
          <strong>80 / 100 does NOT mean 80% chance of profit.</strong>
          <br />
          It only describes setup quality.
        </p>
      </div>
    </Frame>
  );
}
