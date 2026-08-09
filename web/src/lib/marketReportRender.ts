/**
 * Premium single-page GoldMeta Market Report renderer — 1080 × 1350 canvas PNG.
 * V2 visual polish: collision-free ladder, 3-column hero, denser layout.
 * All values come from MarketReportModel (verified data only).
 */

import type { MarketReportModel, ReportCandle, ReportStructureLevel } from "./marketReportModel";
import { SNAPSHOT_DISCLAIMER, SNAPSHOT_SITE } from "./promoSnapshot";

const W = 1080;
const H = 1350;
const PAD = 24;
const GAP = 12;
const FONT = "Segoe UI, Helvetica Neue, Arial, sans-serif";

const C = {
  bg0: "#0B1424",
  bg1: "#101C30",
  card: "#15233A",
  cardHi: "#1A2B46",
  border: "rgba(216,163,61,0.22)",
  borderSoft: "rgba(255,255,255,0.10)",
  gold: "#D4A84B",
  goldSoft: "#E0C07A",
  text: "#F2F5F8",
  muted: "#A8B4C6",
  faint: "#7E8BA0",
  buy: "#2FBF71",
  sell: "#E25555",
  wait: "#D4A84B",
  support: "#2FBF71",
  resistance: "#E25555",
  poc: "#D4A84B",
  vah: "#C9A227",
  val: "#3CB371",
  grid: "rgba(216,163,61,0.05)"
};

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function decisionColor(d: string): string {
  if (d === "BUY") return C.buy;
  if (d === "SELL") return C.sell;
  return C.wait;
}

function levelColor(kind: string): string {
  switch (kind) {
    case "resistance":
      return C.resistance;
    case "support":
      return C.support;
    case "current":
    case "live":
      return C.text;
    case "poc":
      return C.poc;
    case "vah":
      return C.vah;
    case "val":
      return C.val;
    case "plan":
      return C.muted;
    default:
      return C.muted;
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function fillCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r = 14
) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = C.card;
  ctx.fill();
  ctx.strokeStyle = C.borderSoft;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawBg(ctx: CanvasRenderingContext2D) {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, C.bg0);
  grad.addColorStop(1, C.bg1);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.restore();
}

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth) cur = test;
    else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (lines.length < maxLines && cur) {
    if (lines.length === maxLines - 1 && ctx.measureText(cur).width > maxWidth) {
      let last = cur;
      while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 3) last = last.slice(0, -1);
      lines.push(`${last}…`);
    } else lines.push(cur);
  }
  return lines.slice(0, maxLines);
}

