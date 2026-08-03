import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ImportantLevel, LevelProximity } from "../../types/intradayPlan";
import { fmtPrice, fmtSignedDistance, rolePlain } from "../../lib/intradayFormat";
import { levelProgressState } from "../../lib/cockpitHelpers";

type Props = {
  levels: ImportantLevel[];
  allLevels: ImportantLevel[];
  /** When true, show nearest 3 above + 3 below even on desktop. */
  compactDefault?: boolean;
};

const NEAR_COUNT = 3;

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
  const progress = levelProgressState(level);

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
        <h4>Why it is important</h4>
        <p>{level.shortMeaning}</p>
        <p className="gm-meta">
          {rolePlain(level.roleAtCurrentPrice)} · {level.strength.toLowerCase()} · progress{" "}
          <strong data-testid={`level-progress-${level.id}`}>{progress}</strong>
        </p>
      </section>
      <section>
        <h4>Supporting evidence</h4>
        <ul data-testid="level-evidence">
          {level.reasons.map((r) => (
            <li key={`${r.code}-${r.label}`}>
              <strong>{r.label}</strong>
              {r.sourceTimeframe ? ` (${r.sourceTimeframe})` : ""}: {r.explanation}
            </li>
          ))}
        </ul>
        <p className="gm-meta">Evidence count: {level.reasons.length}</p>
      </section>
      <section>
        <h4>Bullish behaviour</h4>
        <p>{level.ifHolds}</p>
      </section>
      <section>
        <h4>Bearish behaviour</h4>
        <p>{level.ifBreaks}</p>
      </section>
      <section>
        <h4>What invalidates the level</h4>
        <p>{level.riskWarning}</p>
        <ul>
          {level.confirmationRequired.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>
      <section>
        <h4>Next level</h4>
        <p>
          {nextLevel
            ? `${fmtPrice(nextLevel.price)} · ${nextLevel.shortMeaning}`
            : "No next verified level linked."}
        </p>
      </section>
      <section>
        <h4>Simple explanation</h4>
        <p>{level.simpleExplanation}</p>
      </section>
    </div>
  );
}

function LevelGroup({
  title,
  proximity,
  levels,
  allLevels,
  openId,
  setOpenId
}: {
  title: string;
  proximity: LevelProximity;
  levels: ImportantLevel[];
  allLevels: ImportantLevel[];
  openId: string | null;
  setOpenId: (id: string | null) => void;
}) {
  if (!levels.length) return null;
  return (
    <div className="gm-level-group" data-testid={`level-group-${proximity.toLowerCase()}`}>
      <h3 className="gm-level-group-title">{title}</h3>
      <ul className="gm-level-list">
        {levels.map((level) => {
          const expanded = openId === level.id;
          const nextLevel =
            level.nextLevelId != null
              ? allLevels.find((l) => l.id === level.nextLevelId) ?? null
              : null;
          const priceLabel =
            level.zoneLow != null && level.zoneHigh != null
              ? `${fmtPrice(level.zoneLow)}–${fmtPrice(level.zoneHigh)}`
              : fmtPrice(level.price);
          const progress = levelProgressState(level);
          return (
            <li key={level.id}>
              <button
                type="button"
                className={`gm-level-card prox-${level.proximity.toLowerCase()}`}
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
                <span className="gm-level-dist" data-testid={`level-dist-${level.id}`}>
                  {fmtSignedDistance(level.distancePoints)}
                </span>
                <span className="gm-level-meta">
                  {level.kind.replace(/_/g, " ")} · {rolePlain(level.roleAtCurrentPrice)}
                </span>
                <span className="gm-level-meta">
                  {level.strength.toLowerCase()} · {level.reasons.length} evidence ·{" "}
                  <em data-testid={`level-state-${level.id}`}>{progress}</em>
                </span>
                <span className="gm-level-meaning">{level.shortMeaning}</span>
                <span className="gm-level-cta">{expanded ? "Hide details" : "Explain level"}</span>
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
    </div>
  );
}

function nearestByDistance(levels: ImportantLevel[], count: number): ImportantLevel[] {
  return [...levels]
    .sort((a, b) => Math.abs(a.distancePoints ?? 0) - Math.abs(b.distancePoints ?? 0))
    .slice(0, count);
}

export function ImportantLevelsPanel({ levels, allLevels, compactDefault = false }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const aboveAll = useMemo(() => levels.filter((l) => l.proximity === "ABOVE"), [levels]);
  const nearAll = useMemo(() => levels.filter((l) => l.proximity === "NEAR"), [levels]);
  const belowAll = useMemo(() => levels.filter((l) => l.proximity === "BELOW"), [levels]);

  const compactAbove = nearestByDistance(aboveAll, NEAR_COUNT);
  const compactBelow = nearestByDistance(belowAll, NEAR_COUNT);
  const collapsedCount =
    Math.max(0, aboveAll.length - compactAbove.length) +
    Math.max(0, belowAll.length - compactBelow.length);

  if (!levels.length) {
    return (
      <section className="gm-intra-levels gm-levels-empty" data-testid="important-levels-panel">
        <p className="gm-meta" data-testid="no-important-levels">
          No verified explained levels yet.
        </p>
      </section>
    );
  }

  const renderGroups = (above: ImportantLevel[], below: ImportantLevel[], near: ImportantLevel[]) => (
    <>
      <LevelGroup
        title="Above current price"
        proximity="ABOVE"
        levels={above}
        allLevels={allLevels}
        openId={openId}
        setOpenId={setOpenId}
      />
      <LevelGroup
        title="Near current price"
        proximity="NEAR"
        levels={near}
        allLevels={allLevels}
        openId={openId}
        setOpenId={setOpenId}
      />
      <LevelGroup
        title="Below current price"
        proximity="BELOW"
        levels={below}
        allLevels={allLevels}
        openId={openId}
        setOpenId={setOpenId}
      />
    </>
  );

  return (
    <section
      className="gm-intra-levels"
      data-testid="important-levels-panel"
      aria-label="Important price levels"
    >
      <div className="gm-section-head">
        <h2 className="gm-section-title">Important levels</h2>
        <span className="gm-meta">Nearest verified levels</span>
      </div>

      {/* Desktop / tablet */}
      <div className="gm-levels-desktop" data-testid="levels-desktop-full">
        {renderGroups(
          compactDefault && !showAll ? compactAbove : aboveAll,
          compactDefault && !showAll ? compactBelow : belowAll,
          nearAll
        )}
        {compactDefault && (collapsedCount > 0 || showAll) && (
          <button
            type="button"
            className="gm-btn-outline gm-levels-show-all"
            data-testid="levels-show-all-desktop"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Show nearest levels" : `Show all levels (${levels.length})`}
          </button>
        )}
      </div>

      {/* Mobile compact */}
      <div className="gm-levels-mobile gm-mobile-only" data-testid="levels-mobile-compact">
        {renderGroups(
          showAll ? aboveAll : compactAbove,
          showAll ? belowAll : compactBelow,
          nearAll
        )}
        {(collapsedCount > 0 || showAll) && (
          <button
            type="button"
            className="gm-btn-outline gm-levels-show-all"
            data-testid="levels-show-all"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Show nearest levels" : `Show all levels (${levels.length})`}
          </button>
        )}
      </div>
    </section>
  );
}
