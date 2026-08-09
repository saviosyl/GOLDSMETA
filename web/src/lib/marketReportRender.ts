/**
 * Premium single-page GoldMeta Market Report renderer — 1080 × 1350 canvas PNG.
 * Visual layout only; all values come from MarketReportModel (verified data).
 */

import type { MarketReportModel, ReportCandle } from "./marketReportModel";
import { SNAPSHOT_DISCLAIMER, SNAPSHOT_SITE } from "./promoSnapshot";

const W = 1080;
const H = 1350;

const C = {
  bg0: "#0B1424",
  bg1: "#101C30",
  card: "#15233A",
  card2: "#182942",
  border: "rgba(216,163,61,0.18)",
  borderSoft: "rgba(255,255,255,0.08)",
  navy: "#0E1A2E",
  gold: "#D4A84B",
  goldSoft: "#E0C07A",
  text: "#F2F5F8",
  muted: "#93A0B4",
  faint: "#6B788C",
  buy: "#2FBF71",
  sell: "#E25555",
  wait: "#D4A84B",
  support: "#2FBF71",
  resistance: "#E25555",
  poc: "#D4A84B",
  grid: "rgba(216,163,61,0.045)"
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
  r = 16
) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = C.card;
  ctx.fill();
  ctx.strokeStyle = C.borderSoft;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawGrid(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
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

function drawIcon(
  ctx: CanvasRenderingContext2D,
  kind: string,
  x: number,
  y: number,
  color: string
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const s = 11;
  if (kind === "trend") {
    ctx.beginPath();
    ctx.moveTo(x - s, y + s * 0.6);
    ctx.lineTo(x - s * 0.2, y);
    ctx.lineTo(x + s * 0.15, y + s * 0.45);
    ctx.lineTo(x + s, y - s * 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + s * 0.35, y - s * 0.7);
    ctx.lineTo(x + s, y - s * 0.7);
    ctx.lineTo(x + s, y - s * 0.15);
    ctx.stroke();
  } else if (kind === "value") {
    ctx.beginPath();
    ctx.arc(x, y, s * 0.85, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = "700 11px Segoe UI, Helvetica Neue, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("$", x, y + 0.5);
  } else if (kind === "structure") {
    ctx.strokeRect(x - s, y - s * 0.2, s * 0.55, s * 1.1);
    ctx.strokeRect(x - s * 0.15, y - s * 0.7, s * 0.55, s * 1.6);
    ctx.strokeRect(x + s * 0.45, y - s * 0.45, s * 0.55, s * 1.35);
  } else if (kind === "volatility") {
    ctx.beginPath();
    ctx.moveTo(x - s, y + s * 0.3);
    ctx.quadraticCurveTo(x - s * 0.3, y - s, x, y);
    ctx.quadraticCurveTo(x + s * 0.3, y + s, x + s, y - s * 0.4);
    ctx.stroke();
  } else if (kind === "confirmation") {
    ctx.beginPath();
    ctx.arc(x, y, s * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - s * 0.4, y);
    ctx.lineTo(x - s * 0.05, y + s * 0.35);
    ctx.lineTo(x + s * 0.5, y - s * 0.35);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawScoreGauge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  score: number | null,
  accent: string
) {
  const start = Math.PI * 0.8;
  const end = Math.PI * 2.2;
  ctx.save();
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, end, false);
  ctx.stroke();

  if (score != null && Number.isFinite(score)) {
    const t = Math.max(0, Math.min(100, score)) / 100;
    const ang = start + (end - start) * t;
    ctx.strokeStyle = accent;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, ang, false);
    ctx.stroke();
  }

  ctx.fillStyle = C.text;
  ctx.font = "800 34px Segoe UI, Helvetica Neue, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(score != null ? String(Math.round(score)) : "—", cx, cy - 4);
  ctx.fillStyle = C.muted;
  ctx.font = "600 11px Segoe UI, Helvetica Neue, Arial, sans-serif";
  ctx.fillText("SETUP QUALITY", cx, cy + 22);
  ctx.restore();
}

function drawBiasMeter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  position: number,
  label: string
) {
  ctx.fillStyle = C.faint;
  ctx.font = "600 11px Segoe UI, Helvetica Neue, Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("BEARISH", x, y);
  ctx.textAlign = "right";
  ctx.fillText("BULLISH", x + w, y);

  const trackY = y + 12;
  ctx.strokeStyle = C.borderSoft;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, trackY);
  ctx.lineTo(x + w, trackY);
  ctx.stroke();

  const px = x + w * Math.max(0.05, Math.min(0.95, position));
  ctx.fillStyle = C.gold;
  ctx.beginPath();
  ctx.arc(px, trackY, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = C.goldSoft;
  ctx.font = "600 12px Segoe UI, Helvetica Neue, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label, x + w / 2, trackY + 20);
}