function sectionTitle(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  ctx.fillStyle = C.gold;
  ctx.font = `700 11px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y);
}

function drawIcon(
  ctx: CanvasRenderingContext2D,
  kind: string,
  x: number,
  y: number,
  color: string,
  size = 14
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const s = size;
  if (kind === "trend") {
    ctx.beginPath();
    ctx.moveTo(x - s, y + s * 0.55);
    ctx.lineTo(x - s * 0.15, y - s * 0.05);
    ctx.lineTo(x + s * 0.2, y + s * 0.4);
    ctx.lineTo(x + s, y - s * 0.75);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + s * 0.3, y - s * 0.75);
    ctx.lineTo(x + s, y - s * 0.75);
    ctx.lineTo(x + s, y - s * 0.1);
    ctx.stroke();
  } else if (kind === "value") {
    ctx.beginPath();
    ctx.arc(x, y, s * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = `700 ${Math.round(s * 0.95)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("$", x, y + 0.5);
  } else if (kind === "structure") {
    ctx.strokeRect(x - s, y - s * 0.15, s * 0.5, s * 1.05);
    ctx.strokeRect(x - s * 0.2, y - s * 0.7, s * 0.5, s * 1.6);
    ctx.strokeRect(x + s * 0.4, y - s * 0.4, s * 0.5, s * 1.3);
  } else if (kind === "volatility") {
    ctx.beginPath();
    ctx.moveTo(x - s, y + s * 0.25);
    ctx.quadraticCurveTo(x - s * 0.35, y - s, x, y);
    ctx.quadraticCurveTo(x + s * 0.35, y + s, x + s, y - s * 0.35);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Semicircle score gauge with /100 and Weak→Strong scale. */
function drawScoreGauge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  score: number | null,
  accent: string
) {
  const start = Math.PI * 0.85;
  const end = Math.PI * 2.15;
  ctx.save();
  ctx.lineWidth = 12;
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, end, false);
  ctx.stroke();

  if (score != null && Number.isFinite(score)) {
    const t = Math.max(0, Math.min(100, score)) / 100;
    ctx.strokeStyle = accent;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + (end - start) * t, false);
    ctx.stroke();
  }

  ctx.fillStyle = C.text;
  ctx.font = `800 36px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(score != null ? String(Math.round(score)) : "—", cx, cy - 8);
  ctx.fillStyle = C.muted;
  ctx.font = `700 13px ${FONT}`;
  ctx.fillText("/ 100", cx, cy + 16);
  ctx.fillStyle = C.goldSoft;
  ctx.font = `700 10px ${FONT}`;
  ctx.fillText("SETUP QUALITY", cx, cy + 34);

  const labels = ["Weak", "Developing", "Good", "Strong"];
  const ly = cy + radius + 18;
  ctx.font = `600 9px ${FONT}`;
  for (let i = 0; i < labels.length; i++) {
    const lx = cx - radius + (i * (radius * 2)) / (labels.length - 1);
    const active =
      score != null &&
      ((i === 0 && score < 40) ||
        (i === 1 && score >= 40 && score < 60) ||
        (i === 2 && score >= 60 && score < 80) ||
        (i === 3 && score >= 80));
    ctx.fillStyle = active ? accent : C.faint;
    ctx.fillText(labels[i]!, lx, ly);
  }
  ctx.restore();
}

/**
 * Premium vertical price ladder with collision-avoided labels + leader lines.
 * Marker Y is mathematically scaled; label Y is separated for readability.
 */
function drawStructureLadder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  levels: ReportStructureLevel[]
) {
  fillCard(ctx, x, y, w, h, 14);
  sectionTitle(ctx, "PRICE STRUCTURE", x + 14, y + 20);

  if (!levels.length) {
    ctx.fillStyle = C.muted;
    ctx.font = `500 13px ${FONT}`;
    ctx.fillText("Structure levels unavailable", x + 14, y + 52);
    return;
  }

  const axisX = x + w - 28;
  const top = y + 40;
  const bottom = y + h - 18;
  const usable = bottom - top;

  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(axisX, top);
  ctx.lineTo(axisX, bottom);
  ctx.stroke();

  const prices = levels.map((l) => l.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.max(0.5, max - min);

  type Row = ReportStructureLevel & { markerY: number; labelY: number };
  const rows: Row[] = levels.map((l) => {
    const t = (max - l.price) / span;
    const markerY = top + t * usable;
    return { ...l, markerY, labelY: markerY };
  });

  // Sort high→low by marker, then push labels apart (collision avoidance)
  rows.sort((a, b) => a.markerY - b.markerY);
  const minGap = 40;
  const distribute = () => {
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]!;
      const cur = rows[i]!;
      if (cur.labelY - prev.labelY < minGap) {
        cur.labelY = prev.labelY + minGap;
      }
    }
  };
  distribute();
  // If overflow bottom, shift pack upward while preserving gaps
  const last = rows[rows.length - 1]!;
  if (last.labelY > bottom - 2) {
    const overflow = last.labelY - (bottom - 2);
    for (const r of rows) r.labelY -= overflow;
  }
  // If overflow top, compress from center by reducing only excess above top
  if (rows[0]!.labelY < top) {
    const shift = top - rows[0]!.labelY;
    for (const r of rows) r.labelY += shift;
  }
  distribute();
  // Final clamp: if still overflowing, evenly space labels in the band
  if (rows[rows.length - 1]!.labelY > bottom - 2 || rows[0]!.labelY < top) {
    const n = rows.length;
    for (let i = 0; i < n; i++) {
      rows[i]!.labelY = top + (i * (bottom - top)) / Math.max(1, n - 1);
    }
  }

  for (const row of rows) {
    const color = levelColor(row.kind);
    const isCurrent = row.kind === "current";

    // Marker on axis at true price position
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(axisX, row.markerY, isCurrent ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
    if (isCurrent) {
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(axisX, row.markerY, 9, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Leader line from label to marker
    ctx.strokeStyle = isCurrent ? "rgba(242,245,248,0.35)" : "rgba(255,255,255,0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 14, row.labelY);
    ctx.lineTo(axisX - 12, row.markerY);
    ctx.stroke();

    // Horizontal tick at marker
    ctx.beginPath();
    ctx.moveTo(axisX - 10, row.markerY);
    ctx.lineTo(axisX + 8, row.markerY);
    ctx.stroke();

    ctx.fillStyle = isCurrent ? C.text : C.muted;
    ctx.font = `700 ${isCurrent ? 11 : 10}px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(row.label.toUpperCase(), x + 14, row.labelY - 9);

    ctx.fillStyle = color;
    ctx.font = `800 ${isCurrent ? 17 : 14}px ${FONT}`;
    ctx.fillText(fmt(row.price), x + 14, row.labelY + 8);

    if (row.delta != null && !isCurrent) {
      const sign = row.delta > 0 ? "+" : "";
      ctx.fillStyle = C.faint;
      ctx.font = `600 11px ${FONT}`;
      ctx.fillText(`${sign}${row.delta.toFixed(2)}`, x + 118, row.labelY + 8);
    }
  }
}

