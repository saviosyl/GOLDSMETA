import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
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
import {
  CHART_TIMEFRAMES,
  timeframeLabel,
  type ChartTimeframe
} from "../../lib/xauusdCandles";
import { fmtPrice } from "../../lib/intradayFormat";
import { useShellQuote } from "../../lib/quoteContext";
import {
  computeDefaultLogicalRange,
  computeFitPriceRange,
  computeSpread,
  computeUsefulPriceRange,
  selectCandlesForLogicalRange,
  selectRecentCandles,
  type ChartCandleLike
} from "../../lib/chartView";

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
  /** Optional explicit bid/ask; falls back to shell quote. */
  bid?: number | null;
  ask?: number | null;
};

type LineSpec = {
  key: string;
  price: number;
  color: string;
  title: string;
  lineWidth?: number;
  lineStyle?: number;
};

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function buildLines(levels: LevelOverlays): LineSpec[] {
  const candidates: Array<{
    key: string;
    price: number | null | undefined;
    color: string;
    title: string;
    lineWidth: number;
    lineStyle: number;
  }> = [
    { key: "resistance", price: levels.resistance, color: "#dc2626", title: "Res", lineWidth: 1, lineStyle: 2 },
    { key: "vah", price: levels.vah, color: "#d4a017", title: "VAH", lineWidth: 1, lineStyle: 2 },
    { key: "poc", price: levels.poc, color: "#0f2748", title: "POC", lineWidth: 2, lineStyle: 0 },
    { key: "val", price: levels.val, color: "#d4a017", title: "VAL", lineWidth: 1, lineStyle: 2 },
    { key: "support", price: levels.support, color: "#16a34a", title: "Sup", lineWidth: 1, lineStyle: 2 },
    { key: "current", price: levels.currentPrice, color: "#2563eb", title: "Px", lineWidth: 2, lineStyle: 0 }
  ];

  const sorted = candidates
    .filter((c) => c.price != null && Number.isFinite(c.price))
    .map((c) => ({ ...c, price: c.price as number }))
    .sort((a, b) => b.price - a.price);

  const out: LineSpec[] = [];
  let prevPrice: number | null = null;
  let stagger = 0;
  for (const row of sorted) {
    const clustered = prevPrice != null && Math.abs(prevPrice - row.price) < 0.35;
    if (clustered) stagger += 1;
    else stagger = 0;
    const pad = stagger > 0 ? "·".repeat(Math.min(stagger, 3)) : "";
    out.push({
      key: row.key,
      price: row.price,
      color: row.color,
      title: `${pad}${row.title}`,
      lineWidth: row.lineWidth,
      lineStyle: row.lineStyle
    });
    prevPrice = row.price;
  }
  return out;
}

function applyUsefulView(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  candles: ChartCandleLike[],
  levels: LevelOverlays,
  getCandles: () => ChartCandleLike[],
  getLevels: () => LevelOverlays
): void {
  const logical = computeDefaultLogicalRange(candles.length);
  if (logical) {
    try {
      chart.timeScale().setVisibleLogicalRange(logical);
    } catch {
      chart.timeScale().fitContent();
    }
  } else {
    chart.timeScale().fitContent();
  }

  // Vertical Fit uses the SAME recent subset as horizontal Fit — not all history.
  const fitRange = computeFitPriceRange(candles, levels);
  void fitRange;

  // Ongoing autoscaling follows the *visible* logical window (not hidden old spikes).
  // When the user manually scales the price axis, Lightweight Charts disables autoScale.
  series.applyOptions({
    autoscaleInfoProvider: () => {
      const all = getCandles();
      const lvl = getLevels();
      let slice: ChartCandleLike[] = [];
      try {
        const vr = chart.timeScale().getVisibleLogicalRange();
        if (vr) {
          slice = selectCandlesForLogicalRange(all, vr.from, vr.to);
        }
      } catch {
        slice = [];
      }
      if (!slice.length) slice = selectRecentCandles(all);
      const next = computeUsefulPriceRange(slice, lvl);
      if (!next) return null;
      return {
        priceRange: {
          minValue: next.min,
          maxValue: next.max
        }
      };
    }
  });
  try {
    series.priceScale().applyOptions({ autoScale: true });
  } catch {
    /* ignore */
  }
}

