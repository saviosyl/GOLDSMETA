type Props = {
  trendBias?: string | null;
  volatility?: string | null;
  newsImpact?: string | null;
};

function pretty(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function PremiumInsightStrip({ trendBias, volatility, newsImpact }: Props) {
  const bias = pretty(trendBias, "Neutral");
  const vol = pretty(volatility, "Moderate");
  const news = pretty(newsImpact, "Low");

  return (
    <div className="gm-premium-insight-strip" data-testid="premium-insight-strip">
      <div>
        <span className="gm-label">Trend Bias</span>
        <strong data-testid="insight-trend">{bias}</strong>
      </div>
      <div>
        <span className="gm-label">Volatility</span>
        <strong data-testid="insight-volatility" className="tone-amber">
          {vol}
        </strong>
      </div>
      <div>
        <span className="gm-label">News Impact</span>
        <strong data-testid="insight-news" className="tone-green">
          {news}
        </strong>
      </div>
    </div>
  );
}
