import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp
} from "lightweight-charts";
import { useXauusdCandles } from "../../hooks/useXauusdCandles";
import {
  CHART_TIMEFRAMES,
  timeframeLabel,
  type ChartTimeframe
} from "../../lib/xauusdCandles";
import { fmtPrice } from "../../lib/intradayFormat";

type LevelOverlays = {
  resistance?: number | null;
  vah?: number | null;
  poc?: number | null;
  val?: number | null;
  support?: number | null;
  currentPrice?: number | null;
};

type Props = LevelOverlays & {
  marketClosed?: boolean;
  defaultTimeframe?: ChartTimeframe;
};

type LineSpec = {
  key: string;
  price: number;
  color: string;
  title: string;
  lineWidth?: number;
  lineStyle?: number;
};

function buildLines(levels: LevelOverlays): LineSpec[] {
  const out: LineSpec[] = [];
  const push = (
    key: string,
    price: number | null | undefined,
    color: string,
    title: string,
    lineWidth = 1,
    lineStyle = 2
  ) => {
    if (price == null || !Number.isFinite(price)) return;
    out.push({ key, price, color, title, lineWidth, lineStyle });
  };
  push("resistance", levels.resistance, "#dc2626", "Resistance", 1, 2);
  push("vah", levels.vah, "#d4a017", "VAH", 1, 2);
  push("poc", levels.poc, "#0f2748", "POC", 2, 0);
  push("val", levels.val, "#d4a017", "VAL", 1, 2);
  push("support", levels.support, "#16a34a", "Support", 1, 2);
  push("current", levels.currentPrice, "#2563eb", "Price", 2, 0);
  return out;
}