function drawCandles(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  candles: ReportCandle[],
  overlays: MarketReportModel["chartOverlays"],
  timeframe: string | null
) {
  fillCard(ctx, x, y, w, h, 14);
  const padL = 14;
  const padR = 72;
  const padT = 36;
  const padB = 28;
  const innerX = x + padL;
  const innerY = y + padT;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  sectionTitle(
    ctx,
    `PRICE ACTION · ${(timeframe || "15M").toUpperCase()}`,
    x + 14,
    y + 20
  );

  let min = Math.min(...candles.map((c) => c.low));
  let max = Math.max(...candles.map((c) => c.high));
  for (const o of overlays) {
    min = Math.min(min, o.price);
    max = Math.max(max, o.price);
  }
  const span = Math.max(0.5, max - min);
  min -= span * 0.05;
  max += span * 0.05;
  const range = max - min;

  // Subtle horizontal grid + right price scale
  ctx.save();
  for (let i = 0; i <= 4; i++) {
    const gy = innerY + (innerH * i) / 4;
    const price = max - (range * i) / 4;
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(innerX, gy);
    ctx.lineTo(innerX + innerW, gy);
    ctx.stroke();
    ctx.fillStyle = C.faint;
    ctx.font = `600 10px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(fmt(price), innerX + innerW + 6, gy);
  }
  ctx.restore();

  // Level overlays + edge badges
  const badgeOrder = overlays.filter((o) =>
    ["live", "resistance", "support", "poc"].includes(o.tone)
  );
  for (const o of badgeOrder) {
    const oy = innerY + ((max - o.price) / range) * innerH;
    const color = levelColor(o.tone === "live" ? "current" : o.tone);
    ctx.strokeStyle =
      o.tone === "live" ? "rgba(242,245,248,0.55)" : color.replace(")", ",0.55)").replace("rgb", "rgba");
    // fallback for hex colors
    ctx.strokeStyle =
      o.tone === "live"
        ? "rgba(242,245,248,0.5)"
        : o.tone === "resistance"
          ? "rgba(226,85,85,0.55)"
          : o.tone === "support"
            ? "rgba(47,191,113,0.55)"
            : "rgba(212,168,75,0.55)";
    ctx.setLineDash(o.tone === "live" ? [] : [4, 4]);
    ctx.lineWidth = o.tone === "live" ? 1.4 : 1;
    ctx.beginPath();
    ctx.moveTo(innerX, oy);
    ctx.lineTo(innerX + innerW, oy);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const n = candles.length;
  const slot = innerW / n;
  const bodyW = Math.max(2.2, slot * 0.58);
  for (let i = 0; i < n; i++) {
    const c = candles[i]!;
    const cx = innerX + slot * i + slot / 2;
    const yH = innerY + ((max - c.high) / range) * innerH;
    const yL = innerY + ((max - c.low) / range) * innerH;
    const yO = innerY + ((max - c.open) / range) * innerH;
    const yC = innerY + ((max - c.close) / range) * innerH;
    const up = c.close >= c.open;
    const color = up ? C.buy : C.sell;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, yH);
    ctx.lineTo(cx, yL);
    ctx.stroke();
    const top = Math.min(yO, yC);
    const bh = Math.max(1.5, Math.abs(yC - yO));
    ctx.fillRect(cx - bodyW / 2, top, bodyW, bh);
  }

  // Time labels
  ctx.fillStyle = C.faint;
  ctx.font = `600 10px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const labels = ["-30", "-20", "-10", "Now"];
  for (let i = 0; i < labels.length; i++) {
    const tx = innerX + (innerW * i) / (labels.length - 1);
    ctx.fillText(labels[i]!, tx, y + h - 10);
  }

  // Compact level legend under title
  let lx = x + 200;
  ctx.textAlign = "left";
  ctx.font = `600 10px ${FONT}`;
  for (const o of badgeOrder.slice(0, 4)) {
    const color = levelColor(o.tone === "live" ? "current" : o.tone);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(lx, y + 16, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.muted;
    const name =
      o.tone === "live" ? "Current" : o.tone === "poc" ? "POC" : o.label === "R" ? "Res" : o.label === "S" ? "Sup" : o.label;
    ctx.fillText(`${name} ${fmt(o.price)}`, lx + 7, y + 19);
    lx += ctx.measureText(`${name} ${fmt(o.price)}`).width + 18;
  }
}

function drawTradePlanVisual(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  model: MarketReportModel
) {
  fillCard(ctx, x, y, w, h, 14);
  sectionTitle(ctx, "TRADE PLAN", x + 14, y + 20);

  if (!model.tradePlan) {
    ctx.fillStyle = C.muted;
    ctx.font = `700 11px ${FONT}`;
    ctx.fillText("PLAN STATUS", x + 14, y + 52);
    ctx.fillStyle = C.wait;
    ctx.font = `800 18px ${FONT}`;
    const lines = wrapText(ctx, model.planWaitingMessage ?? "WAITING FOR VALID SETUP", w - 28, 3);
    let py = y + 82;
    for (const line of lines) {
      ctx.fillText(line, x + 14, py);
      py += 24;
    }
    return;
  }

  const p = model.tradePlan;
  const accent = decisionColor(model.decision);
  ctx.fillStyle = accent;
  ctx.font = `800 20px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(`${p.direction.toUpperCase()} XAUUSD`, x + 14, y + 48);

  // Left value stack
  const rows: Array<[string, string]> = [
    ["ENTRY", fmt(p.entry)],
    ["STOP", fmt(p.stopLoss)],
    ["TP1", fmt(p.tp1)],
    ["TP2", fmt(p.tp2)],
    ["TP3", fmt(p.tp3)]
  ];
  let ry = y + 74;
  for (const [label, value] of rows) {
    ctx.fillStyle = C.faint;
    ctx.font = `700 10px ${FONT}`;
    ctx.fillText(label, x + 14, ry);
    ctx.fillStyle = C.text;
    ctx.font = `800 15px ${FONT}`;
    ctx.fillText(value, x + 70, ry);
    ry += 26;
  }

  ctx.fillStyle = C.gold;
  ctx.font = `700 11px ${FONT}`;
  ctx.fillText("RISK / REWARD", x + 14, y + h - 28);
  ctx.fillStyle = C.text;
  ctx.font = `800 18px ${FONT}`;
  ctx.fillText(p.riskReward != null ? `1 : ${p.riskReward}` : "—", x + 14, y + h - 10);

  // Right vertical plan ladder
  const ladderX = x + w - 90;
  type PlanLvl = { label: string; price: number; kind: "tp" | "entry" | "sl" };
  const rawLevels: Array<{ label: string; price: number | null; kind: PlanLvl["kind"] }> = [
    { label: "TP3", price: p.tp3, kind: "tp" },
    { label: "TP2", price: p.tp2, kind: "tp" },
    { label: "TP1", price: p.tp1, kind: "tp" },
    { label: "ENTRY", price: p.entry, kind: "entry" },
    { label: "SL", price: p.stopLoss, kind: "sl" }
  ];
  const levels: PlanLvl[] = [];
  for (const l of rawLevels) {
    if (l.price != null && Number.isFinite(l.price)) {
      levels.push({ label: l.label, price: l.price, kind: l.kind });
    }
  }

  if (levels.length >= 2) {
    const top = y + 56;
    const bottom = y + h - 20;
    const usable = bottom - top;
    const prices = levels.map((l) => l.price);
    // For sell plans, axis still high→low visually
    const maxP = Math.max(...prices);
    const minP = Math.min(...prices);
    const span = Math.max(0.5, maxP - minP);

    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ladderX + 40, top);
    ctx.lineTo(ladderX + 40, bottom);
    ctx.stroke();

    for (const lvl of levels) {
      const t = (maxP - lvl.price) / span;
      const ly = top + t * usable;
      const color =
        lvl.kind === "entry" ? accent : lvl.kind === "sl" ? C.sell : C.buy;
      ctx.fillStyle = color;
      if (lvl.kind === "entry") {
        // diamond
        ctx.beginPath();
        ctx.moveTo(ladderX + 40, ly - 6);
        ctx.lineTo(ladderX + 46, ly);
        ctx.lineTo(ladderX + 40, ly + 6);
        ctx.lineTo(ladderX + 34, ly);
        ctx.closePath();
        ctx.fill();
      } else if (lvl.kind === "sl") {
        ctx.fillRect(ladderX + 34, ly - 4, 12, 8);
      } else {
        ctx.beginPath();
        ctx.arc(ladderX + 40, ly, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = C.muted;
      ctx.font = `700 10px ${FONT}`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(lvl.label, ladderX + 28, ly);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
}

function drawPlanReadiness(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  model: MarketReportModel
) {
  fillCard(ctx, x, y, w, h, 14);
  sectionTitle(ctx, "PLAN READINESS", x + 14, y + 20);

  const rows = model.planReadiness ?? [];
  let ry = y + 52;
  for (const row of rows) {
    const ready = row.status === "READY";
    const fail = row.status === "FAIL";
    const mark = ready ? "✓" : fail ? "✕" : "○";
    const color = ready ? C.buy : fail ? C.sell : C.wait;
    ctx.fillStyle = color;
    ctx.font = `800 16px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(mark, x + 16, ry);
    ctx.fillStyle = C.text;
    ctx.font = `600 15px ${FONT}`;
    ctx.fillText(row.label, x + 40, ry);

    roundRect(ctx, x + w - 118, ry - 14, 100, 24, 12);
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = `800 11px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(row.status, x + w - 68, ry + 2);
    ctx.textAlign = "left";
    ry += 36;
  }

  // Strong bottom status
  roundRect(ctx, x + 14, y + h - 58, w - 28, 42, 10);
  ctx.fillStyle = "rgba(212,168,75,0.10)";
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = C.faint;
  ctx.font = `700 10px ${FONT}`;
  ctx.fillText("PLAN STATUS", x + 28, y + h - 38);
  ctx.fillStyle = C.wait;
  ctx.font = `800 18px ${FONT}`;
  ctx.fillText(model.planReadinessOverall ?? "NOT READY", x + 28, y + h - 16);
}

export async function renderMarketReportPng(
  model: MarketReportModel,
  logoUrl = "/brand/mark-official.png"
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* ignore */
    }
  }

  const logo = await loadImage(logoUrl);
  drawBg(ctx);

  const contentW = W - PAD * 2;
  let y = PAD;
  const accent = decisionColor(model.decision);

  // ── Header ──
  const mark = 46;
  if (logo) ctx.drawImage(logo, PAD, y, mark, mark);
  else {
    ctx.fillStyle = C.gold;
    roundRect(ctx, PAD, y, mark, mark, 10);
    ctx.fill();
  }
  ctx.fillStyle = C.gold;
  ctx.font = `800 24px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("GOLDMETA", PAD + mark + 12, y + 20);
  ctx.fillStyle = C.muted;
  ctx.font = `500 13px ${FONT}`;
  ctx.fillText("AI Market Intelligence", PAD + mark + 12, y + 40);

  // Right meta cluster — kept inside safe margin (no clipping)
  const metaX = W - PAD;
  const metaBlockW = 280;
  const metaLeft = metaX - metaBlockW;
  ctx.textAlign = "right";
  ctx.fillStyle = C.text;
  ctx.font = `800 22px ${FONT}`;
  ctx.fillText(model.symbol, metaX, y + 16);
  ctx.fillStyle = C.gold;
  ctx.font = `700 12px ${FONT}`;
  ctx.fillText(model.assetLabel, metaX, y + 34);

  const statusLine = model.marketStatus ? `${model.marketStatus} ●` : null;
  const sessionLine =
    model.sessionLabel && model.sessionLabel !== "—"
      ? `${model.sessionLabel.toUpperCase()} SESSION`
      : null;
  ctx.fillStyle = model.marketStatus === "MARKET OPEN" ? C.buy : C.muted;
  ctx.font = `700 11px ${FONT}`;
  let metaY = y + 52;
  if (statusLine) {
    ctx.fillText(statusLine, metaX, metaY);
    metaY += 15;
  }
  ctx.fillStyle = C.muted;
  ctx.font = `600 11px ${FONT}`;
  if (sessionLine) {
    ctx.fillText(sessionLine, metaX, metaY);
    metaY += 16;
  }

  // City / clock rows (aligned columns within the right meta block)
  const timeRows: Array<[string, string]> = [];
  for (const line of [model.localTimeLine, model.secondaryTimeLine]) {
    if (!line) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      const clock = parts[parts.length - 1]!;
      const city = parts.slice(0, -1).join(" ");
      timeRows.push([city, clock]);
    } else {
      timeRows.push([line, ""]);
    }
  }
  ctx.font = `600 12px ${FONT}`;
  for (const [city, clock] of timeRows.slice(0, 3)) {
    ctx.fillStyle = C.muted;
    ctx.textAlign = "left";
    ctx.fillText(city, metaLeft + 40, metaY);
    ctx.textAlign = "right";
    ctx.fillStyle = C.text;
    ctx.fillText(clock, metaX, metaY);
    metaY += 15;
  }
  ctx.textAlign = "left";
  y = Math.max(PAD + mark + 18, metaY + 10);

  // ── Three-column hero ──
  const heroH = 168;
  const colW = (contentW - GAP * 2) / 3;

  // MARKET DECISION
  fillCard(ctx, PAD, y, colW, heroH, 14);
  roundRect(ctx, PAD, y, 4, heroH, 2);
  ctx.fillStyle = accent;
  ctx.fill();
  sectionTitle(ctx, "MARKET DECISION", PAD + 16, y + 22);
  ctx.fillStyle = accent;
  ctx.font = `800 44px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(model.decision, PAD + 16, y + 72);
  ctx.fillStyle = C.muted;
  ctx.font = `500 13px ${FONT}`;
  const sub = wrapText(ctx, model.decisionSubtext, colW - 32, 2);
  let sy = y + 96;
  for (const line of sub) {
    ctx.fillText(line, PAD + 16, sy);
    sy += 17;
  }
  ctx.fillStyle = C.goldSoft;
  ctx.font = `600 12px ${FONT}`;
  ctx.fillText(`Bias: ${model.biasLabel}`, PAD + 16, y + heroH - 16);

  // GOLDMETA SCORE
  const scoreX = PAD + colW + GAP;
  fillCard(ctx, scoreX, y, colW, heroH, 14);
  sectionTitle(ctx, "GOLDMETA SCORE", scoreX + 16, y + 22);
  drawScoreGauge(ctx, scoreX + colW / 2, y + 78, 44, model.scoreTotal, accent);

  // CURRENT PRICE
  const priceX = scoreX + colW + GAP;
  fillCard(ctx, priceX, y, colW, heroH, 14);
  sectionTitle(ctx, "CURRENT PRICE", priceX + 16, y + 22);
  ctx.fillStyle = C.text;
  ctx.font = `800 34px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(fmt(model.livePrice), priceX + 16, y + 70);

  // Bias meter inside price card
  const bmX = priceX + 16;
  const bmW = colW - 32;
  const bmY = y + 96;
  ctx.fillStyle = C.faint;
  ctx.font = `600 10px ${FONT}`;
  ctx.fillText("BEARISH", bmX, bmY);
  ctx.textAlign = "right";
  ctx.fillText("BULLISH", bmX + bmW, bmY);
  ctx.textAlign = "left";
  const trackY = bmY + 14;
  ctx.strokeStyle = C.borderSoft;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(bmX, trackY);
  ctx.lineTo(bmX + bmW, trackY);
  ctx.stroke();
  const px = bmX + bmW * Math.max(0.05, Math.min(0.95, model.biasPosition));
  ctx.fillStyle = C.gold;
  ctx.beginPath();
  ctx.arc(px, trackY, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.goldSoft;
  ctx.font = `600 12px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(model.biasLabel, bmX + bmW / 2, trackY + 20);
  ctx.textAlign = "left";

  // Nearest structure hint
  const nearRes = model.structureLevels.find((l) => l.kind === "resistance");
  const nearSup = model.structureLevels.find((l) => l.kind === "support");
  ctx.fillStyle = C.muted;
  ctx.font = `500 11px ${FONT}`;
  ctx.textAlign = "left";
  const hint =
    nearRes && nearSup
      ? `R ${fmt(nearRes.price)} · S ${fmt(nearSup.price)}`
      : model.sessionLabel;
  ctx.fillText(hint, priceX + 16, y + heroH - 14);

  y += heroH + GAP;

  // ── Chart + Structure ──
  const blockH = 278;
  const leftW = model.candles?.length ? 620 : contentW;
  if (model.candles?.length) {
    drawCandles(
      ctx,
      PAD,
      y,
      leftW,
      blockH,
      model.candles,
      model.chartOverlays,
      model.chartTimeframe
    );
    drawStructureLadder(
      ctx,
      PAD + leftW + GAP,
      y,
      contentW - leftW - GAP,
      blockH,
      model.structureLevels
    );
  } else {
    drawStructureLadder(ctx, PAD, y, contentW, blockH, model.structureLevels);
  }
  y += blockH + GAP;

  // ── Market Story ──
  const storyH = 118;
  sectionTitle(ctx, "MARKET STORY", PAD, y + 2);
  const cards = model.storyCards.slice(0, 4);
  const cardW = (contentW - GAP * (cards.length - 1)) / Math.max(1, cards.length);
  const storyY = y + 14;
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]!;
    const cx = PAD + i * (cardW + GAP);
    fillCard(ctx, cx, storyY, cardW, storyH - 14, 12);
    // icon circle
    ctx.fillStyle = "rgba(212,168,75,0.12)";
    ctx.beginPath();
    ctx.arc(cx + 28, storyY + 30, 16, 0, Math.PI * 2);
    ctx.fill();
    drawIcon(ctx, card.icon, cx + 28, storyY + 30, C.gold, 12);
    ctx.fillStyle = C.faint;
    ctx.font = `700 10px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(card.title.toUpperCase(), cx + 52, storyY + 24);
    ctx.fillStyle = C.text;
    ctx.font = `800 15px ${FONT}`;
    ctx.fillText(card.value, cx + 52, storyY + 44);
    ctx.fillStyle = C.muted;
    ctx.font = `500 11px ${FONT}`;
    const detailLines = wrapText(ctx, card.detail, cardW - 24, 2);
    let dy = storyY + 70;
    for (const line of detailLines) {
      ctx.fillText(line, cx + 14, dy);
      dy += 15;
    }
  }
  y += storyH + GAP;

  // ── Why + Plan ──
  const panelH = 236;
  const half = (contentW - GAP) / 2;

  fillCard(ctx, PAD, y, half, panelH, 14);
  sectionTitle(ctx, model.whyTitle, PAD + 14, y + 22);
  let wy = y + 50;
  for (const item of model.whyItems.slice(0, 4)) {
    const mark = item.state === "pass" ? "✓" : item.state === "fail" ? "✕" : "○";
    ctx.fillStyle =
      item.state === "pass" ? C.buy : item.state === "fail" ? C.sell : C.wait;
    ctx.font = `800 15px ${FONT}`;
    ctx.fillText(mark, PAD + 16, wy);
    ctx.fillStyle = C.text;
    ctx.font = `500 14px ${FONT}`;
    const lines = wrapText(ctx, item.text, half - 52, 2);
    ctx.fillText(lines[0] ?? "", PAD + 38, wy);
    if (lines[1]) {
      ctx.fillStyle = C.muted;
      ctx.font = `500 12px ${FONT}`;
      ctx.fillText(lines[1], PAD + 38, wy + 16);
      wy += 38;
    } else {
      wy += 28;
    }
  }
  if (model.nextTrigger && model.decision === "WAIT") {
    ctx.fillStyle = C.faint;
    ctx.font = `700 10px ${FONT}`;
    ctx.fillText("NEXT TRIGGER", PAD + 16, y + panelH - 40);
    ctx.fillStyle = C.goldSoft;
    ctx.font = `600 13px ${FONT}`;
    const tl = wrapText(ctx, model.nextTrigger, half - 32, 2);
    let ty = y + panelH - 22;
    for (const line of tl) {
      ctx.fillText(line, PAD + 16, ty);
      ty += 16;
    }
  }

  const rightX = PAD + half + GAP;
  if (model.decision === "WAIT" && model.planReadiness) {
    drawPlanReadiness(ctx, rightX, y, half, panelH, model);
  } else {
    drawTradePlanVisual(ctx, rightX, y, half, panelH, model);
  }
  y += panelH + GAP;

  // ── MTF + Volatility + Session ──
  const stripH = 108;
  const third = (contentW - GAP * 2) / 3;

  // Multi-timeframe
  fillCard(ctx, PAD, y, third, stripH, 12);
  sectionTitle(ctx, "MULTI-TIMEFRAME", PAD + 12, y + 18);
  if (model.timeframes?.length) {
    const show = model.timeframes.slice(0, 3);
    const cellW = (third - 24) / show.length;
    for (let i = 0; i < show.length; i++) {
      const tf = show[i]!;
      const cx = PAD + 12 + i * cellW + cellW / 2;
      const tone =
        tf.tone === "buy" ? C.buy : tf.tone === "sell" ? C.sell : C.gold;
      ctx.fillStyle = C.muted;
      ctx.font = `700 12px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(tf.tf, cx, y + 42);
      ctx.fillStyle = tone;
      ctx.font = `800 20px ${FONT}`;
      const dirLower = tf.direction.toLowerCase();
      const waitingLike = /wait|mixed|neutral|prepare/.test(dirLower);
      const arrow = waitingLike
        ? "→"
        : tf.tone === "buy" || /bull|buy/.test(dirLower)
          ? "↑"
          : tf.tone === "sell" || /bear|sell/.test(dirLower)
            ? "↓"
            : "→";
      const arrowColor = waitingLike || arrow === "→" ? C.gold : tone;
      ctx.fillStyle = arrowColor;
      ctx.fillText(arrow, cx, y + 66);
      ctx.fillStyle = arrowColor;
      ctx.font = `700 11px ${FONT}`;
      const dir =
        tf.direction.length > 10 ? tf.direction.slice(0, 9) + "…" : tf.direction;
      ctx.fillText(dir.toUpperCase(), cx, y + 88);
    }
    ctx.textAlign = "left";
  } else {
    ctx.fillStyle = C.faint;
    ctx.font = `500 12px ${FONT}`;
    ctx.fillText("No timeframe data", PAD + 12, y + 56);
  }

  // Volatility
  const volX = PAD + third + GAP;
  fillCard(ctx, volX, y, third, stripH, 12);
  sectionTitle(ctx, "VOLATILITY", volX + 12, y + 18);
  if (model.volatility) {
    const trackX = volX + 16;
    const trackW = third - 32;
    const trackY = y + 58;
    ctx.fillStyle = C.faint;
    ctx.font = `700 10px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText("LOW", trackX, y + 42);
    ctx.textAlign = "center";
    ctx.fillText("NORMAL", trackX + trackW / 2, y + 42);
    ctx.textAlign = "right";
    ctx.fillText("HIGH", trackX + trackW, y + 42);
    ctx.textAlign = "left";

    ctx.strokeStyle = C.borderSoft;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(trackX, trackY);
    ctx.lineTo(trackX + trackW, trackY);
    ctx.stroke();

    // tick marks at thirds
    for (const t of [0, 0.5, 1]) {
      ctx.fillStyle = C.faint;
      ctx.fillRect(trackX + trackW * t - 1, trackY - 6, 2, 12);
    }

    const pos = Math.max(0.05, Math.min(0.95, model.volatility.position));
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.arc(trackX + trackW * pos, trackY, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.goldSoft;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(trackX + trackW * pos, trackY, 11, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = C.muted;
    ctx.font = `600 12px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(model.volatility.caption, trackX + trackW / 2, y + 88);
    ctx.textAlign = "left";
  } else {
    ctx.fillStyle = C.faint;
    ctx.font = `500 12px ${FONT}`;
    ctx.fillText("Unavailable", volX + 12, y + 56);
  }

  // Session timeline
  const sesX = volX + third + GAP;
  fillCard(ctx, sesX, y, third, stripH, 12);
  sectionTitle(ctx, "SESSION", sesX + 12, y + 18);
  const ses = model.sessions;
  const sesTrackY = y + 56;
  const sesStart = sesX + 28;
  const sesEnd = sesX + third - 28;
  const step = (sesEnd - sesStart) / Math.max(1, ses.length - 1);
  ctx.strokeStyle = C.borderSoft;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(sesStart, sesTrackY);
  ctx.lineTo(sesEnd, sesTrackY);
  ctx.stroke();
  for (let i = 0; i < ses.length; i++) {
    const s = ses[i]!;
    const sx = sesStart + step * i;
    ctx.fillStyle = s.active ? C.gold : "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.arc(sx, sesTrackY, s.active ? 8 : 5, 0, Math.PI * 2);
    ctx.fill();
    if (s.active) {
      ctx.strokeStyle = C.goldSoft;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sesTrackY, 12, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = s.active ? C.goldSoft : C.faint;
    ctx.font = `${s.active ? "800" : "600"} 11px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(s.label, sx, sesTrackY + 24);
    if (s.active) {
      ctx.fillStyle = C.gold;
      ctx.font = `700 9px ${FONT}`;
      ctx.fillText("ACTIVE", sx, sesTrackY + 38);
    }
  }
  ctx.textAlign = "left";
  y += stripH + GAP;

  // ── Key Levels + Scenario Map ──
  const bottomH = 168;
  const keyW = 340;
  fillCard(ctx, PAD, y, keyW, bottomH, 12);
  sectionTitle(ctx, "KEY LEVELS", PAD + 12, y + 18);

  const primary = model.keyLevels.filter((k) =>
    ["Resistance", "Current", "Support"].includes(k.label)
  );
  const secondary = model.keyLevels.filter((k) =>
    ["POC", "VAH", "VAL"].includes(k.label)
  );
  const primW = (keyW - 36) / Math.max(1, primary.length);
  for (let i = 0; i < primary.length; i++) {
    const k = primary[i]!;
    const kx = PAD + 12 + i * primW;
    const color = levelColor(k.tone);
    roundRect(ctx, kx, y + 34, primW - 8, 62, 10);
    ctx.fillStyle = C.cardHi;
    ctx.fill();
    ctx.strokeStyle = C.borderSoft;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = C.faint;
    ctx.font = `700 9px ${FONT}`;
    ctx.fillText(k.label.toUpperCase(), kx + 8, y + 50);
    ctx.fillStyle = color;
    ctx.font = `800 15px ${FONT}`;
    ctx.fillText(fmt(k.price), kx + 8, y + 70);
    ctx.fillStyle = C.muted;
    ctx.font = `500 10px ${FONT}`;
    ctx.fillText(k.caption ?? "", kx + 8, y + 86);
  }

  // Secondary POC/VAH/VAL — semantic colours (not direction-based)
  let sx2 = PAD + 12;
  for (const k of secondary) {
    const color = levelColor(k.tone);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(sx2 + 4, y + 122, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.muted;
    ctx.font = `700 10px ${FONT}`;
    ctx.fillText(k.label, sx2 + 12, y + 125);
    ctx.fillStyle = C.text;
    ctx.font = `700 12px ${FONT}`;
    ctx.fillText(fmt(k.price), sx2 + 12, y + 142);
    sx2 += 108;
  }

  // Scenario map
  const scenX = PAD + keyW + GAP;
  const scenW = contentW - keyW - GAP;
  fillCard(ctx, scenX, y, scenW, bottomH, 12);
  sectionTitle(ctx, "SCENARIO MAP", scenX + 12, y + 18);

  // Center current marker
  const midX = scenX + scenW / 2;
  ctx.fillStyle = C.faint;
  ctx.font = `700 9px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText("CURRENT MARKET", midX, y + 38);
  ctx.fillStyle = accent;
  ctx.font = `800 14px ${FONT}`;
  ctx.fillText(model.decision, midX, y + 56);
  ctx.textAlign = "left";

  const pathW = (scenW - 36) / 2;
  const paths = model.scenarios.slice(0, 2);
  for (let i = 0; i < paths.length; i++) {
    const sc = paths[i]!;
    const px = scenX + 12 + i * (pathW + 12);
    const tone = sc.tone === "buy" ? C.buy : C.sell;
    roundRect(ctx, px, y + 70, pathW, 82, 10);
    ctx.fillStyle = sc.tone === "buy" ? "rgba(47,191,113,0.08)" : "rgba(226,85,85,0.08)";
    ctx.fill();
    ctx.strokeStyle = tone;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = tone;
    ctx.font = `800 18px ${FONT}`;
    ctx.fillText(sc.tone === "buy" ? "↗" : "↘", px + 10, y + 94);
    ctx.font = `700 11px ${FONT}`;
    ctx.fillText(sc.title.toUpperCase(), px + 32, y + 92);
    ctx.fillStyle = C.text;
    ctx.font = `500 12px ${FONT}`;
    const t1 = wrapText(ctx, sc.trigger, pathW - 20, 2);
    let ty = y + 112;
    for (const line of t1) {
      ctx.fillText(line, px + 10, ty);
      ty += 14;
    }
    ctx.fillStyle = C.muted;
    ctx.font = `500 11px ${FONT}`;
    const o1 = wrapText(ctx, sc.outcome, pathW - 20, 1);
    ctx.fillText(o1[0] ?? "", px + 10, y + 142);
  }

  y += bottomH + 10;

  // ── Footer ──
  const footerTop = Math.min(Math.max(y, H - 72), H - 72);
  ctx.strokeStyle = C.borderSoft;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, footerTop);
  ctx.lineTo(W - PAD, footerTop);
  ctx.stroke();

  ctx.fillStyle = C.gold;
  ctx.font = `700 13px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(SNAPSHOT_SITE, PAD, footerTop + 20);
  ctx.fillStyle = C.muted;
  ctx.font = `500 11px ${FONT}`;
  ctx.fillText("MetaMech Solutions", PAD, footerTop + 38);

  ctx.textAlign = "right";
  ctx.fillStyle = C.faint;
  ctx.font = `400 10px ${FONT}`;
  const disc = wrapText(ctx, SNAPSHOT_DISCLAIMER, 620, 2);
  let dy = footerTop + 18;
  for (const line of disc) {
    ctx.fillText(line, W - PAD, dy);
    dy += 13;
  }
  ctx.fillStyle = C.muted;
  ctx.font = `500 10px ${FONT}`;
  ctx.fillText(model.generatedLabel, W - PAD, footerTop + 52);
  ctx.textAlign = "left";

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("PNG export failed"));
      },
      "image/png",
      1
    );
  });
}

export const MARKET_REPORT_SIZE = { width: W, height: H } as const;
