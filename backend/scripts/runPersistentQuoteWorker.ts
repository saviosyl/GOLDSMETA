#!/usr/bin/env npx tsx
/**
 * Always-on Pepperstone XAUUSD quote worker entrypoint.
 *
 * Requires injected secrets (never pass tokens via chat):
 *   CTRADER_CLIENT_ID
 *   CTRADER_CLIENT_SECRET
 *   CTRADER_TOKEN_ENCRYPTION_KEY
 *   CTRADER_REDIRECT_URI (for config completeness)
 *   GOLDMETA_PINNED_OWNER_UID or CTRADER_QUOTE_OWNER_UID
 *
 * Also needs Firebase Admin credentials (GOOGLE_APPLICATION_CREDENTIALS or
 * Application Default Credentials) to read/write the quote store.
 *
 * This process holds a persistent Spotware WebSocket. Cloud Functions HTTP
 * handlers do not.
 */
import { initializeApp, getApps } from "firebase-admin/app";
import {
  PersistentXauUsdQuoteWorker,
  startWorkerHealthServer
} from "../src/services/broker/ctrader/persistentQuoteWorker";

function requireEnv(name: string): string {
  const v = (process.env[name] ?? "").trim();
  if (!v) throw new Error(`${name}_MISSING`);
  return v;
}

async function main() {
  if (getApps().length === 0) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || "goldmeta-web" });
  }

  requireEnv("CTRADER_CLIENT_ID");
  requireEnv("CTRADER_CLIENT_SECRET");
  requireEnv("CTRADER_TOKEN_ENCRYPTION_KEY");

  const ownerUid = (
    process.env.CTRADER_QUOTE_OWNER_UID ||
    process.env.GOLDMETA_PINNED_OWNER_UID ||
    ""
  ).trim();
  if (!ownerUid) {
    throw new Error("CTRADER_QUOTE_OWNER_UID_OR_GOLDMETA_PINNED_OWNER_UID_REQUIRED");
  }

  const worker = new PersistentXauUsdQuoteWorker();
  const server = startWorkerHealthServer(worker);

  const shutdown = async () => {
    console.log(JSON.stringify({ event: "worker_shutdown" }));
    await worker.stop();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  console.log(
    JSON.stringify({
      event: "worker_starting",
      ownerUidHash: ownerUid.slice(0, 6) + "…",
      websocketPersistent: true,
      note: "Cloud Functions HTTP quote path is NOT persistent; this process is."
    })
  );

  await worker.start(ownerUid);
}

main().catch((e) => {
  console.error(
    JSON.stringify({
      event: "worker_fatal",
      error: e instanceof Error ? e.message : String(e)
    })
  );
  process.exit(1);
});