export function XauusdChartCard({
  resistance = null,
  vah = null,
  poc = null,
  val = null,
  support = null,
  currentPrice = null,
  marketClosed = false,
  defaultTimeframe = "M15"
}: Props) {
  const [tf, setTf] = useState<ChartTimeframe>(defaultTimeframe);
  const { bars, loading, error } = useXauusdCandles(tf, true);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const pendingBarsRef = useRef<
    Array<{ time: UTCTimestamp; open: number; high: number; low: number; close: number }>
  >([]);
  const [chartReady, setChartReady] = useState(0);

  const candleData = useMemo(() => {
    // Deduplicate / sort ascending — Lightweight Charts rejects out-of-order bars.
    const mapped = bars
      .filter(
        (b) =>
          Number.isFinite(b.time) &&
          Number.isFinite(b.open) &&
          Number.isFinite(b.high) &&
          Number.isFinite(b.low) &&
          Number.isFinite(b.close)
      )
      .map((b) => ({
        time: b.time as UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close
      }))
      .sort((a, b) => Number(a.time) - Number(b.time));
    const out: typeof mapped = [];
    for (const bar of mapped) {
      if (out.length && Number(out[out.length - 1]!.time) === Number(bar.time)) {
        out[out.length - 1] = bar;
      } else {
        out.push(bar);
      }
    }
    return out;
  }, [bars]);

  useEffect(() => {
    pendingBarsRef.current = candleData;
  }, [candleData]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    // jsdom / restricted environments cannot host canvas charts.
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    let chart: IChartApi | null = null;
    let ro: ResizeObserver | null = null;
    try {
      chart = createChart(el, {
        height: 280,
        layout: {
          background: { type: ColorType.Solid, color: "#ffffff" },
          textColor: "#5b6b82",
          fontSize: 11
        },
        grid: {
          vertLines: { color: "rgba(15, 39, 72, 0.06)" },
          horzLines: { color: "rgba(15, 39, 72, 0.06)" }
        },
        rightPriceScale: {
          borderColor: "rgba(15, 39, 72, 0.12)",
          scaleMargins: { top: 0.08, bottom: 0.08 }
        },
        timeScale: {
          borderColor: "rgba(15, 39, 72, 0.12)",
          timeVisible: true,
          secondsVisible: false
        },
        crosshair: {
          mode: 1
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true },
        handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true }
      });
      const series = chart.addCandlestickSeries({
        upColor: "#16a34a",
        downColor: "#dc2626",
        borderUpColor: "#16a34a",
        borderDownColor: "#dc2626",
        wickUpColor: "#16a34a",
        wickDownColor: "#dc2626"
      });
      chartRef.current = chart;
      seriesRef.current = series;
      // Apply any bars that arrived before the chart finished mounting.
      if (pendingBarsRef.current.length) {
        series.setData(pendingBarsRef.current);
        chart.timeScale().fitContent();
      }
      setChartReady((n) => n + 1);

      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => {
          if (!hostRef.current || !chart) return;
          chart.applyOptions({ width: hostRef.current.clientWidth });
        });
        ro.observe(el);
      }
      chart.applyOptions({ width: el.clientWidth || 320 });
    } catch {
      chartRef.current = null;
      seriesRef.current = null;
    }

    return () => {
      ro?.disconnect();
      try {
        chart?.remove();
      } catch {
        /* ignore */
      }
      chartRef.current = null;
      seriesRef.current = null;
      linesRef.current = [];
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    if (candleData.length) {
      series.setData(candleData);
      chart.timeScale().fitContent();
    }
  }, [candleData, chartReady]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const line of linesRef.current) {
      series.removePriceLine(line);
    }
    linesRef.current = [];
    const specs = buildLines({
      resistance,
      vah,
      poc,
      val,
      support,
      currentPrice
    });
    for (const spec of specs) {
      linesRef.current.push(
        series.createPriceLine({
          price: spec.price,
          color: spec.color,
          lineWidth: (spec.lineWidth ?? 1) as 1 | 2 | 3 | 4,
          lineStyle: spec.lineStyle ?? 2,
          axisLabelVisible: true,
          title: spec.title
        })
      );
    }
  }, [resistance, vah, poc, val, support, currentPrice, candleData.length, chartReady]);

  const hasBars = candleData.length > 0;

  return (
    <section
      className="gm-xau-chart-card"
      data-testid="plan-market-card"
      aria-label="XAUUSD candlestick chart"
    >
      <div className="gm-xau-chart-card__head">
        <div className="gm-xau-chart-card__title">
          <strong>XAUUSD</strong>
          <span data-testid="chart-timeframe-label">{timeframeLabel(tf)}</span>
          {marketClosed ? (
            <span className="gm-xau-chart-closed" data-testid="chart-market-closed">
              MARKET CLOSED
            </span>
          ) : null}
        </div>
        <div className="gm-xau-chart-tfs" role="tablist" aria-label="Chart timeframe">
          {CHART_TIMEFRAMES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tf === item.id}
              className={tf === item.id ? "is-active" : undefined}
              data-testid={`chart-tf-${item.label.toLowerCase()}`}
              onClick={() => setTf(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={hostRef}
        className={`gm-xau-chart-host${!hasBars ? " is-empty" : ""}`}
        data-testid="xauusd-chart-host"
        data-has-bars={hasBars ? "1" : "0"}
      />

      {!hasBars && loading ? (
        <p className="gm-meta gm-xau-chart-status" data-testid="chart-loading">
          Loading chart…
        </p>
      ) : null}
      {!hasBars && !loading && error ? (
        <p className="gm-meta gm-xau-chart-status" data-testid="chart-error">
          Chart history temporarily unavailable
        </p>
      ) : null}

      <div className="gm-xau-chart-legend" data-testid="chart-level-legend">
        {[
          { k: "Resistance", v: resistance, c: "#dc2626" },
          { k: "VAH", v: vah, c: "#d4a017" },
          { k: "POC", v: poc, c: "#0f2748" },
          { k: "VAL", v: val, c: "#d4a017" },
          { k: "Support", v: support, c: "#16a34a" },
          { k: "Price", v: currentPrice, c: "#2563eb" }
        ]
          .filter((row) => row.v != null && Number.isFinite(row.v))
          .map((row) => (
            <span key={row.k} style={{ ["--lvl" as string]: row.c }}>
              {row.k} {fmtPrice(row.v)}
            </span>
          ))}
      </div>
    </section>
  );
}
