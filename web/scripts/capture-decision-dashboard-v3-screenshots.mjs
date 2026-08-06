import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");
const outDir = path.join(root, "docs", "ux", "decision-dashboard-v3");

const baseCss = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #eef3f8; color: #172033; font-family: Inter, Arial, sans-serif; overflow-x: hidden; }
  .phone { width: 100%; max-width: 390px; min-height: 700px; padding: 12px; background: #f7f9fc; }
  .card { display: grid; gap: 10px; border: 1px solid #d8e0ea; border-left: 4px solid #b45309; border-radius: 14px; background: white; padding: 12px; width: 100%; max-width: 100%; }
  .feed { display:grid; grid-template-columns: auto 1fr; gap:8px; align-items:center; border:1px solid #e5bd6b; border-radius:12px; background:#fffbeb; padding:8px 10px; }
  .feed.green { background:#f0fdf4; border-color:#9bd5aa; }
  .pill { display:inline-grid; place-items:center; min-height:24px; min-width:48px; border-radius:999px; background:#11284a; color:white; font-size:10px; font-weight:800; }
  h1 { margin: 0; color: #11284a; font-size: 28px; line-height: 1; letter-spacing: -.04em; }
  h2, p { margin: 0; } .muted { color: #64748b; font-size: 12px; } .label { color: #64748b; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; font-weight: 800; }
  .levels { display:grid; grid-template-columns: 1fr 1fr; gap:8px; } .levels div { border:1px solid #d8e0ea; border-radius:10px; padding:8px 10px; background:#fff; } .levels strong { display:block; color:#11284a; font-size:18px; margin-top:2px; }
  .row { display:flex; gap:8px; align-items:center; }
  .button { min-height:44px; border-radius: 999px; background:#11284a; color:white; display:grid; place-items:center; font-weight:800; font-size:13px; padding:0 14px; }
  .ghost { min-height:44px; border:1px solid #d8e0ea; border-radius:12px; display:grid; place-items:center; font-weight:700; color:#11284a; }
  .sheet { position:relative; width:100%; max-width:390px; min-height:640px; background:#0f172a66; padding-top:80px; }
  .drawer { position:absolute; left:0; right:0; bottom:0; width:100%; max-width:100vw; background:white; border-radius:18px 18px 0 0; padding:12px 12px 72px; max-height:88%; overflow:auto; }
  .item { border:1px solid #d8e0ea; border-radius:12px; padding:10px; background:#f7f9fc; margin-top:8px; overflow-wrap:anywhere; }
  .pref { display:grid; grid-template-columns:22px 1fr; gap:8px; align-items:center; min-height:44px; border:1px solid #d8e0ea; border-radius:10px; padding:6px 8px; margin-top:6px; }
`;

function dashboard({ width, feed = "amber" }) {
  return `
    <main class="phone" style="max-width:${width}px">
      <section class="card">
        <div class="feed ${feed === "green" ? "green" : ""}">
          <span class="pill">${feed === "green" ? "GREEN" : "AMBER"}</span>
          <div><strong>Market feed: ${feed === "green" ? "Operational" : "Limited"}</strong><div class="muted">${feed === "green" ? "Live quotes" : "Quotes limited"} · 30s ago</div></div>
        </div>
        <div><h1>WAIT</h1><p><strong>No valid plan yet</strong></p></div>
        <p><span class="label">Next check</span> <strong>7m 39s</strong></p>
        <div class="levels">
          <div><span class="label">Support</span><strong>4,253.22</strong></div>
          <div><span class="label">Resistance</span><strong>4,259.64</strong></div>
        </div>
        <div class="row"><div class="button" style="flex:1">Enable alerts</div></div>
        <div class="ghost">Why waiting?</div>
        <p class="muted">Manual only · Review your risk · AutoTrade OFF</p>
      </section>
    </main>`;
}

const pages = {
  "wait-mobile-320.png": dashboard({ width: 320 }),
  "wait-mobile-375.png": dashboard({ width: 375 }),
  "wait-mobile.png": dashboard({ width: 390 }),
  "notification-drawer-mobile.png": `
    <main class="sheet" style="max-width:390px">
      <section class="drawer">
        <div class="row" style="justify-content:space-between"><div><h2 style="margin:0;font-size:18px;color:#11284a">Notifications</h2><p class="muted">1 unread</p></div><div class="ghost" style="min-width:64px;padding:0 12px">Close</div></div>
        <div class="item"><strong>VALID PLAN CREATED · BUY</strong><p style="margin:6px 0 0">Potential buy plan created with a longer explanation for wrapping on small screens.</p><p class="muted">Plan plan-long-identifier-123 · Unread</p></div>
        <h3 style="margin:14px 0 0;font-size:14px;color:#11284a">Alert preferences</h3>
        ${["Valid plan created","Entry zone approaching","Entry zone reached","5M confirmation","Plan invalidated","Targets reached"].map((x) => `<label class="pref"><input type="checkbox"> <span>${x}</span></label>`).join("")}
        <div class="button" style="margin-top:10px">Send test notification</div>
      </section>
    </main>`
};

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
for (const [filename, body] of Object.entries(pages)) {
  const width = filename.includes("320") ? 320 : filename.includes("375") ? 375 : 390;
  const page = await browser.newPage({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>${baseCss}</style></head><body>${body}</body></html>`);
  await page.locator("main").screenshot({ path: path.join(outDir, filename) });
  await page.close();
}
await browser.close();
console.log(`Wrote compact screenshots to ${outDir}`);
