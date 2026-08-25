import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp
} from "lightweight-charts";
import { Maximize2, Minimize2, Scan } from "lucide-react";
import { useXauusdCandles } from "../../hooks/useXauusdCandles";
import { CHART_TIMEFRAMES, timeframeLabel, type ChartTimeframe } from "../../lib/xauusdCandles";
import { fmtPrice } from "../../lib/intradayFormat";
import { useShellQuote } from "../../lib/quoteContext";

export type TradeChartLevel = {
  id: string;
  label: string;
  price: number | null | undefined;
  tone?: "buy" | "sell" | "gold" | "info" | "muted";
  emphasis?: "primary" | "secondary";
};

const LINE_COLOR: Record<NonNullable<TradeChartLevel["tone"]>, string> = {
  buy: "#22c55e",
  sell: "#ef4444",
  gold: "#d7b45a",
  info: "#60a5fa",
  muted: "#94a3b8"
};

function candleSourceLabel(source: string | null): string {
  if (!source) return "cTrader market history";
  if (/CTRADER/i.test(source)) return "cTrader market history";
  return source.replace(/_/g, " ").toLowerCase();
}

export function LiveTradeChart({
  title = "Live Gold chart",
  subtitle,
  levels,
  defaultTimeframe = "M5",
  currentPrice,
  marketClosed = false,
  analysisSourceLabel
}: {
  title?: string;
  subtitle?: string | null;
  levels: TradeChartLevel[];
  defaultTimeframe?: ChartTimeframe;
  currentPrice?: number | null;
  marketClosed?: boolean;
  analysisSourceLabel?: string | null;
}) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>(defaultTimeframe);
  const [fullscreen, setFullscreen] = useState(false);
  const { bars, loading, error, source } = useXauusdCandles(timeframe, true);
  const { quote } = useShellQuote();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  const live = currentPrice ?? quote?.price ?? null;
  const effectiveLevels = useMemo(() => {
    const finite = levels.filter((level) => level.price != null && Number.isFinite(level.price));
    if (live != null && Number.isFinite(live)) {
      finite.push({ id: "live", label: "LIVE", price: live, tone: "info", emphasis: "primary" });
    }
    return finite;
  }, [levels, live]);

  const candles = useMemo(
    () =>
      bars
        .filter(
          (bar) =>
            Number.isFinite(bar.time) &&
            Number.isFinite(bar.open) &&
            Number.isFinite(bar.high) &&
            Number.isFinite(bar.low) &&
            Number.isFinite(bar.close)
        )
        .map((bar) => ({
          time: bar.time as UTCTimestamp,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close
        }))
        .sort((a, b) => Number(a.time) - Number(b.time)),
    [bars]
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = createChart(host, {
      width: host.clientWidth || 320,
      height: fullscreen ? Math.max(window.innerHeight - 150, 420) : 390,
      layout: {
        background: { type: ColorType.Solid, color: "#07111f" },
        textColor: "#9fb0c5",
        fontSize: 11
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,.07)" },
        horzLines: { color: "rgba(148,163,184,.07)" }
      },
      rightPriceScale: {
        borderColor: "rgba(148,163,184,.16)",
        scaleMargins: { top: 0.08, bottom: 0.08 }
      },
      timeScale: {
        borderColor: "rgba(148,163,184,.16)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 8
      },
      crosshair: { mode: 1 },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: fullscreen
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true
      }
    });
    const series = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444"
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const resize = () => {
      if (!hostRef.current) return;
      chart.applyOptions({
        width: hostRef.current.clientWidth || 320,
        height: fullscreen ? Math.max(window.innerHeight - 150, 420) : 390
      });
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(host);
    window.addEventListener("resize", resize);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current = [];
    };
  }, [fullscreen]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || candles.length === 0) return;
    series.setData(candles);
    chart.timeScale().fitContent();
  }, [candles, timeframe, fullscreen]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const line of priceLinesRef.current) series.removePriceLine(line);
    priceLinesRef.current = effectiveLevels.map((level) =>
      series.createPriceLine({
        price: level.price as number,
        color: LINE_COLOR[level.tone ?? "muted"],
        lineWidth: level.emphasis === "primary" ? 2 : 1,
        lineStyle: level.emphasis === "primary" ? 0 : 2,
        axisLabelVisible: true,
        title: level.label
      })
    );
  }, [effectiveLevels, candles.length, fullscreen]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    if (fullscreen) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [fullscreen]);

  const fit = () => chartRef.current?.timeScale().fitContent();

  return (
    <section className={`gm26-live-chart${fullscreen ? " is-fullscreen" : ""}`} data-testid="gm26-live-trade-chart">
      <header className="gm26-live-chart__head">
        <div>
          <span className="gm26-eyebrow">XAUUSD · {timeframeLabel(timeframe)}</span>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
          <small className="gm26-live-chart__source">
            Candles: {candleSourceLabel(source)}{analysisSourceLabel ? ` · Analysis: ${analysisSourceLabel}` : ""}
          </small>
        </div>
        <div className="gm26-live-chart__quote">
          <strong>{live != null ? fmtPrice(live) : "—"}</strong>
          <span className={marketClosed ? "is-closed" : "is-live"}>{marketClosed ? "MARKET CLOSED" : "LIVE"}</span>
        </div>
      </header>

      <div className="gm26-live-chart__toolbar">
        <div className="gm26-live-chart__tfs" role="tablist" aria-label="Chart timeframe">
          {CHART_TIMEFRAMES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={timeframe === item.id}
              className={timeframe === item.id ? "is-active" : undefined}
              onClick={() => setTimeframe(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="gm26-live-chart__actions">
          <button type="button" onClick={fit} aria-label="Fit chart">
            <Scan size={16} aria-hidden /> Fit
          </button>
          <button type="button" onClick={() => setFullscreen((value) => !value)} aria-label={fullscreen ? "Exit full screen" : "Full screen chart"}>
            {fullscreen ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}
            {fullscreen ? "Exit" : "Full"}
          </button>
        </div>
      </div>

      <div ref={hostRef} className="gm26-live-chart__host" />

      {candles.length === 0 && loading ? <p className="gm26-chart-status">Loading live chart…</p> : null}
      {candles.length === 0 && !loading && error ? <p className="gm26-chart-status">Chart history temporarily unavailable.</p> : null}

      <div className="gm26-live-chart__legend">
        {effectiveLevels.map((level) => (
          <span key={`${level.id}-${level.label}`} data-tone={level.tone ?? "muted"}>
            <i aria-hidden />
            {level.label} {fmtPrice(level.price)}
          </span>
        ))}
      </div>
    </section>
  );
}
