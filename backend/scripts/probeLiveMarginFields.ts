/**
 * Read-only margin field probe for LIVE selected account.
 * Never mutates selection or submits orders.
 */
import { initializeApp, getApps } from "firebase-admin/app";
import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { getConnection } from "../src/services/broker/ctrader/connectionStore";
import { ensureFreshAccessToken } from "../src/services/broker/ctrader/connectionService";
import { maskAccountId } from "../src/services/broker/ctrader/tokenCrypto";
import { writeFileSync } from "node:fs";

async function main() {
  if (!getApps().length) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || "goldmeta-web" });
  }
  const uid = (process.env.GOLDMETA_PINNED_OWNER_UID || "").trim();
  const conn = await getConnection(uid);
  if (!conn?.selectedAccountId) throw new Error("NO_SELECTED");
  const { accessToken, connection } = await ensureFreshAccessToken(conn);
  const id = Number(connection.selectedAccountId);
  const c = new CTraderConnection({
    host: "live.ctraderapi.com",
    port: 5035
  });
  await c.open();
  try {
    await c.sendCommand("ProtoOAApplicationAuthReq", {
      clientId: process.env.CTRADER_CLIENT_ID,
      clientSecret: process.env.CTRADER_CLIENT_SECRET
    });
    await c.sendCommand("ProtoOAAccountAuthReq", {
      accessToken,
      ctidTraderAccountId: id
    });
    const trader = (await c.sendCommand("ProtoOATraderReq", {
      ctidTraderAccountId: id
    })) as Record<string, unknown>;
    const t = (trader.trader ?? trader) as Record<string, unknown>;
    const digits = Number(t.moneyDigits ?? 2);
    const scale = 10 ** digits;
    const money = (v: unknown) =>
      v == null || v === "" ? null : Number(v) / scale;
    let recon: Record<string, unknown> | null = null;
    try {
      recon = (await c.sendCommand("ProtoOAReconcileReq", {
        ctidTraderAccountId: id
      })) as Record<string, unknown>;
    } catch (e) {
      recon = { error: e instanceof Error ? e.message : String(e) };
    }
    const out = {
      maskedAccount: maskAccountId(String(connection.selectedAccountId)),
      moneyDigits: digits,
      trader: {
        balance: money(t.balance),
        equity: money(t.equity),
        freeMargin: money(t.freeMargin),
        usedMargin: money(t.usedMargin),
        hasFreeMarginField: t.freeMargin != null,
        hasUsedMarginField: t.usedMargin != null,
        hasEquityField: t.equity != null,
        leverage:
          t.leverageInCents != null
            ? Number(t.leverageInCents) / 100
            : t.leverage ?? null
      },
      reconcile: {
        balance: money(recon?.balance),
        equity: money(recon?.equity),
        freeMargin: money(recon?.freeMargin),
        usedMargin: money(recon?.usedMargin),
        keys: recon ? Object.keys(recon).sort() : [],
        positionCount: Array.isArray(recon?.position)
          ? recon.position.length
          : Array.isArray(recon?.positions)
            ? (recon.positions as unknown[]).length
            : null,
        orderCount: Array.isArray(recon?.order)
          ? recon.order.length
          : Array.isArray(recon?.orders)
            ? (recon.orders as unknown[]).length
            : null
      }
    };
    writeFileSync(
      "/opt/cursor/artifacts/live-margin-probe-funded.json",
      JSON.stringify(out, null, 2)
    );
    console.log(JSON.stringify(out, null, 2));
  } finally {
    try {
      void c.close();
    } catch {
      /* ignore */
    }
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
