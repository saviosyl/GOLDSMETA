/**
 * READ-ONLY production UI screenshot audit.
 * Signs in via Firebase custom token (never logged). Does not mutate production state.
 */
import { createRequire } from "module";
const require = createRequire("/workspace/web/package.json");
const { chromium } = require("playwright");
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.GM_AUDIT_OUT || "/workspace/docs/ui/current-production";
const BASE = "https://goldmeta.metamechsolutions.com";
const BUILD = "83ff6ee54bedb98e6308040b128ceb6291930672";
const API_KEY = process.env.VITE_FIREBASE_API_KEY;
const TOKEN_PATH = "/tmp/gm-audit-custom-token.txt";

const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 430, height: 932 };

const USER_PAGES = [
  { n: "01", slug: "plan", route: "/", name: "Plan" },
  { n: "02", slug: "levels", route: "/levels", name: "Levels" },
  { n: "03", slug: "markets", route: "/intelligence", name: "Markets / Intelligence" },
  { n: "04", slug: "journal", route: "/journal", name: "Journal" },
  { n: "05", slug: "alerts", route: "/alerts", name: "Alerts" },
  { n: "06", slug: "research", route: "/v4", name: "Research" },
  { n: "07", slug: "analytics", route: "/analytics", name: "Analytics" },
  { n: "08", slug: "performance", route: "/autotrade/performance", name: "Performance" },
  { n: "09", slug: "history", route: "/history", name: "History" },
  { n: "10", slug: "replay", route: "/replay", name: "Replay" },
  { n: "11", slug: "risk-planner", route: "/planner", name: "Risk Planner" },
  { n: "12", slug: "autotrade", route: "/autotrade", name: "AutoTrade" },
  { n: "13", slug: "broker", route: "/brokers", name: "Broker" },
  { n: "14", slug: "settings", route: "/settings", name: "Settings" },
  { n: "15", slug: "help", route: "/help", name: "Help" },
  { n: "16", slug: "signal-performance", route: "/signal-performance", name: "Signal Performance" },
  { n: "17", slug: "analysis", route: "/analysis", name: "Analysis" },
  { n: "18", slug: "tradingview-setup", route: "/tradingview", name: "TradingView Setup" }
];

const ADMIN_PAGES = [
  { n: "A01", slug: "admin-users", route: "/admin/users", name: "Admin Users" },
  {
    n: "A02",
    slug: "admin-tradingview-template",
    route: "/admin/tradingview-template",
    name: "TradingView Template"
  },
  { n: "A03", slug: "admin-diagnostics", route: "/diagnostics", name: "Diagnostics" }
];

const AUTH_PUBLIC = [
  { n: "P01", slug: "sign-in", route: "/", name: "Sign In", public: true },
  { n: "P02", slug: "register", route: "/register", name: "Register", public: true }
];

function ensureDirs() {
  for (const d of ["desktop", "mobile", "admin"]) {
    mkdirSync(join(ROOT, d), { recursive: true });
  }
}

async function signInWithCustomTokenInBrowser(page, customToken) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(1000);

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
        return { ok: true, uid: auth.currentUser && auth.currentUser.uid };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
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

  if (!ok?.ok) {
    throw new Error(`Browser custom-token sign-in failed: ${ok?.error || "unknown"}`);
  }

  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(5000);
}

async function settle(page, route) {
  await page.waitForLoadState("domcontentloaded", { timeout: 90_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  const waitMs = route === "/" || route === "/autotrade" || route === "/brokers" ? 8000 : 4500;
  await page.waitForTimeout(waitMs);

  await page.evaluate(async () => {
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const h = Math.max(
      document.body?.scrollHeight || 0,
      document.documentElement?.scrollHeight || 0
    );
    const step = Math.max(400, Math.floor(window.innerHeight * 0.85));
    for (let y = 0; y < h; y += step) {
      window.scrollTo(0, y);
      await delay(200);
    }
    window.scrollTo(0, h);
    await delay(400);
    window.scrollTo(0, 0);
    await delay(400);
  });

  if (route === "/") {
    await page.waitForTimeout(4000);
  }
}

async function capture(page, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath, fullPage: true, type: "png" });
}

async function isSignedOut(page) {
  const hasPassword = (await page.locator('input[type="password"]').count()) > 0;
  const text = await page.locator("body").innerText().catch(() => "");
  return hasPassword && /Sign in|Welcome back|Create account/i.test(text);
}

async function openMobileMore(page) {
  const candidates = [
    page.getByRole("button", { name: /^more$/i }),
    page.getByTestId("nav-more"),
    page.getByTestId("mobile-nav-more"),
    page.locator('button:has-text("More")'),
    page.locator('[aria-label*="More" i]'),
    page.locator("nav >> text=More")
  ];
  for (const loc of candidates) {
    try {
      if (await loc.first().isVisible({ timeout: 1500 })) {
        await loc.first().click({ timeout: 3000 });
        await page.waitForTimeout(900);
        return true;
      }
    } catch {
      /* try next */
    }
  }
  return false;
}

