import { useState } from "react";
import { buildMarketStory, type MarketStoryInput } from "../../lib/marketStory";

/** Concise deterministic Market Story from verified data only. */
export function MarketStoryCard(props: MarketStoryInput) {
  const [showEvidence, setShowEvidence] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const result = buildMarketStory(props);
  const long = Boolean(result.story && result.story.split(/\s+/).length > 55);

  return (
    <section className="gm-section gm-market-story" data-testid="market-story">
      <div className="gm-section-head">
        <h2 className="gm-section-title">Market Story</h2>
      </div>
      {result.insufficient || !result.story ? (
        <p className="gm-meta" role="status" data-testid="market-story-insufficient">
          Insufficient verified data to create a market summary.
        </p>
      ) : (
        <>
          <p
            className={`gm-story-body${long && !expanded ? " is-clamped" : ""}`}
            data-testid="market-story-body"
          >
            {result.story}
          </p>
          {long && (
            <button
              type="button"
              className="gm-linkish gm-story-more"
              data-testid="market-story-more"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Show less" : "Read more"}
            </button>
          )}
        </>
      )}
      {result.evidence.length > 0 && (
        <button
          type="button"
          className="gm-linkish"
          data-testid="market-story-evidence-toggle"
          onClick={() => setShowEvidence((v) => !v)}
        >
          {showEvidence ? "Hide evidence" : "View evidence"}
        </button>
      )}
      {showEvidence && (
        <ul className="list compact gm-story-evidence" data-testid="market-story-evidence">
          {result.evidence.map((e) => (
            <li key={e}>
              <code>{e}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
