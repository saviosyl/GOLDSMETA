import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");
const outDir = path.join(root, "docs", "ux", "decision-dashboard-v3");

const baseCss = `
  body { margin: 0; background: #eef3f8; color: #172033; font-family: Inter, Arial, sans-serif; }
  .phone { width: 390px; min-height: 844px; padding: 18px; box-sizing: border-box; background: #f7f9fc; }
  .card { display: grid; gap: 14px; border: 1px solid #d8e0ea; border-left: 5px solid #c79a2b; border-radius: 22px; background: white; padding: 16px; box-shadow: 0 16px 38px rgba(14, 35, 66, .12); }
  .buy { border-left-color: #166534; } .sell { border-left-color: #991b1b; } .wait { border-left-color: #b45309; }
  .feed, .alerts, .fact, .levels div { border: 1px solid #d8e0ea; border-radius: 16px; background: #f7f9fc; padding: 12px; }
  .feed.green { background: #f0fdf4; border-color: #9bd5aa; } .feed.amber { background: #fffbeb; border-color: #e5bd6b; } .feed.red { background: #fef2f2; border-color: #e89b9b; }
  .pill { display:inline-grid; place-items:center; min-height:26px; min-width:58px; border-radius:999px; background:#11284a; color:white; font-size:11px; font-weight:800; }
  h1 { margin: 0; color: #11284a; font-size: 52px; line-height: .95; letter-spacing: -.05em; }
  h2, p { margin: 0; } .muted { color: #64748b; font-size: 13px; } .label { color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; font-weight: 800; }
  .levels { display:grid; grid-template-columns: 1fr 1fr; gap:10px; } .levels strong { display:block; color:#11284a; font-size:22px; margin-top:4px; }
  .button { min-height:44px; border-radius: 999px; background:#11284a; color:white; display:grid; place-items:center; font-weight:800; }
  .admin { width: 920px; padding: 28px; box-sizing: border-box; background:#f7f9fc; }
  .wide { display:grid; gap:14px; max-width:820px; }
`;

function dashboard({ mode, feed = "green", levels = false }) {
  const title =
    mode === "ready" ? "BUY PLAN READY" : mode === "potential" ? "POTENTIAL BUY" : "WAIT";
  const state =
    mode === "ready"
      ? "5-minute confirmation passed"
      : mode === "potential"
        ? "Waiting for 5-minute confirmation"
        : "No valid trade plan yet";
  return `
    <main class="phone">
      <section class="card ${mode === "wait" ? "wait" : "buy"}">
        <div class="feed ${feed}">
          <span class="pill">${feed.toUpperCase()}</span>
          <h2>GoldMeta Market Feed</h2>
          <p class="muted">${feed === "green" ? "All systems operational" : "Live quote updates limited"}</p>
          <p>Live price updates ${feed === "green" ? "active" : "limited"}</p>
        </div>
        <div><p class="label">XAUUSD decision</p><h1>${title}</h1><p><strong>${state}</strong></p></div>
        ${
          levels
            ? `<div class="levels"><div><span class="label">Entry zone</span><strong>4,040 - 4,042</strong></div><div><span class="label">Stop</span><strong>4,036.00</strong></div><div><span class="label">TP1</span><strong>4,048.00</strong></div><div><span class="label">TP2</span><strong>4,054.00</strong></div></div>`
            : `<p>GoldMeta is monitoring XAUUSD. You can be notified when a valid opportunity becomes ready.</p><div class="levels"><div><span class="label">Nearest support</span><strong>4,031.10</strong></div><div><span class="label">Nearest resistance</span><strong>4,037.31</strong></div></div><p class="muted">This is the next analysis review, not a guaranteed signal time.</p>`
        }
        <div class="fact"><span class="label">5M confirmation</span><p><strong>${mode === "ready" ? "Passed" : "Pending"}</strong></p></div>
        <div class="fact"><span class="label">Next useful action</span><p><strong>${mode === "wait" ? "Wait for a valid plan." : mode === "potential" ? "Wait for 5M confirmation." : "Review your own risk before manual entry."}</strong></p></div>
        <div class="alerts"><h2>Permission required</h2><p class="muted">Tap Enable phone alerts to request notification permission on this device.</p><div class="button">Enable phone alerts</div></div>
        <p class="muted">Manual plan only - Review your own risk before entering - Analysis only</p>
      </section>
    </main>`;
}

const pages = {
  "wait-mobile.png": dashboard({ mode: "wait", feed: "green" }),
  "potential-mobile.png": dashboard({ mode: "potential", feed: "amber", levels: true }),
  "ready-mobile.png": dashboard({ mode: "ready", feed: "green", levels: true }),
  "admin-feed-status.png": `
    <main class="admin"><section class="wide"><h1 style="font-size:38px">Admin market-feed status</h1>
    <div class="feed green"><span class="pill">GREEN</span><h2>GoldMeta Market Feed</h2><p>All systems operational</p><p class="muted">Shared webhook URL for 1M / 5M / 15M</p></div>
    <div class="fact"><strong>No recent legacy traffic detected</strong><p class="muted">Checklist from admin feed API</p></div></section></main>`,
  "notification-preferences.png": `
    <main class="phone"><section class="card"><h1 style="font-size:42px">Notifications</h1><div class="fact"><strong>VALID PLAN CREATED - BUY</strong><p>Potential buy plan created.</p><p class="muted">Plan ID: plan-1 - Unread</p></div>
    ${["Valid plan created","Entry zone approaching","Entry zone reached","5M confirmation","Plan invalidated","Targets reached"].map((x) => `<label class="fact"><input type="checkbox"> ${x}</label>`).join("")}
    <div class="button">Send test notification</div></section></main>`
};

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 900 }, deviceScaleFactor: 1 });
for (const [filename, body] of Object.entries(pages)) {
  await page.setContent(`<!doctype html><html><head><style>${baseCss}</style></head><body>${body}</body></html>`);
  await page.locator("main").screenshot({ path: path.join(outDir, filename) });
}
await browser.close();
