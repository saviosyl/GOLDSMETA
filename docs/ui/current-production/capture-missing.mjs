/**
 * Complete missing audit captures only (admin mobile, public auth, detail pages).
 * READ-ONLY — no production mutations.
 */
import { createRequire } from "module";
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from "fs";
import { join } from "path";

const require = createRequire("/workspace/web/package.json");
const { chromium } = require("playwright");

const ROOT = "/workspace/docs/ui/current-production";
const BASE = "https://goldmeta.metamechsolutions.com";
const BUILD = "83ff6ee54bedb98e6308040b128ceb6291930672";
const API_KEY = process.env.VITE_FIREBASE_API_KEY;
const TOKEN_PATH = "/tmp/gm-audit-custom-token.txt";
const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 430, height: 932 };

async function signIn(page, customToken) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.addScriptTag({
    url: "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"
  });
  await page.addScriptTag({
    url: "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"
  });
  const ok = await page.evaluate(
    async ({ apiKey, authDomain, projectId, appId, customToken }) => {
      try {
        if (!firebase.apps.length) {
          firebase.initializeApp({ apiKey, authDomain, projectId, appId });
        }
        const auth = firebase.auth();
        await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        await auth.signInWithCustomToken(customToken);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    },
    {
      apiKey: API_KEY,
      authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.VITE_FIREBASE_PROJECT_ID,
      appId: process.env.VITE_FIREBASE_APP_ID,
      customToken
    }
  );
  if (!ok.ok) throw new Error(ok.error);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(4000);
}

async function settle(page, extra = 4000) {
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(extra);
  await page.evaluate(async () => {
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    for (let y = 0; y < h; y += 500) {
      window.scrollTo(0, y);
      await delay(150);
    }
    window.scrollTo(0, 0);
  });
}

async function shot(page, path) {
  mkdirSync(join(path, ".."), { recursive: true });
  await page.screenshot({ path, fullPage: true, type: "png" });
}

async function main() {
  const customToken = readFileSync(TOKEN_PATH, "utf8").trim();
  try {
    unlinkSync(TOKEN_PATH);
  } catch {
    /* ignore */
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: MOBILE });
  const page = await ctx.newPage();
  await signIn(page, customToken);

  // Admin mobile
  await page.setViewportSize(MOBILE);
  for (const [n, slug, route] of [
    ["A01", "admin-users", "/admin/users"],
    ["A02", "admin-tradingview-template", "/admin/tradingview-template"],
    ["A03", "admin-diagnostics", "/diagnostics"]
  ]) {
    const file = `${n}-${slug}-mobile.png`;
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await settle(page);
    await shot(page, join(ROOT, "admin", file));
    console.log("ADMIN MOBILE", file);
  }

  // Detail pages
  await page.setViewportSize(DESKTOP);
  await page.goto(`${BASE}/history`, { waitUntil: "networkidle", timeout: 90_000 });
  await settle(page);
  const hist = page.locator('a[href^="/history/"]').first();
  let historyDetail = null;
  if ((await hist.count()) > 0) historyDetail = await hist.getAttribute("href");
  const setup = page.locator('a[href^="/setups/"]').first();
  let setupDetail = null;
  if ((await setup.count()) > 0) setupDetail = await setup.getAttribute("href");
  if (!setupDetail) {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await settle(page);
    if ((await page.locator('a[href^="/setups/"]').count()) > 0) {
      setupDetail = await page.locator('a[href^="/setups/"]').first().getAttribute("href");
    }
  }

  const detailMeta = { historyDetail, setupDetail };
  writeFileSync(join(ROOT, "detail-routes.json"), JSON.stringify(detailMeta, null, 2));

  for (const [label, href, n, slug] of [
    ["history", historyDetail, "19", "history-detail"],
    ["setup", setupDetail, "20", "setup-detail"]
  ]) {
    if (!href) {
      console.log("NO REAL PRODUCTION RECORD AVAILABLE", label);
      continue;
    }
    for (const [vp, folder, suffix] of [
      [DESKTOP, "desktop", "desktop"],
      [MOBILE, "mobile", "mobile"]
    ]) {
      await page.setViewportSize(vp);
      const file = `${n}-${slug}-${suffix}.png`;
      await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await settle(page, 5000);
      await shot(page, join(ROOT, folder, file));
      console.log("DETAIL", file);
    }
  }

  await ctx.close();

  // Public auth signed-out
  const pubCtx = await browser.newContext({ viewport: DESKTOP });
  const pub = await pubCtx.newPage();
  for (const [n, slug, route] of [
    ["P01", "sign-in", "/"],
    ["P02", "register", "/register"]
  ]) {
    for (const [vp, folder, suffix] of [
      [DESKTOP, "desktop", "desktop"],
      [MOBILE, "mobile", "mobile"]
    ]) {
      await pub.setViewportSize(vp);
      await pub.goto(`${BASE}/register`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await pub.evaluate(() => {
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch {
          /* ignore */
        }
      });
      // Force signed-out by using a fresh context each pair would be better; clear + goto
      await pub.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 90_000 });
      await pub.waitForTimeout(2000);
      // If still authenticated from shared storage on same context, open new context
      const hasPw = (await pub.locator('input[type="password"]').count()) > 0;
      if (!hasPw && route === "/") {
        // likely still signed in — open brand new context
        const fresh = await browser.newContext({ viewport: vp });
        const fp = await fresh.newPage();
        await fp.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 90_000 });
        await fp.waitForTimeout(2000);
        await shot(fp, join(ROOT, folder, `${n}-${slug}-${suffix}.png`));
        await fresh.close();
      } else {
        await shot(pub, join(ROOT, folder, `${n}-${slug}-${suffix}.png`));
      }
      console.log("PUBLIC", `${n}-${slug}-${suffix}.png`);
    }
  }
  await pubCtx.close();
  await browser.close();

  // Build results manifest from filesystem
  const desktop = readdirSync(join(ROOT, "desktop")).filter((f) => f.endsWith(".png"));
  const mobile = readdirSync(join(ROOT, "mobile")).filter((f) => f.endsWith(".png"));
  const admin = readdirSync(join(ROOT, "admin")).filter((f) => f.endsWith(".png"));
  writeFileSync(
    join(ROOT, "capture-results.json"),
    JSON.stringify(
      {
        productionUrl: BASE,
        productionBuild: BUILD,
        capturedAt: new Date().toISOString(),
        desktopViewport: DESKTOP,
        mobileViewport: MOBILE,
        counts: { desktop: desktop.length, mobile: mobile.length, admin: admin.length },
        desktop,
        mobile,
        admin,
        detailRoutes: detailMeta
      },
      null,
      2
    )
  );
  console.log("COMPLETE", { desktop: desktop.length, mobile: mobile.length, admin: admin.length });
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
