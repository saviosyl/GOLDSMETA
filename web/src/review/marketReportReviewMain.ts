/**
 * Review-only page: renders WAIT / BUY / SELL Market Report PNGs into window.__MARKET_REPORTS__.
 * Used by scripts/generate-market-report-review.mjs — not a production route.
 */

import { buildMarketReportReviewCases } from "../fixtures/marketReportReviewFixtures";
import { buildPromoSnapshotModel } from "../lib/promoSnapshot";
import { buildMarketReportModel } from "../lib/marketReportModel";
import { renderMarketReportPng } from "../lib/marketReportRender";

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

async function main() {
  const status = document.getElementById("status");
  const cases = buildMarketReportReviewCases();
  const out: Record<string, { filename: string; decision: string; pngBase64: string; width: number; height: number }> =
    {};

  for (const c of cases) {
    if (status) status.textContent = `Rendering ${c.filename}…`;
    const snapshot = buildPromoSnapshotModel(c.input);
    const report = buildMarketReportModel(snapshot, snapshot.reportContext);
    const blob = await renderMarketReportPng(report, "/brand/mark-official.png");
    out[c.id] = {
      filename: c.filename,
      decision: c.id,
      pngBase64: await blobToBase64(blob),
      width: 1080,
      height: 1350
    };
  }

  (window as unknown as { __MARKET_REPORTS__: typeof out }).__MARKET_REPORTS__ = out;
  if (status) status.textContent = "Ready";
  document.documentElement.dataset.reportsReady = "1";
}

void main().catch((err) => {
  const status = document.getElementById("status");
  if (status) status.textContent = err instanceof Error ? err.message : String(err);
  document.documentElement.dataset.reportsError = "1";
  console.error(err);
});
