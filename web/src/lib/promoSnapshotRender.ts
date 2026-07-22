/**
 * High-resolution canvas renderer for GoldMeta Market Snapshot PNG export.
 */

import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  SNAPSHOT_DISCLAIMER,
  SNAPSHOT_SITE,
  decisionTone,
  getSnapshotFormat,
  toneColor,
  type PromoSnapshotModel,
  type SnapshotOptions
} from "./promoSnapshot";

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "Unavailable";
  return Number(n).toFixed(2);
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
    if (ctx.measureText(test).width <= maxWidth) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (lines.length < maxLines && cur) {
    if (lines.length === maxLines - 1) {
      // truncate last
      let last = cur;
      while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 3) {
        last = last.slice(0, -1);
      }
      lines.push(ctx.measureText(cur).width > maxWidth ? `${last}…` : cur);
    } else {
      lines.push(cur);
    }
  }
  return lines.slice(0, maxLines);
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

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  const step = 48;
  for (let x = 0; x < w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
}

export async function renderPromoSnapshotPng(
  model: PromoSnapshotModel,
  options: SnapshotOptions,
  logoUrl = "/brand/mark-official.png"
): Promise<Blob> {
  const format = getSnapshotFormat(options.formatId);
  const { width: W, height: H } = format;
  const palette = options.theme === "dark" ? DARK_PALETTE : LIGHT_PALETTE;
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
  const pad = options.formatId === "compact" ? 36 : options.formatId === "story" ? 56 : 48;
  const contentW = W - pad * 2;
  let y = pad;

  // Background
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, W, H);
  drawGrid(ctx, W, H, palette.grid);

  // Soft card
  roundRect(ctx, pad - 8, pad - 8, contentW + 16, H - pad * 2 + 16, 28);
  ctx.fillStyle = palette.surface;
  ctx.fill();
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Header
  const markSize = options.formatId === "compact" ? 52 : 64;
  if (logo) {
    ctx.drawImage(logo, pad + 16, y, markSize, markSize);
  } else {
    ctx.fillStyle = palette.gold;
    roundRect(ctx, pad + 16, y, markSize, markSize, 12);
    ctx.fill();
  }
  ctx.fillStyle = palette.navy;
  if (options.theme === "dark") ctx.fillStyle = palette.gold;
  ctx.font = `700 ${options.formatId === "compact" ? 28 : 34}px Inter, system-ui, sans-serif`;
  ctx.fillText("GOLDMETA", pad + 16 + markSize + 16, y + 28);
  ctx.fillStyle = palette.muted;
  ctx.font = `500 ${options.formatId === "compact" ? 16 : 18}px Inter, system-ui, sans-serif`;
  ctx.fillText("AI Market Intelligence", pad + 16 + markSize + 16, y + 52);

  // Right meta
  ctx.textAlign = "right";
  ctx.fillStyle = palette.gold;
  ctx.font = `700 ${options.formatId === "compact" ? 16 : 18}px Inter, system-ui, sans-serif`;
  ctx.fillText("XAUUSD", W - pad - 16, y + 26);
  ctx.fillStyle = palette.muted;
  ctx.font = `500 ${options.formatId === "compact" ? 14 : 16}px Inter, system-ui, sans-serif`;
  ctx.fillText(`${model.compactTime} · ${model.timeZone}`, W - pad - 16, y + 50);
  if (model.sessionLabel && model.sessionLabel !== "—") {
    ctx.fillText(model.sessionLabel, W - pad - 16, y + 72);
  }
  ctx.textAlign = "left";
  y += markSize + (options.formatId === "compact" ? 18 : 28);

  // Label
  ctx.fillStyle = palette.muted;
  ctx.font = `600 14px Inter, system-ui, sans-serif`;
  ctx.fillText("GoldMeta Market Snapshot", pad + 16, y);
  y += options.formatId === "compact" ? 18 : 26;

  // Primary signal block
  const tone = decisionTone(model.decision);
  const signalColor =
    tone === "buy" ? palette.buy : tone === "sell" ? palette.sell : palette.wait;
  const signalH = options.formatId === "compact" ? 110 : 150;
  roundRect(ctx, pad + 12, y, contentW - 24, signalH, 20);
  ctx.fillStyle = options.theme === "dark" ? "rgba(255,255,255,0.03)" : "rgba(17,40,74,0.03)";
  ctx.fill();
  ctx.strokeStyle = signalColor;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = signalColor;
  ctx.font = `800 ${options.formatId === "compact" ? 42 : 64}px Inter, system-ui, sans-serif`;
  ctx.fillText(model.decision, pad + 36, y + (options.formatId === "compact" ? 48 : 70));
  ctx.fillStyle = palette.text;
  ctx.font = `600 ${options.formatId === "compact" ? 16 : 20}px Inter, system-ui, sans-serif`;
  ctx.fillText(model.analysisLabel, pad + 36, y + (options.formatId === "compact" ? 78 : 108));

  ctx.textAlign = "right";
  ctx.fillStyle = palette.muted;
  ctx.font = `500 14px Inter, system-ui, sans-serif`;
  ctx.fillText("Price", W - pad - 36, y + 36);
  ctx.fillStyle = palette.text;
  ctx.font = `700 ${options.formatId === "compact" ? 26 : 34}px Inter, system-ui, sans-serif`;
  ctx.fillText(fmt(model.livePrice), W - pad - 36, y + 70);
  ctx.fillStyle = palette.muted;
  ctx.font = `500 14px Inter, system-ui, sans-serif`;
  ctx.fillText("GoldMeta Score", W - pad - 36, y + 98);
  ctx.fillStyle = palette.navy;
  if (options.theme === "dark") ctx.fillStyle = palette.gold;
  ctx.font = `700 ${options.formatId === "compact" ? 22 : 28}px Inter, system-ui, sans-serif`;
  ctx.fillText(
    model.scoreTotal != null ? `${model.scoreTotal} / 100` : "Unavailable",
    W - pad - 36,
    y + (options.formatId === "compact" ? 122 : 132)
  );
  ctx.textAlign = "left";
  y += signalH + (options.formatId === "compact" ? 14 : 22);

  // Story
  if (options.showStory && model.story && options.formatId !== "compact") {
    ctx.fillStyle = palette.navy;
    if (options.theme === "dark") ctx.fillStyle = palette.gold;
    ctx.font = `700 18px Inter, system-ui, sans-serif`;
    ctx.fillText("Market Story", pad + 16, y);
    y += 22;
    ctx.fillStyle = palette.text;
    ctx.font = `400 ${options.formatId === "story" ? 20 : 18}px Inter, system-ui, sans-serif`;
    const maxLines = options.formatId === "story" ? 5 : options.formatId === "square" ? 3 : 4;
    const lines = wrapText(ctx, model.story, contentW - 32, maxLines);
    for (const line of lines) {
      ctx.fillText(line, pad + 16, y);
      y += options.formatId === "story" ? 28 : 24;
    }
    y += 10;
  }

  // Levels
  const levelBudget =
    options.formatId === "compact"
      ? 3
      : options.formatId === "square"
        ? 5
        : options.formatId === "story"
          ? 8
          : 6;
  const levels = model.levels.slice(0, levelBudget);
  if (levels.length) {
    ctx.fillStyle = palette.navy;
    if (options.theme === "dark") ctx.fillStyle = palette.gold;
    ctx.font = `700 18px Inter, system-ui, sans-serif`;
    ctx.fillText("Market Structure", pad + 16, y);
    y += 16;
    const rowH = options.formatId === "compact" ? 36 : 44;
    for (const lvl of levels) {
      const color = toneColor(lvl.isLive ? "live" : lvl.tone, palette);
      roundRect(ctx, pad + 12, y, contentW - 24, rowH - 6, 12);
      ctx.fillStyle = lvl.isLive
        ? options.theme === "dark"
          ? "rgba(255,255,255,0.08)"
          : "rgba(17,40,74,0.06)"
        : options.theme === "dark"
          ? "rgba(255,255,255,0.03)"
          : "rgba(17,40,74,0.02)";
      ctx.fill();
      if (lvl.isLive) {
        ctx.strokeStyle = palette.navy;
        if (options.theme === "dark") ctx.strokeStyle = palette.gold;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pad + 28, y + (rowH - 6) / 2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = palette.text;
      ctx.font = `700 ${options.formatId === "compact" ? 16 : 18}px Inter, system-ui, sans-serif`;
      ctx.fillText(fmt(lvl.price), pad + 42, y + (options.formatId === "compact" ? 22 : 26));
      ctx.fillStyle = palette.muted;
      ctx.font = `500 ${options.formatId === "compact" ? 12 : 14}px Inter, system-ui, sans-serif`;
      ctx.fillText(lvl.classification, pad + 160, y + (options.formatId === "compact" ? 22 : 26));

      // strength bar
      const barW = 90;
      const barX = W - pad - 24 - barW;
      const barY = y + (rowH - 6) / 2 - 4;
      ctx.fillStyle = palette.border;
      roundRect(ctx, barX, barY, barW, 8, 4);
      ctx.fill();
      ctx.fillStyle = color;
      roundRect(ctx, barX, barY, Math.max(6, (barW * lvl.strength) / 100), 8, 4);
      ctx.fill();
      y += rowH;
    }
    y += 8;
  }

  // Optional score breakdown
  if (options.showScoreBreakdown && model.scoreComponents?.length && options.formatId === "story") {
    ctx.fillStyle = palette.navy;
    if (options.theme === "dark") ctx.fillStyle = palette.gold;
    ctx.font = `700 18px Inter, system-ui, sans-serif`;
    ctx.fillText("Score readiness", pad + 16, y);
    y += 20;
    const chips = model.scoreComponents.slice(0, 5);
    let cx = pad + 16;
    for (const c of chips) {
      const label = `${c.label} ${c.score}/${c.max}`;
      ctx.font = `600 14px Inter, system-ui, sans-serif`;
      const tw = ctx.measureText(label).width + 20;
      roundRect(ctx, cx, y, tw, 28, 14);
      ctx.fillStyle = palette.border;
      ctx.fill();
      ctx.fillStyle = palette.text;
      ctx.fillText(label, cx + 10, y + 19);
      cx += tw + 8;
    }
    y += 42;
  }

  // Plan
  if (options.showPlan) {
    ctx.fillStyle = palette.navy;
    if (options.theme === "dark") ctx.fillStyle = palette.gold;
    ctx.font = `700 18px Inter, system-ui, sans-serif`;
    ctx.fillText("Trade Plan", pad + 16, y);
    y += 10;
    if (model.plan) {
      roundRect(ctx, pad + 12, y, contentW - 24, options.formatId === "compact" ? 90 : 120, 16);
      ctx.fillStyle = options.theme === "dark" ? "rgba(124,58,237,0.12)" : "rgba(124,58,237,0.06)";
      ctx.fill();
      ctx.fillStyle = palette.research;
      ctx.font = `700 14px Inter, system-ui, sans-serif`;
      ctx.fillText("SHADOW PLAN  ·  NOT AN EXECUTED TRADE", pad + 28, y + 24);
      ctx.fillStyle = palette.text;
      ctx.font = `600 ${options.formatId === "compact" ? 14 : 16}px Inter, system-ui, sans-serif`;
      const planLine = `${model.plan.direction}  Entry ${fmt(model.plan.entry)}  SL ${fmt(model.plan.stopLoss)}  TP1 ${fmt(model.plan.tp1)}`;
      ctx.fillText(planLine, pad + 28, y + 52);
      if (options.formatId !== "compact") {
        ctx.fillStyle = palette.muted;
        ctx.font = `500 14px Inter, system-ui, sans-serif`;
        ctx.fillText(
          `TP2 ${fmt(model.plan.tp2)}  ·  TP3 ${fmt(model.plan.tp3)}  ·  R:R ${model.plan.riskReward ?? "Unavailable"}  ·  ${model.plan.status}`,
          pad + 28,
          y + 78
        );
      }
      y += options.formatId === "compact" ? 100 : 132;
    } else {
      ctx.fillStyle = palette.muted;
      ctx.font = `500 16px Inter, system-ui, sans-serif`;
      ctx.fillText("GoldMeta is waiting for a validated setup.", pad + 16, y + 24);
      y += 44;
    }
  }

  // Footer — pin near bottom for tall formats
  const footerY = Math.max(y + 20, H - pad - (options.formatId === "story" ? 110 : 90));
  ctx.fillStyle = palette.watermark;
  ctx.font = `800 48px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("GOLDMETA", W / 2, footerY);
  ctx.textAlign = "left";

  ctx.fillStyle = palette.gold;
  ctx.font = `700 16px Inter, system-ui, sans-serif`;
  ctx.fillText(SNAPSHOT_SITE, pad + 16, footerY + 28);
  ctx.fillStyle = palette.muted;
  ctx.font = `500 14px Inter, system-ui, sans-serif`;
  ctx.fillText("by MetaMech Solutions", pad + 16, footerY + 48);
  ctx.font = `400 12px Inter, system-ui, sans-serif`;
  const discLines = wrapText(ctx, SNAPSHOT_DISCLAIMER, contentW - 32, 2);
  let dy = footerY + 68;
  for (const line of discLines) {
    ctx.fillText(line, pad + 16, dy);
    dy += 16;
  }
  if (model.utcSecondary) {
    ctx.fillStyle = palette.muted;
    ctx.font = `400 11px Inter, system-ui, sans-serif`;
    ctx.fillText(`UTC ${model.utcSecondary}`, pad + 16, Math.min(dy + 4, H - pad + 4));
  }

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