function drawCandles(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  candles: ReportCandle[],
  overlays: MarketReportModel["chartOverlays"]
) {
  fillCard(ctx, x, y, w, h, 14);
  const pad = 14;
  const innerX = x + pad;
  const innerY = y + pad + 16;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2 - 20;

  ctx.fillStyle = C.gold;
  ctx.font = "700 12px Segoe UI, Helvetica Neue, Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("PRICE ACTION", x + pad, y + 18);

  let min = Math.min(...candles.map((c) => c.low));
  let max = Math.max(...candles.map((c) => c.high));
  for (const o of overlays) {
    min = Math.min(min, o.price);
    max = Math.max(max, o.price);
  }
  const span = Math.max(0.5, max - min);
  min -= span * 0.06;
  max += span * 0.06;
  const range = max - min;

  for (const o of overlays) {
    const oy = innerY + ((max - o.price) / range) * innerH;
    ctx.strokeStyle =
      o.tone === "live"
        ? "rgba(242,245,248,0.55)"
        : o.tone === "resistance"
          ? "rgba(226,85,85,0.55)"
          : o.tone === "support"
            ? "rgba(47,191,113,0.55)"
            : o.tone === "poc"
              ? "rgba(212,168,75,0.55)"
              : "rgba(147,160,180,0.4)";
    ctx.setLineDash(o.tone === "live" ? [] : [4, 4]);
    ctx.lineWidth = o.tone === "live" ? 1.25 : 1;
    ctx.beginPath();
    ctx.moveTo(innerX, oy);
    ctx.lineTo(innerX + innerW, oy);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const n = candles.length;
  const slot = innerW / n;
  const bodyW = Math.max(2, slot * 0.55);
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
}

function drawStructureLadder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  levels: MarketReportModel["structureLevels"]
) {
  fillCard(ctx, x, y, w, h, 14);
  ctx.fillStyle = C.gold;
  ctx.font = "700 12px Segoe UI, Helvetica Neue, Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("PRICE STRUCTURE", x + 14, y + 18);

  if (!levels.length) {
    ctx.fillStyle = C.muted;
    ctx.font = "500 13px Segoe UI, Helvetica Neue, Arial, sans-serif";
    ctx.fillText("Structure levels unavailable", x + 14, y + 48);
    return;
  }

  const axisX = x + 22;
  const top = y + 36;
  const bottom = y + h - 18;
  const usable = bottom - top;
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(axisX, top);
  ctx.lineTo(axisX, bottom);
  ctx.stroke();

  const prices = levels.map((l) => l.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.max(0.5, max - min);

  for (const lvl of levels) {
    const t = (max - lvl.price) / span;
    const ly = top + t * usable;
    const isCurrent = lvl.kind === "current";
    const color =
      lvl.kind === "current"
        ? C.text
        : lvl.kind === "resistance" || lvl.kind === "vah"
          ? C.resistance
          : lvl.kind === "support" || lvl.kind === "val"
            ? C.support
            : C.gold;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(axisX, ly, isCurrent ? 5.5 : 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = isCurrent ? C.text : C.muted;
    ctx.font = `${isCurrent ? "700" : "600"} ${isCurrent ? 14 : 12}px Segoe UI, Helvetica Neue, Arial, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(lvl.label, axisX + 14, ly - 6);
    ctx.fillStyle = color;
    ctx.font = `${isCurrent ? "800" : "700"} ${isCurrent ? 18 : 14}px Segoe UI, Helvetica Neue, Arial, sans-serif`;
    ctx.fillText(fmt(lvl.price), axisX + 14, ly + 12);

    if (lvl.delta != null && !isCurrent) {
      const sign = lvl.delta > 0 ? "+" : "";
      ctx.fillStyle = C.faint;
      ctx.font = "500 11px Segoe UI, Helvetica Neue, Arial, sans-serif";
      ctx.fillText(`${sign}${lvl.delta.toFixed(2)}`, axisX + 120, ly + 11);
    }
  }
}

function sectionTitle(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  ctx.fillStyle = C.gold;
  ctx.font = "700 12px Segoe UI, Helvetica Neue, Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(text, x, y);
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

  // Background
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, C.bg0);
  grad.addColorStop(1, C.bg1);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  drawGrid(ctx);

  const pad = 28;
  let y = pad;

  // —— Header ——
  const mark = 48;
  if (logo) ctx.drawImage(logo, pad, y, mark, mark);
  else {
    ctx.fillStyle = C.gold;
    roundRect(ctx, pad, y, mark, mark, 10);
    ctx.fill();
  }
  ctx.fillStyle = C.gold;
  ctx.font = "800 26px Segoe UI, Helvetica Neue, Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("GOLDMETA", pad + mark + 14, y + 22);
  ctx.fillStyle = C.muted;
  ctx.font = "500 13px Segoe UI, Helvetica Neue, Arial, sans-serif";
  ctx.fillText("AI Market Intelligence", pad + mark + 14, y + 42);

  ctx.textAlign = "right";
  ctx.fillStyle = C.text;
  ctx.font = "800 22px Segoe UI, Helvetica Neue, Arial, sans-serif";
  ctx.fillText(model.symbol, W - pad, y + 16);
  ctx.fillStyle = C.gold;
  ctx.font = "700 12px Segoe UI, Helvetica Neue, Arial, sans-serif";
  ctx.fillText(model.assetLabel, W - pad, y + 34);
  ctx.fillStyle = C.muted;
  ctx.font = "500 12px Segoe UI, Helvetica Neue, Arial, sans-serif";
  const metaLines = [
    model.marketStatus,
    model.sessionLabel !== "—" ? `Session: ${model.sessionLabel}` : null,
    model.localTimeLine,
    model.secondaryTimeLine
  ].filter(Boolean) as string[];
  let my = y + 50;
  for (const line of metaLines.slice(0, 3)) {
    ctx.fillText(line, W - pad, my);
    my += 16;
  }
  ctx.textAlign = "left";
  y += 72;

  // —— Decision hero ——
  const accent = decisionColor(model.decision);
  const heroH = 168;
  fillCard(ctx, pad, y, W - pad * 2, heroH, 18);
  roundRect(ctx, pad, y, 5, heroH, 2);
  ctx.fillStyle = accent;
  ctx.fill();

  ctx.fillStyle = C.muted;
  ctx.font = "700 11px Segoe UI, Helvetica Neue, Arial, sans-serif";
  ctx.fillText("GOLDMETA MARKET DECISION", pad + 22, y + 24);

  ctx.fillStyle = accent;
  ctx.font = "800 54px Segoe UI, Helvetica Neue, Arial, sans-serif";
  ctx.fillText(model.decision, pad + 22, y + 78);

  ctx.fillStyle = C.muted;
  ctx.font = "500 14px Segoe UI, Helvetica Neue, Arial, sans-serif";
  const subLines = wrapText(ctx, model.decisionSubtext, 420, 2);
  let sy = y + 100;
  for (const line of subLines) {
    ctx.fillText(line, pad + 22, sy);
    sy += 18;
  }

  drawScoreGauge(ctx, W - pad - 110, y + 78, 52, model.scoreTotal, accent);
  ctx.fillStyle = C.faint;
  ctx.font = "600 11px Segoe UI, Helvetica Neue, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(model.scoreDescriptor, W - pad - 110, y + 148);
  ctx.textAlign = "left";

  ctx.fillStyle = C.muted;
  ctx.font = "500 12px Segoe UI, Helvetica Neue, Arial, sans-serif";
  ctx.fillText(`Bias: ${model.biasLabel}`, pad + 22, y + heroH - 18);
  ctx.fillText(`Session: ${model.sessionLabel}`, pad + 250, y + heroH - 18);
  ctx.fillText(`Symbol: ${model.symbol}`, pad + 480, y + heroH - 18);
  y += heroH + 14;

  // Bias meter + price strip
  fillCard(ctx, pad, y, W - pad * 2, 58, 14);
  drawBiasMeter(ctx, pad + 20, y + 16, 360, model.biasPosition, model.biasLabel);
  ctx.textAlign = "right";
  ctx.fillStyle = C.muted;
  ctx.font = "600 11px Segoe UI, Helvetica Neue, Arial, sans-serif";
  ctx.fillText("CURRENT PRICE", W - pad - 20, y + 22);
  ctx.fillStyle = C.text;
  ctx.font = "800 28px Segoe UI, Helvetica Neue, Arial, sans-serif";
  ctx.fillText(fmt(model.livePrice), W - pad - 20, y + 48);
  ctx.textAlign = "left";
  y += 70;

  // Chart + structure
  const hasChart = Boolean(model.candles?.length);
  const leftW = hasChart ? 560 : W - pad * 2;
  const blockH = hasChart ? 230 : 210;
  if (hasChart && model.candles) {
    drawCandles(ctx, pad, y, leftW, blockH, model.candles, model.chartOverlays);
    drawStructureLadder(ctx, pad + leftW + 12, y, W - pad * 2 - leftW - 12, blockH, model.structureLevels);
  } else {
    drawStructureLadder(ctx, pad, y, leftW, blockH, model.structureLevels);
  }
  y += blockH + 12;

  // Market Story
  sectionTitle(ctx, "MARKET STORY", pad, y);
  y += 10;
  const cards = model.storyCards.slice(0, 4);
  const cardGap = 10;
  const cardW = (W - pad * 2 - cardGap * (cards.length - 1)) / Math.max(1, cards.length);
  const cardH = 78;
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]!;
    const cx = pad + i * (cardW + cardGap);
    fillCard(ctx, cx, y, cardW, cardH, 12);
    drawIcon(ctx, card.icon, cx + 22, y + 28, C.gold);
    ctx.fillStyle = C.faint;
    ctx.font = "700 10px Segoe UI, Helvetica Neue, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(card.title.toUpperCase(), cx + 40, y + 24);
    ctx.fillStyle = C.text;
    ctx.font = "700 14px Segoe UI, Helvetica Neue, Arial, sans-serif";
    const lines = wrapText(ctx, card.value, cardW - 28, 2);
    let vy = y + 46;
    for (const line of lines) {
      ctx.fillText(line, cx + 14, vy);
      vy += 16;
    }
  }
  y += cardH + 14;

  // Why + Plan panels
  const colGap = 12;
  const colW = (W - pad * 2 - colGap) / 2;
  const panelH = 210;
  fillCard(ctx, pad, y, colW, panelH, 14);
  ctx.fillStyle = C.gold;
  ctx.font = "700 12px Segoe UI, Helvetica Neue, Arial, sans-serif";
  ctx.fillText(model.whyTitle, pad + 16, y + 22);

  let wy = y + 44;
  for (const item of model.whyItems.slice(0, 4)) {
    const mark = item.state === "pass" ? "✓" : item.state === "fail" ? "✕" : "○";
    ctx.fillStyle =
      item.state === "pass" ? C.buy : item.state === "fail" ? C.sell : C.gold;
    ctx.font = "700 14px Segoe UI, Helvetica Neue, Arial, sans-serif";
    ctx.fillText(mark, pad + 16, wy);
    ctx.fillStyle = C.text;
    ctx.font = "500 13px Segoe UI, Helvetica Neue, Arial, sans-serif";
    const lines = wrapText(ctx, item.text, colW - 50, 2);
    ctx.fillText(lines[0] ?? "", pad + 36, wy);
    wy += lines.length > 1 ? 32 : 26;
  }

  if (model.nextTrigger && model.decision === "WAIT") {
    ctx.fillStyle = C.faint;
    ctx.font = "700 10px Segoe UI, Helvetica Neue, Arial, sans-serif";
    ctx.fillText("NEXT TRIGGER", pad + 16, y + panelH - 42);
    ctx.fillStyle = C.goldSoft;
    ctx.font = "600 13px Segoe UI, Helvetica Neue, Arial, sans-serif";
    const tl = wrapText(ctx, model.nextTrigger, colW - 32, 2);
    let ty = y + panelH - 24;
    for (const line of tl) {
      ctx.fillText(line, pad + 16, ty);
      ty += 16;
    }
  }

  const rightX = pad + colW + colGap;
  fillCard(ctx, rightX, y, colW, panelH, 14);

  if (model.decision === "WAIT" && model.planReadiness) {
    ctx.fillStyle = C.gold;
    ctx.font = "700 12px Segoe UI, Helvetica Neue, Arial, sans-serif";
    ctx.fillText("PLAN READINESS", rightX + 16, y + 22);
    let ry = y + 48;
    for (const row of model.planReadiness) {
      ctx.fillStyle = C.text;
      ctx.font = "600 14px Segoe UI, Helvetica Neue, Arial, sans-serif";
      ctx.fillText(row.label, rightX + 16, ry);
      const statusColor =
        row.status === "READY" ? C.buy : row.status === "FAIL" ? C.sell : C.wait;
      roundRect(ctx, rightX + colW - 110, ry - 14, 90, 22, 11);
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fill();
      ctx.strokeStyle = statusColor;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = statusColor;
      ctx.font = "700 11px Segoe UI, Helvetica Neue, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(row.status, rightX + colW - 65, ry + 1);
      ctx.textAlign = "left";
      ry += 34;
    }
    ctx.fillStyle = C.wait;
    ctx.font = "800 14px Segoe UI, Helvetica Neue, Arial, sans-serif";
    ctx.fillText(model.planReadinessOverall ?? "PLAN NOT READY", rightX + 16, y + panelH - 20);
  } else {
    ctx.fillStyle = C.gold;
    ctx.font = "700 12px Segoe UI, Helvetica Neue, Arial, sans-serif";
    ctx.fillText("TRADE PLAN", rightX + 16, y + 22);
    if (model.tradePlan) {
      const p = model.tradePlan;
      const rows = [
        ["Direction", p.direction],
        ["Entry", fmt(p.entry)],
        ["Stop loss", fmt(p.stopLoss)],
        ["TP1", fmt(p.tp1)],
        ["TP2", fmt(p.tp2)],
        ["TP3", fmt(p.tp3)],
        ["R:R", p.riskReward != null ? String(p.riskReward) : "—"]
      ];
      let py = y + 48;
      for (const [label, value] of rows) {
        ctx.fillStyle = C.muted;
        ctx.font = "500 12px Segoe UI, Helvetica Neue, Arial, sans-serif";
        ctx.fillText(label, rightX + 16, py);
        ctx.fillStyle = C.text;
        ctx.font = "700 13px Segoe UI, Helvetica Neue, Arial, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(value, rightX + colW - 16, py);
        ctx.textAlign = "left";
        py += 22;
      }
    } else {
      ctx.fillStyle = C.muted;
      ctx.font = "700 11px Segoe UI, Helvetica Neue, Arial, sans-serif";
      ctx.fillText("PLAN STATUS", rightX + 16, y + 56);
      ctx.fillStyle = C.wait;
      ctx.font = "800 18px Segoe UI, Helvetica Neue, Arial, sans-serif";
      const lines = wrapText(
        ctx,
        model.planWaitingMessage ?? "WAITING FOR VALID SETUP",
        colW - 32,
        3
      );
      let py = y + 88;
      for (const line of lines) {
        ctx.fillText(line, rightX + 16, py);
        py += 24;
      }
    }
  }
  y += panelH + 12;

  // MTF + Volatility + Session
  const stripH = 86;
  const third = (W - pad * 2 - colGap * 2) / 3;
  // Multi-timeframe
  fillCard(ctx, pad, y, third, stripH, 12);
  sectionTitle(ctx, "MULTI-TIMEFRAME", pad + 12, y + 18);
  if (model.timeframes?.length) {
    let tx = pad + 12;
    const show = model.timeframes.slice(0, 3);
    for (const tf of show) {
      const tone =
        tf.tone === "buy" ? C.buy : tf.tone === "sell" ? C.sell : C.gold;
      ctx.fillStyle = C.muted;
      ctx.font = "700 11px Segoe UI, Helvetica Neue, Arial, sans-serif";
      ctx.fillText(tf.tf, tx, y + 42);
      ctx.fillStyle = tone;
      ctx.font = "700 13px Segoe UI, Helvetica Neue, Arial, sans-serif";
      const dir = tf.direction.length > 12 ? tf.direction.slice(0, 11) + "…" : tf.direction;
      ctx.fillText(dir, tx, y + 62);
      tx += third / show.length;
    }
  } else {
    ctx.fillStyle = C.faint;
    ctx.font = "500 12px Segoe UI, Helvetica Neue, Arial, sans-serif";
    ctx.fillText("No timeframe data", pad + 12, y + 50);
  }

  // Volatility
  const volX = pad + third + colGap;
  fillCard(ctx, volX, y, third, stripH, 12);
  sectionTitle(ctx, "VOLATILITY", volX + 12, y + 18);
  if (model.volatility) {
    ctx.fillStyle = C.faint;
    ctx.font = "600 10px Segoe UI, Helvetica Neue, Arial, sans-serif";
    ctx.fillText("LOW", volX + 12, y + 42);
    ctx.textAlign = "right";
    ctx.fillText("HIGH", volX + third - 12, y + 42);
    ctx.textAlign = "left";
    const trackX = volX + 12;
    const trackW = third - 24;
    const trackY = y + 52;
    ctx.strokeStyle = C.borderSoft;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(trackX, trackY);
    ctx.lineTo(trackX + trackW, trackY);
    ctx.stroke();
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.arc(trackX + trackW * model.volatility.position, trackY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.muted;
    ctx.font = "500 11px Segoe UI, Helvetica Neue, Arial, sans-serif";
    ctx.fillText(model.volatility.caption, volX + 12, y + 74);
  } else {
    ctx.fillStyle = C.faint;
    ctx.font = "500 12px Segoe UI, Helvetica Neue, Arial, sans-serif";
    ctx.fillText("Unavailable", volX + 12, y + 50);
  }

  // Session timeline
  const sesX = volX + third + colGap;
  fillCard(ctx, sesX, y, third, stripH, 12);
  sectionTitle(ctx, "SESSION", sesX + 12, y + 18);
  const ses = model.sessions;
  const sesTrackY = y + 48;
  const sesStart = sesX + 18;
  const sesEnd = sesX + third - 18;
  const step = (sesEnd - sesStart) / Math.max(1, ses.length - 1);
  ctx.strokeStyle = C.borderSoft;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sesStart, sesTrackY);
  ctx.lineTo(sesEnd, sesTrackY);
  ctx.stroke();
  for (let i = 0; i < ses.length; i++) {
    const s = ses[i]!;
    const sx = sesStart + step * i;
    ctx.fillStyle = s.active ? C.gold : C.faint;
    ctx.beginPath();
    ctx.arc(sx, sesTrackY, s.active ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = s.active ? C.goldSoft : C.faint;
    ctx.font = `${s.active ? "700" : "600"} 10px Segoe UI, Helvetica Neue, Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(s.label, sx, sesTrackY + 20);
  }
  ctx.textAlign = "left";
  y += stripH + 12;

  // Key levels + Scenario map
  const keyH = 118;
  const keyW = 320;
  fillCard(ctx, pad, y, keyW, keyH, 12);
  sectionTitle(ctx, "KEY LEVELS", pad + 12, y + 18);
  const keys = model.keyLevels.slice(0, 6);
  const kCols = 3;
  const kRows = Math.ceil(keys.length / kCols) || 1;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    const col = i % kCols;
    const row = Math.floor(i / kCols);
    const kx = pad + 12 + col * ((keyW - 24) / kCols);
    const ky = y + 36 + row * ((keyH - 44) / kRows);
    const tone =
      k.tone === "resistance" || k.tone === "vah"
        ? C.resistance
        : k.tone === "support" || k.tone === "val"
          ? C.support
          : k.tone === "poc"
            ? C.poc
            : C.text;
    ctx.fillStyle = C.faint;
    ctx.font = "700 10px Segoe UI, Helvetica Neue, Arial, sans-serif";
    ctx.fillText(k.label.toUpperCase(), kx, ky);
    ctx.fillStyle = tone;
    ctx.font = "700 14px Segoe UI, Helvetica Neue, Arial, sans-serif";
    ctx.fillText(fmt(k.price), kx, ky + 18);
  }

  const scenX = pad + keyW + 12;
  const scenW = W - pad - scenX;
  fillCard(ctx, scenX, y, scenW, keyH, 12);
  sectionTitle(ctx, "WHAT HAPPENS NEXT?", scenX + 12, y + 18);
  let scy = y + 40;
  for (const sc of model.scenarios.slice(0, 2)) {
    const tone = sc.tone === "buy" ? C.buy : C.sell;
    ctx.fillStyle = tone;
    ctx.font = "700 12px Segoe UI, Helvetica Neue, Arial, sans-serif";
    ctx.fillText(sc.title, scenX + 12, scy);
    ctx.fillStyle = C.text;
    ctx.font = "500 12px Segoe UI, Helvetica Neue, Arial, sans-serif";
    const t1 = wrapText(ctx, sc.trigger, scenW - 24, 1);
    ctx.fillText(t1[0] ?? "", scenX + 12, scy + 16);
    ctx.fillStyle = C.muted;
    ctx.font = "500 12px Segoe UI, Helvetica Neue, Arial, sans-serif";
    ctx.fillText(`→ ${sc.outcome}`, scenX + 12, scy + 34);
    scy += 48;
  }
  y += keyH + 14;

  // Footer — pinned near bottom
  const footerTop = Math.max(y, H - 78);
  ctx.strokeStyle = C.borderSoft;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, footerTop);
  ctx.lineTo(W - pad, footerTop);
  ctx.stroke();

  ctx.fillStyle = C.gold;
  ctx.font = "700 13px Segoe UI, Helvetica Neue, Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(SNAPSHOT_SITE, pad, footerTop + 20);
  ctx.fillStyle = C.muted;
  ctx.font = "500 11px Segoe UI, Helvetica Neue, Arial, sans-serif";
  ctx.fillText("MetaMech Solutions", pad, footerTop + 38);

  ctx.textAlign = "right";
  ctx.fillStyle = C.faint;
  ctx.font = "400 10px Segoe UI, Helvetica Neue, Arial, sans-serif";
  const disc = wrapText(ctx, SNAPSHOT_DISCLAIMER, 560, 2);
  let dy = footerTop + 18;
  for (const line of disc) {
    ctx.fillText(line, W - pad, dy);
    dy += 13;
  }
  ctx.fillText(model.generatedLabel, W - pad, footerTop + 52);
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