async function findFirstHistoryDetail(page) {
  await page.goto(`${BASE}/history`, { waitUntil: "networkidle", timeout: 90_000 });
  await settle(page, "/history");
  const link = page.locator('a[href^="/history/"]').first();
  if ((await link.count()) > 0) {
    const href = await link.getAttribute("href");
    if (href && href.split("/").filter(Boolean).length >= 2) return href;
  }
  return null;
}

async function findFirstSetupDetail(page) {
  const selectors = ['a[href^="/setups/"]'];
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) {
      const href = await loc.getAttribute("href");
      if (href) return href;
    }
  }
  return null;
}

function upsert(results, row) {
  const idx = results.findIndex((r) => r.n === row.n && r.slug === row.slug);
  if (idx >= 0) results[idx] = { ...results[idx], ...row };
  else results.push(row);
}

async function main() {
  if (!API_KEY) throw new Error("VITE_FIREBASE_API_KEY missing");
  if (!existsSync(TOKEN_PATH)) throw new Error("Custom token file missing — STOP");
  const customToken = readFileSync(TOKEN_PATH, "utf8").trim();
  try {
    unlinkSync(TOKEN_PATH);
  } catch {
    writeFileSync(TOKEN_PATH, "");
  }

  ensureDirs();
  const browser = await chromium.launch({ headless: true });
  const results = [];

  const context = await browser.newContext({
    viewport: DESKTOP,
    deviceScaleFactor: 1,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 GoldMetaAudit/1.0"
  });
  const page = await context.newPage();

  console.log("Signing in with custom token (not logged)...");
  await signInWithCustomTokenInBrowser(page, customToken);

  if (await isSignedOut(page)) {
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(4000);
  }
  if (await isSignedOut(page)) {
    console.error("AUTH_BLOCKER: authenticated production session could not be established safely");
    await browser.close();
    process.exit(2);
  }
  console.log("Authenticated session OK");

  // DESKTOP
  await page.setViewportSize(DESKTOP);
  for (const p of USER_PAGES) {
    const file = `${p.n}-${p.slug}-desktop.png`;
    try {
      await page.goto(`${BASE}${p.route}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await settle(page, p.route);
      await capture(page, join(ROOT, "desktop", file));
      upsert(results, { ...p, desktop: file, desktopStatus: "Captured", notes: "" });
      console.log("DESKTOP", file);
    } catch (e) {
      upsert(results, {
        ...p,
        desktop: file,
        desktopStatus: "FAILED",
        notes: String(e.message || e).slice(0, 120)
      });
      console.error("FAIL desktop", p.route, e.message || e);
    }
  }

  let historyDetail = null;
  let setupDetail = null;
  try {
    historyDetail = await findFirstHistoryDetail(page);
  } catch {
    historyDetail = null;
  }
  if (historyDetail) {
    const file = "19-history-detail-desktop.png";
    await page.goto(`${BASE}${historyDetail}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await settle(page, historyDetail);
    await capture(page, join(ROOT, "desktop", file));
    upsert(results, {
      n: "19",
      slug: "history-detail",
      route: historyDetail,
      name: "History Detail",
      desktop: file,
      desktopStatus: "Captured",
      notes: "Real production record"
    });
  } else {
    upsert(results, {
      n: "19",
      slug: "history-detail",
      route: "/history/:decisionId",
      name: "History Detail",
      desktop: null,
      desktopStatus: "NO REAL PRODUCTION RECORD AVAILABLE",
      notes: ""
    });
  }

  await page.goto(`${BASE}/history`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await settle(page, "/history");
  try {
    setupDetail = await findFirstSetupDetail(page);
  } catch {
    setupDetail = null;
  }
  if (!setupDetail) {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await settle(page, "/");
    setupDetail = await findFirstSetupDetail(page);
  }
  if (setupDetail) {
    const file = "20-setup-detail-desktop.png";
    await page.goto(`${BASE}${setupDetail}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await settle(page, setupDetail);
    await capture(page, join(ROOT, "desktop", file));
    upsert(results, {
      n: "20",
      slug: "setup-detail",
      route: setupDetail,
      name: "Setup Detail",
      desktop: file,
      desktopStatus: "Captured",
      notes: "Real production record"
    });
  } else {
    upsert(results, {
      n: "20",
      slug: "setup-detail",
      route: "/setups/:setupId",
      name: "Setup Detail",
      desktop: null,
      desktopStatus: "NO REAL PRODUCTION RECORD AVAILABLE",
      notes: ""
    });
  }

  for (const p of ADMIN_PAGES) {
    const file = `${p.n}-${p.slug}-desktop.png`;
    try {
      await page.goto(`${BASE}${p.route}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await settle(page, p.route);
      await capture(page, join(ROOT, "admin", file));
      upsert(results, {
        ...p,
        desktop: file,
        desktopStatus: "Captured",
        notes: "ADMIN",
        admin: true
      });
      console.log("ADMIN", file);
    } catch (e) {
      upsert(results, {
        ...p,
        desktop: file,
        desktopStatus: "FAILED",
        notes: "ADMIN " + String(e.message || e).slice(0, 100),
        admin: true
      });
    }
  }

  // MOBILE
  await page.setViewportSize(MOBILE);
  for (const p of USER_PAGES) {
    const file = `${p.n}-${p.slug}-mobile.png`;
    try {
      await page.goto(`${BASE}${p.route}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await settle(page, p.route);
      await capture(page, join(ROOT, "mobile", file));
      upsert(results, { n: p.n, slug: p.slug, mobile: file, mobileStatus: "Captured" });
      console.log("MOBILE", file);
    } catch (e) {
      upsert(results, {
        n: p.n,
        slug: p.slug,
        mobile: file,
        mobileStatus: "FAILED",
        notes: String(e.message || e).slice(0, 80)
      });
    }
  }

  try {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await settle(page, "/");
    const opened = await openMobileMore(page);
    const file = "00-mobile-more-nav-open.png";
    await capture(page, join(ROOT, "mobile", file));
    upsert(results, {
      n: "00",
      slug: "mobile-more-nav",
      route: "/ (MORE open)",
      name: "Mobile MORE navigation",
      mobile: file,
      mobileStatus: opened
        ? "Captured"
        : "Captured (MORE control not found — page state only)",
      notes: opened ? "MORE sheet open" : "MORE control not found"
    });
    console.log("MOBILE MORE", opened);
  } catch (e) {
    upsert(results, {
      n: "00",
      slug: "mobile-more-nav",
      name: "Mobile MORE navigation",
      mobileStatus: "FAILED",
      notes: String(e.message || e).slice(0, 100)
    });
  }

  if (historyDetail) {
    const file = "19-history-detail-mobile.png";
    await page.goto(`${BASE}${historyDetail}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await settle(page, historyDetail);
    await capture(page, join(ROOT, "mobile", file));
    upsert(results, { n: "19", slug: "history-detail", mobile: file, mobileStatus: "Captured" });
  }
  if (setupDetail) {
    const file = "20-setup-detail-mobile.png";
    await page.goto(`${BASE}${setupDetail}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await settle(page, setupDetail);
    await capture(page, join(ROOT, "mobile", file));
    upsert(results, { n: "20", slug: "setup-detail", mobile: file, mobileStatus: "Captured" });
  }

  for (const p of ADMIN_PAGES) {
    const file = `${p.n}-${p.slug}-mobile.png`;
    try {
      await page.goto(`${BASE}${p.route}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await settle(page, p.route);
      await capture(page, join(ROOT, "admin", file));
      upsert(results, { n: p.n, slug: p.slug, mobile: file, mobileStatus: "Captured", admin: true });
      console.log("ADMIN MOBILE", file);
    } catch (e) {
      console.error("FAIL admin mobile", p.route, e.message || e);
    }
  }

  await context.close();

  // Public auth (signed-out context)
  const publicCtx = await browser.newContext({ viewport: DESKTOP });
  const pub = await publicCtx.newPage();
  for (const p of AUTH_PUBLIC) {
    for (const [vp, folder, suffix] of [
      [DESKTOP, "desktop", "desktop"],
      [MOBILE, "mobile", "mobile"]
    ]) {
      await pub.setViewportSize(vp);
      const file = `${p.n}-${p.slug}-${suffix}.png`;
      try {
        // Clear storage so we see signed-out UI
        await pub.goto(`${BASE}${p.route === "/" ? "/register" : p.route}`, {
          waitUntil: "domcontentloaded",
          timeout: 90_000
        });
        await pub.evaluate(() => {
          try {
            localStorage.clear();
            sessionStorage.clear();
          } catch {
            /* ignore */
          }
        });
        await pub.goto(`${BASE}${p.route}`, { waitUntil: "networkidle", timeout: 90_000 });
        await pub.waitForTimeout(2500);
        await capture(pub, join(ROOT, folder, file));
        const patch =
          suffix === "desktop"
            ? { desktop: file, desktopStatus: "Captured" }
            : { mobile: file, mobileStatus: "Captured" };
        upsert(results, {
          ...p,
          ...patch,
          notes: "Public auth (signed-out context; owner account unchanged)"
        });
        console.log("PUBLIC", file);
      } catch (e) {
        console.error("FAIL public", p.route, e.message || e);
      }
    }
  }
  await publicCtx.close();
  await browser.close();

  writeFileSync(
    join(ROOT, "capture-results.json"),
    JSON.stringify(
      {
        productionUrl: BASE,
        productionBuild: BUILD,
        capturedAt: new Date().toISOString(),
        desktopViewport: DESKTOP,
        mobileViewport: MOBILE,
        results
      },
      null,
      2
    )
  );
  console.log("DONE rows=", results.length);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
