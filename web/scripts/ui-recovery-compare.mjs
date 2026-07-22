import { chromium } from "@playwright/test";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../docs/v5-4-3-ui-recovery");
const BASELINE_DIST = "/tmp/gm-384eb56/web/dist";
const REPAIR_DIST = path.resolve(__dirname, "../dist");

fs.mkdirSync(OUT, { recursive: true });

function serve(root, port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      if (urlPath.endsWith("/")) urlPath += "index.html";
      const filePath = path.join(root, urlPath);
      const safe = filePath.startsWith(root) ? filePath : path.join(root, "index.html");
      fs.readFile(safe, (err, data) => {
        if (err) {
          fs.readFile(path.join(root, "index.html"), (err2, html) => {
            res.writeHead(err2 ? 404 : 200, { "Content-Type": "text/html" });
            res.end(err2 ? "not found" : html);
          });
          return;
        }
        const ext = path.extname(safe);
        const type =
          ext === ".js"
            ? "application/javascript"
            : ext === ".css"
              ? "text/css"
              : ext === ".svg"
                ? "image/svg+xml"
                : ext === ".png"
                  ? "image/png"
                  : ext === ".webmanifest"
                    ? "application/manifest+json"
                    : "text/html";
        res.writeHead(200, { "Content-Type": type });
        res.end(data);
      });
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

const shots = [
  { name: "dashboard-desktop-1440", w: 1440, h: 900, path: "/ui-review/" },
  { name: "dashboard-tablet-768", w: 768, h: 1024, path: "/ui-review/" },
  { name: "dashboard-mobile-390", w: 390, h: 844, path: "/ui-review/" },
  { name: "dashboard-mobile-430", w: 430, h: 932, path: "/ui-review/" },
  { name: "signin-mobile-390", w: 390, h: 844, path: "/" },
  { name: "settings-mobile-390", w: 390, h: 844, path: "/ui-review/settings" },
  { name: "score-expanded-390", w: 390, h: 844, path: "/ui-review/", prep: "score" },
  { name: "market-map-390", w: 390, h: 844, path: "/ui-review/", prep: "map" }
];

async function capture(label, baseUrl) {
  const browser = await chromium.launch();
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: { width: shot.w, height: shot.h } });
    await page.goto(baseUrl + shot.path, { waitUntil: "networkidle", timeout: 60000 });
    if (shot.prep === "score") {
      const expand = page.getByTestId("score-expand");
      if (await expand.count()) await expand.click();
    }
    if (shot.prep === "map") {
      const ladder = page.getByTestId("market-level-ladder");
      if (await ladder.count()) await ladder.scrollIntoViewIfNeeded();
    }
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, `${label}-${shot.name}.png`), fullPage: false });
    await page.close();
  }
  await browser.close();
}

const baselineServer = await serve(BASELINE_DIST, 4177);
const repairServer = await serve(REPAIR_DIST, 4178);
await capture("baseline", "http://127.0.0.1:4177");
await capture("repaired", "http://127.0.0.1:4178");
baselineServer.close();
repairServer.close();
console.log("captured baseline + repaired screenshots to", OUT);
