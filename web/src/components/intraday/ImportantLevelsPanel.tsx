import { useEffect, useId, useRef, useState } from "react";
import type { ImportantLevel } from "../../types/intradayPlan";
import { fmtDistance, fmtPrice, kindPlain } from "../../lib/intradayFormat";

type Props = {
  levels: ImportantLevel[];
  allLevels: ImportantLevel[];
};

function LevelDetail({
  level,
  nextLevel,
  onClose
}: {
  level: ImportantLevel;
  nextLevel: ImportantLevel | null;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, [level.id]);

  const priceLabel =
    level.zoneLow != null && level.zoneHigh != null
      ? `${fmtPrice(level.zoneLow)}–${fmtPrice(level.zoneHigh)}`
      : fmtPrice(level.price);

  return (
    <div
      className="gm-level-detail"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-testid={`level-detail-${level.id}`}
    >
      <div className="gm-level-detail-head">
        <h3 id={titleId}>{priceLabel}</h3>
        <button
          ref={closeRef}
          type="button"
          className="gm-btn-outline gm-level-close"
          onClick={onClose}
          data-testid="level-detail-close"
        >
          Close
        </button>
      </div>

      <section>
        <h4>What it is</h4>
        <p>
          {kindPlain(level.kind)} · {level.strength.toLowerCase()} ·{" "}
          {level.side === "UPSIDE" ? "above price" : "below price"}
        </p>
      </section>
      <section>
        <h4>Why it matters</h4>
        <p>{level.shortMeaning}</p>
      </section>
      <section>
        <h4>Evidence behind this level</h4>
        <ul data-testid="level-evidence">
          {level.reasons.map((r) => (
            <li key={`${r.code}-${r.label}`}>
              <strong>{r.label}</strong>
              {r.sourceTimeframe ? ` (${r.sourceTimeframe})` : ""}: {r.explanation}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h4>What to watch</h4>
        <ul>
          {level.whatToWatch.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </section>
      <section>
        <h4>What happens if it holds</h4>
        <p>{level.ifHolds}</p>
      </section>
      <section>
        <h4>What happens if it breaks</h4>
        <p>{level.ifBreaks}</p>
      </section>
      <section>
        <h4>Confirmation required</h4>
        <ul>
          {level.confirmationRequired.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>
      <section>
        <h4>Next level / target</h4>
        <p>
          {nextLevel
            ? `${fmtPrice(nextLevel.price)} · ${nextLevel.shortMeaning}`
            : "No next verified level linked."}
        </p>
      </section>
      <section>
        <h4>Risk warning</h4>
        <p>{level.riskWarning}</p>
      </section>
      <section>
        <h4>Simple explanation</h4>
        <p>{level.simpleExplanation}</p>
      </section>
    </div>
  );
}

export function ImportantLevelsPanel({ levels, allLevels }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openLevel = levels.find((l) => l.id === openId) ?? null;
  const nextLevel =
    openLevel?.nextLevelId != null
      ? allLevels.find((l) => l.id === openLevel.nextLevelId) ?? null
      : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!levels.length) {
    return (
      <section className="gm-intra-levels" data-testid="important-levels-panel">
        <h2 className="gm-section-title">Important levels</h2>
        <p className="gm-meta" data-testid="no-important-levels">
          No explained important levels yet. GoldMeta only labels a level important when it can cite
          structured evidence (POC/VAH/VAL, session high/low, plan levels, ATR projection, etc.).
        </p>
      </section>
    );
  }

  return (
    <section className="gm-intra-levels" data-testid="important-levels-panel" aria-label="Important price levels">
      <h2 className="gm-section-title">Important levels</h2>
      <p className="gm-meta">Tap a level to understand what it is and what to watch.</p>
      <ul className="gm-level-list">
        {levels.map((level) => {
          const expanded = openId === level.id;
          const priceLabel =
            level.zoneLow != null && level.zoneHigh != null
              ? `${fmtPrice(level.zoneLow)}–${fmtPrice(level.zoneHigh)}`
              : fmtPrice(level.price);
          return (
            <li key={level.id}>
              <button
                type="button"
                className={`gm-level-card side-${level.side.toLowerCase()}`}
                data-testid={`level-card-${level.id}`}
                aria-expanded={expanded}
                aria-controls={`level-panel-${level.id}`}
                onClick={() => setOpenId(expanded ? null : level.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpenId(expanded ? null : level.id);
                  }
                }}
              >
                <span className="gm-level-price">{priceLabel}</span>
                <span className="gm-level-meta">
                  {kindPlain(level.kind)} · {level.strength.toLowerCase()} ·{" "}
                  {fmtDistance(level.distancePoints)}
                </span>
                <span className="gm-level-meaning">{level.shortMeaning}</span>
                <span className="gm-level-cta">{expanded ? "Hide details" : "Tap to understand"}</span>
              </button>
              {expanded && (
                <div id={`level-panel-${level.id}`}>
                  <LevelDetail
                    level={level}
                    nextLevel={nextLevel}
                    onClose={() => setOpenId(null)}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
