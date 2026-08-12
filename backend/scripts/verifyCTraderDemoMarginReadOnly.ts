#!/usr/bin/env npx tsx
/**
 * READ-ONLY Pepperstone Demo margin smoke.
 *
 * NEVER calls place/submit/amend/close order APIs.
 * Prints only redacted diagnostics (no tokens/secrets).
 *
 * Usage (from backend/):
 *   npx tsx scripts/verifyCTraderDemoMarginReadOnly.ts
 */
import { initializeApp, getApps, applicationDefault } from "firebase-admin/app";
import { getConnection } from "../src/services/broker/ctrader/connectionStore";
import { ensureFreshAccessToken } from "../src/services/broker/ctrader/connectionService";
import {
  probeDemoMarginReadOnly,
  type DemoMarginReadOnlyProbe
} from "../src/services/broker/ctrader/openApiClient";
import {
  isBrokerExecutionEnabled,
  isCTraderLiveEnabled,
  snapshotCTraderFlags
} from "../src/services/broker/ctrader/flags";

const SAMPLE_PROTOCOL_VOLUME = 1700; // 17 lots — ExpectedMarginReq is read-only

function fail(msg: string): never {
  console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(1);
}

async function main(): Promise<void> {
  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.GCLOUD_PROJECT || "goldmeta-web"
    });
  }

  const ownerUid = (process.env.GOLDMETA_PINNED_OWNER_UID || "").trim();
  if (!ownerUid || ownerUid.length < 10) {
    fail("GOLDMETA_PINNED_OWNER_UID missing/invalid");
  }

  // Live hard-lock proof before any broker IO.
  if (isCTraderLiveEnabled()) {
    fail("isCTraderLiveEnabled() unexpectedly true");
  }
  if (isBrokerExecutionEnabled()) {
    fail("isBrokerExecutionEnabled() unexpectedly true");
  }
  const flags = snapshotCTraderFlags();
  if (flags.CTRADER_LIVE_ENABLED || flags.BROKER_EXECUTION_ENABLED) {
    fail("Live / broker-execution flags not hard-false");
  }

  const connection = await getConnection(ownerUid);
  if (!connection) fail("CTRADER_NOT_CONNECTED");

  if (connection.selectedAccountIsLive || connection.environment === "LIVE") {
    fail("Selected account is LIVE — smoke refuses to operate");
  }
  if (connection.environment !== "DEMO") {
    fail(`Expected DEMO environment, got ${connection.environment}`);
  }
  if (!connection.selectedAccountId) {
    fail("No selected Demo account");
  }
  if (connection.oauthScope !== "trading") {
    fail(`OAuth scope must be trading, got ${connection.oauthScope}`);
  }
  if (!connection.brokerConfirmedPepperstone) {
    fail("Pepperstone not confirmed");
  }
  const symbolId = connection.symbolId;
  if (!symbolId) fail("XAUUSD symbolId not resolved on connection");

  const clientId = (process.env.CTRADER_CLIENT_ID || "").trim();
  const clientSecret = (process.env.CTRADER_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    fail("CTRADER_CLIENT_ID / CTRADER_CLIENT_SECRET required");
  }

  const { accessToken } = await ensureFreshAccessToken(connection);

  // Absolute guard: this script must not import order mutation entrypoints.
  // (Static check — runtime never calls them.)
  const forbidden = [
    "placeDemoMarketOrder",
    "submitDemoMarketOrder",
    "amendDemoPositionSlTp",
    "closeDemoPosition"
  ];
  // Touch probe only.
  const probe: DemoMarginReadOnlyProbe = await probeDemoMarginReadOnly({
    accessToken,
    clientId,
    clientSecret,
    ctidTraderAccountId: connection.selectedAccountId!,
    symbolId: String(symbolId),
    protocolVolume: SAMPLE_PROTOCOL_VOLUME,
    accountMasked: connection.selectedAccountMasked ?? "48…??"
  });

  const report = {
    ok: probe.ok,
    readOnly: true,
    ordersSubmitted: probe.ordersSubmitted,
    forbiddenApisNotCalled: forbidden,
    liveLocks: {
      CTRADER_LIVE_ENABLED: flags.CTRADER_LIVE_ENABLED,
      isCTraderLiveEnabled: isCTraderLiveEnabled(),
      isBrokerExecutionEnabled: isBrokerExecutionEnabled(),
      mutationFlagsHardFalse: flags.mutationFlagsHardFalse
    },
    account: {
      masked: probe.accountMasked,
      environment: "DEMO",
      oauthScope: "trading",
      selectedAccountIsLive: false
    },
    trader: {
      moneyDigits: probe.moneyDigits,
      balance: probe.balance
    },
    reconcile: {
      openPositionCount: probe.openPositionCount
    },
    pnl: {
      payloadAccepted: probe.pnlPayloadAccepted,
      responsePayloadType: probe.pnlResponsePayloadType
    },
    marginSnapshot: {
      usedMarginTotal: probe.usedMarginTotal,
      unrealisedNetPnl: probe.unrealisedNetPnl,
      equity: probe.equity,
      freeMargin: probe.freeMargin,
      source: probe.marginSource
    },
    expectedMargin: {
      symbolId: probe.symbolId,
      requestedProtocolVolume: probe.requestedProtocolVolume,
      buyMargin: probe.buyMargin,
      sellMargin: probe.sellMargin,
      selectedBuy: probe.selectedExpectedMarginBuy,
      selectedSell: probe.selectedExpectedMarginSell,
      exactFinalVolumeUnits: probe.requestedProtocolVolume === SAMPLE_PROTOCOL_VOLUME
    },
    runtimeTypes: probe.runtimeTypes,
    notes: probe.notes,
    ctraderLayerVersion: (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("@reiryoku/ctrader-layer/package.json").version as string;
      } catch {
        return null;
      }
    })()
  };

  console.log(JSON.stringify(report, null, 2));

  if (!probe.pnlPayloadAccepted) {
    fail("ProtoOAGetPositionUnrealizedPnLReq was not accepted — do not merge");
  }
  if (probe.ordersSubmitted !== 0) {
    fail("ordersSubmitted != 0 — unexpected mutation");
  }
  if (
    probe.buyMargin == null ||
    probe.sellMargin == null ||
    !(probe.buyMargin > 0) ||
    !(probe.sellMargin > 0)
  ) {
    fail("ExpectedMargin buy/sell not valid positive numbers");
  }
  if (probe.requestedProtocolVolume !== SAMPLE_PROTOCOL_VOLUME) {
    fail("ExpectedMargin volume contract mismatch");
  }

  // Flat-account invariants when reconcile proves zero opens.
  if (probe.openPositionCount === 0) {
    if (probe.usedMarginTotal !== 0) fail("flat: usedMargin must be 0");
    if (probe.unrealisedNetPnl !== 0) fail("flat: unrealisedNetPnl must be 0");
    if (probe.balance == null || probe.equity !== probe.balance) {
      fail("flat: equity must equal balance");
    }
    if (probe.freeMargin !== probe.balance) {
      fail("flat: freeMargin must equal balance");
    }
    if (probe.marginSource !== "BROKER_FLAT") {
      fail("flat: marginSource must be BROKER_FLAT");
    }
  } else {
    // Open positions: every position must have contributed usedMargin (snapshot ok).
    if (probe.usedMarginTotal == null || !Number.isFinite(probe.usedMarginTotal)) {
      fail("open: usedMarginTotal missing");
    }
    if (
      probe.unrealisedNetPnl == null ||
      !Number.isFinite(probe.unrealisedNetPnl)
    ) {
      fail("open: unrealisedNetPnl missing");
    }
  }

  if (!probe.ok) {
    fail(`probe ok=false notes=${probe.notes.join("; ")}`);
  }
}

main().catch((e) => {
  fail(e instanceof Error ? e.message : String(e));
});