export function XauusdChartCard({
  resistance = null,
  vah = null,
  poc = null,
  val = null,
  support = null,
  currentPrice = null,
  marketClosed = false,
  defaultTimeframe = "M15",
  bid: bidProp = null,
  ask: askProp = null
}: Props) {
  const [tf, setTf] = useState<ChartTimeframe>(defaultTimeframe);
  const { bars, loading, error } = useXauusdCandles(tf, true);
  const { quote } = useShellQuote();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const pendingBarsRef = useRef<ChartCandleLike[]>([]);
  const levelsRef = useRef<LevelOverlays>({});
  const userAdjustedViewRef = useRef(false);
  const suppressRangeEventRef = useRef(false);
  const needsAutoFitRef = useRef(true);
  const prevTfRef = useRef<ChartTimeframe>(defaultTimeframe);
  const fullscreenBtnRef = useRef<HTMLButtonElement | null>(null);
  const exitBtnRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [chartReady, setChartReady] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  const bid = bidProp ?? quote?.bid ?? null;
  const ask = askProp ?? quote?.ask ?? null;
  const spread = computeSpread(bid, ask);
  const livePx =
    currentPrice != null && Number.isFinite(currentPrice)
      ? currentPrice
      : quote?.price != null && Number.isFinite(quote.price)
        ? quote.price
        : null;

  const levels: LevelOverlays = useMemo(
    () => ({
      resistance,
      vah,
      poc,
      val,
      support,
      currentPrice: livePx
    }),
    [resistance, vah, poc, val, support, livePx]
  );

  useEffect(() => {
    levelsRef.current = levels;
  }, [levels]);

  const candleData = useMemo(() => {
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

  const fitView = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const candles = pendingBarsRef.current;
    if (!candles.length) return;
    suppressRangeEventRef.current = true;
    applyUsefulView(
      chart,
      series,
      candles,
      levelsRef.current,
      () => pendingBarsRef.current,
      () => levelsRef.current
    );
    userAdjustedViewRef.current = false;
    needsAutoFitRef.current = false;
    requestAnimationFrame(() => {
      suppressRangeEventRef.current = false;
    });
  }, []);

  useEffect(() => {
    if (prevTfRef.current !== tf) {
      prevTfRef.current = tf;
      userAdjustedViewRef.current = false;
      needsAutoFitRef.current = true;
    }
  }, [tf]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    let chart: IChartApi | null = null;
    let ro: ResizeObserver | null = null;
    let lastWidth = 0;
    let lastHeight = 0;
    try {
      chart = createChart(el, {
        height: Math.max(el.clientHeight || 280, 220),
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
          secondsVisible: false,
          rightOffset: 8,
          barSpacing: 8
        },
        crosshair: {
          mode: 1
        },
        // Embedded: allow vertical page scroll; fullscreen strengthens gestures later.
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: false
        },
        handleScale: {
          axisPressedMouseMove: true,
          mouseWheel: true,
          pinch: true
        }
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

      chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
        if (suppressRangeEventRef.current) return;
        userAdjustedViewRef.current = true;
      });

      if (pendingBarsRef.current.length) {
        const initial = pendingBarsRef.current as Array<{
          time: UTCTimestamp;
          open: number;
          high: number;
          low: number;
          close: number;
        }>;
        series.setData(initial);
        suppressRangeEventRef.current = true;
        applyUsefulView(
          chart,
          series,
          pendingBarsRef.current,
          levelsRef.current,
          () => pendingBarsRef.current,
          () => levelsRef.current
        );
        needsAutoFitRef.current = false;
        userAdjustedViewRef.current = false;
        requestAnimationFrame(() => {
          suppressRangeEventRef.current = false;
        });
      }
      setChartReady((n) => n + 1);

      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver((entries) => {
          if (!hostRef.current || !chart) return;
          const entry = entries[0];
          const w = Math.round(entry?.contentRect.width || hostRef.current.clientWidth);
          const h = Math.round(entry?.contentRect.height || hostRef.current.clientHeight);
          if (w <= 0) return;
          const widthChanged = Math.abs(w - lastWidth) > 2;
          const heightChanged = Math.abs(h - lastHeight) > 2;
          if (!widthChanged && !heightChanged) return;
          const major =
            (lastWidth > 0 && Math.abs(w - lastWidth) > 80) ||
            (lastHeight > 0 && Math.abs(h - lastHeight) > 80);
          lastWidth = w;
          lastHeight = h;
          chart.applyOptions({ width: w, height: Math.max(h, 180) });
          if (major && !userAdjustedViewRef.current) {
            needsAutoFitRef.current = true;
            fitView();
          }
        });
        ro.observe(el);
      }
      lastWidth = el.clientWidth || 320;
      lastHeight = el.clientHeight || 280;
      chart.applyOptions({
        width: lastWidth,
        height: Math.max(lastHeight, 220)
      });
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
  }, [fitView]);

  // Candle updates: never wipe manual zoom/pan on live refresh / quote ticks.
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    if (!candleData.length) return;
    series.setData(
      candleData as Array<{
        time: UTCTimestamp;
        open: number;
        high: number;
        low: number;
        close: number;
      }>
    );
    if (needsAutoFitRef.current) {
      fitView();
    }
  }, [candleData, chartReady, fitView]);

  // Price lines update freely — must not reset zoom.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const line of linesRef.current) {
      series.removePriceLine(line);
    }
    linesRef.current = [];
    const specs = buildLines(levels);
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
  }, [levels, candleData.length, chartReady]);

  // Fullscreen: resize, native API optional, gesture mode, body scroll lock.
  useEffect(() => {
    const host = hostRef.current;
    const chart = chartRef.current;
    const card = cardRef.current;
    if (!host || !chart) return;

    const applySize = () => {
      const w = host.clientWidth || 320;
      const h = Math.max(host.clientHeight || (fullscreen ? 480 : 280), 180);
      chart.applyOptions({ width: w, height: h });
    };
    applySize();

    chart.applyOptions({
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: fullscreen
      }
    });

    const prevOverflow = document.body.style.overflow;
    if (fullscreen) {
      document.body.style.overflow = "hidden";
      const req = card?.requestFullscreen?.bind(card);
      if (req && typeof document !== "undefined" && !document.fullscreenElement) {
        void req().catch(() => {
          /* iOS / restricted — CSS fallback is enough */
        });
      }
    } else {
      document.body.style.overflow = prevOverflow;
      if (document.fullscreenElement && card && document.fullscreenElement === card) {
        void document.exitFullscreen?.().catch(() => undefined);
      }
    }

    const onFsChange = () => {
      if (!document.fullscreenElement && fullscreen) {
        setFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("fullscreenchange", onFsChange);
    };
  }, [fullscreen, chartReady]);

  // Focus trap + restore for accessible fullscreen dialog (CSS fallback included).
  useEffect(() => {
    if (!fullscreen) return;
    const card = cardRef.current;
    restoreFocusRef.current =
      (document.activeElement instanceof HTMLElement ? document.activeElement : null) ??
      fullscreenBtnRef.current;

    const focusExit = () => {
      exitBtnRef.current?.focus();
    };
    requestAnimationFrame(focusExit);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setFullscreen(false);
        return;
      }
      if (e.key !== "Tab" || !card) return;
      const nodes = Array.from(
        card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((n) => !n.hasAttribute("disabled") && n.offsetParent !== null);
      if (!nodes.length) {
        e.preventDefault();
        return;
      }
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !card.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !card.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const restore = restoreFocusRef.current ?? fullscreenBtnRef.current;
      requestAnimationFrame(() => restore?.focus?.());
    };
  }, [fullscreen]);

  const openFullscreen = () => {
    restoreFocusRef.current = fullscreenBtnRef.current;
    setFullscreen(true);
  };

  const closeFullscreen = () => {
    setFullscreen(false);
  };

  const onCardKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (fullscreen && e.key === "Escape") {
      e.preventDefault();
      closeFullscreen();
    }
  };

  const hasBars = candleData.length > 0;
  const updatedLabel = quote?.updatedLabel ?? null;

  const hostStyle: CSSProperties | undefined = fullscreen
    ? { flex: 1, minHeight: 0, height: "auto", touchAction: "none" }
    : { touchAction: "pan-y" };

  return (
    <section
      ref={(el) => {
        cardRef.current = el;
      }}
      className={`gm-xau-chart-card${fullscreen ? " is-fullscreen" : ""}`}
      data-testid="plan-market-card"
      data-fullscreen={fullscreen ? "1" : "0"}
      data-embedded-touch={fullscreen ? "capture" : "pan-y"}
      aria-label="XAUUSD candlestick chart"
      role={fullscreen ? "dialog" : undefined}
      aria-modal={fullscreen || undefined}
      onKeyDown={onCardKeyDown}
    >
      <div className="gm-xau-chart-card__head">
        <div className="gm-xau-chart-card__title">
          <strong>XAUUSD</strong>
          <span data-testid="chart-timeframe-label">{timeframeLabel(tf)}</span>
          {livePx != null ? (
            <span className="gm-xau-chart-live" data-testid="chart-live-price">
              {fmtPrice(livePx)}
            </span>
          ) : null}
          {bid != null && ask != null ? (
            <span className="gm-xau-chart-ba" data-testid="chart-bid-ask">
              {fmtPrice(bid)} / {fmtPrice(ask)}
              {spread != null ? ` · ${spread.toFixed(2)}` : ""}
            </span>
          ) : null}
          {updatedLabel ? (
            <span className="gm-xau-chart-updated" data-testid="chart-updated">
              {updatedLabel}
            </span>
          ) : null}
          {marketClosed ? (
            <span className="gm-xau-chart-closed" data-testid="chart-market-closed">
              MARKET CLOSED
            </span>
          ) : null}
        </div>
        <div className="gm-xau-chart-toolbar">
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
          <div className="gm-xau-chart-actions">
            <button
              type="button"
              className="gm-xau-chart-icon-btn"
              data-testid="chart-fit-view"
              aria-label="Fit view"
              title="Fit view"
              onClick={() => {
                needsAutoFitRef.current = true;
                fitView();
              }}
            >
              <Scan aria-hidden size={16} strokeWidth={2.25} />
              <span>Fit</span>
            </button>
            {fullscreen ? (
              <button
                ref={exitBtnRef}
                type="button"
                className="gm-xau-chart-icon-btn"
                data-testid="chart-exit-fullscreen"
                aria-label="Exit full screen"
                title="Exit full screen"
                onClick={closeFullscreen}
              >
                <Minimize2 aria-hidden size={16} strokeWidth={2.25} />
                <span>Exit</span>
              </button>
            ) : (
              <button
                ref={fullscreenBtnRef}
                type="button"
                className="gm-xau-chart-icon-btn"
                data-testid="chart-fullscreen"
                aria-label="Full screen"
                title="Full screen"
                onClick={openFullscreen}
              >
                <Maximize2 aria-hidden size={16} strokeWidth={2.25} />
                <span>Full</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div
        ref={hostRef}
        className={`gm-xau-chart-host${!hasBars ? " is-empty" : ""}${
          fullscreen ? " is-fullscreen-host" : " is-embedded-host"
        }`}
        data-testid="xauusd-chart-host"
        data-has-bars={hasBars ? "1" : "0"}
        data-touch-mode={fullscreen ? "capture" : "pan-y"}
        style={hostStyle}
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
          { k: "Price", v: livePx, c: "#2563eb" }
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
