/**
 * Generate review-only Market Report PNGs (WAIT / BUY / SELL).
 * Does NOT deploy anything.
 *
 * Usage from web/:
 *   node scripts/generate-market-report-review.mjs [outDir]
 */
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, "..");
const outDir = process.argv[2]
  ? join(process.cwd(), process.argv[2])
  : join(webRoot, "../docs/ux/market-report-review");
const artDir = "/opt/cursor/artifacts/market-report-review";

mkdirSync(outDir, { recursive: true });
mkdirSync(artDir, { recursive: true });

const server = await createServer({
  root: webRoot,
  configFile: join(webRoot, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 5198, strictPort: false },
  optimizeDeps: { entries: [join(webRoot, "market-report-review.html")] }
});
await server.listen();
const urls = server.resolvedUrls?.local?.length
  ? server.resolvedUrls.local
  : [`http://127.0.0.1:${server.config.server.port || 5198}`];
const baseUrl = urls[0].replace(/\/$/, "");
console.log("vite", baseUrl);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1200, height: 900 },
  deviceScaleFactor: 1
});

try {
  await page.goto(`${baseUrl}/market-report-review.html`, {
    waitUntil: "domcontentloaded",
    timeout: 120000
  });
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.reportsReady === "1" ||
      document.documentElement.dataset.reportsError === "1",
    null,
    { timeout: 120000 }
  );
  if ((await page.evaluate(() => document.documentElement.dataset.reportsError)) === "1") {
    const msg = await page.locator("#status").innerText();
    throw new Error(`Report generation failed: ${msg}`);
  }

  const reports = await page.evaluate(() => window.__MARKET_REPORTS__);
  if (!reports || !reports.WAIT || !reports.BUY || !reports.SELL) {
    throw new Error("Missing WAIT/BUY/SELL report payloads");
  }

  const v2Names = {
    WAIT: "01-WAIT-Report-FINAL.png",
    BUY: "02-BUY-Report-FINAL.png",
    SELL: "03-SELL-Report-FINAL.png"
  };

  for (const key of ["WAIT", "BUY", "SELL"]) {
    const r = reports[key];
    const filename = v2Names[key] || r.filename;
    const buf = Buffer.from(r.pngBase64, "base64");
    const dest = join(outDir, filename);
    writeFileSync(dest, buf);
    copyFileSync(dest, join(artDir, filename));
    // Flat artifact names requested by owner review
    copyFileSync(dest, join("/opt/cursor/artifacts", filename));
    console.log("wrote", filename, buf.length, "bytes", `${r.width}x${r.height}`);
  }
} finally {
  await browser.close();
  await server.close();
}

console.log("done →", outDir);
if (existsSync(join(artDir, "01-WAIT-Report.png"))) {
  console.log("artifacts →", artDir);
}
