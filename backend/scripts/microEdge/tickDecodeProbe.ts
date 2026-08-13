/**
 * One-shot probe for historical tick decode reasons. No token/price dumps.
 */
import { initializeApp, getApps } from "firebase-admin/app";
import {
  credentialsFromVault,
  refreshVaultTokensIfNeeded
} from "../../src/services/microEdge/marketData/oauthService";
import { createMicroTokenVault } from "../../src/services/microEdge/marketData/tokenVault";
import { RealMicroCTraderTransport } from "../../src/services/microEdge/marketData/microCTraderTransport";
import { resolveMicroXauUsd } from "../../src/services/microEdge/marketData/microCTraderSymbolResolver";
import { decodeHistoricalTickData } from "../../src/services/microEdge/marketData/historicalTicks";
import { MICRO_QUOTE_TYPE } from "../../src/services/microEdge/marketData/microCTraderProtocol";

async function main(): Promise<void> {
  if (!getApps().length) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || "goldmeta-web" });
  }
  void createMicroTokenVault();
  const uid = (process.env.MICRO_COLLECTOR_VAULT_UID ?? "").trim();
  if (!uid) throw new Error("MICRO_COLLECTOR_VAULT_UID_MISSING");
  await refreshVaultTokensIfNeeded(uid);
  const creds = await credentialsFromVault(uid);
  if (!creds) throw new Error("MICRO_VAULT_CREDENTIALS_UNAVAILABLE");

  const transport = new RealMicroCTraderTransport(creds);
  await transport.connect();
  const symbols = await transport.listSymbols();
  const resolved = resolveMicroXauUsd(symbols);
  if (!resolved) throw new Error("MICRO_XAUUSD_NOT_FOUND");

  const now = Date.now();
  const fromMs = now - 30 * 60 * 1000;
  for (const side of ["BID", "ASK"] as const) {
    const raw = (await transport.sendReadCommand("ProtoOAGetTickDataReq", {
      ctidTraderAccountId: Number(creds.accountId),
      symbolId: Number(resolved.symbolId),
      type: MICRO_QUOTE_TYPE[side],
      fromTimestamp: fromMs,
      toTimestamp: now
    })) as { tickData?: unknown; hasMore?: boolean };
    const list = Array.isArray(raw.tickData) ? raw.tickData : [];
    const first = (list[0] ?? null) as { timestamp?: unknown; tick?: unknown } | null;
    const second = (list[1] ?? null) as { timestamp?: unknown; tick?: unknown } | null;
    console.log(
      JSON.stringify({
        side,
        hasMore: raw.hasMore ?? false,
        tickCount: list.length,
        keys: first ? Object.keys(first).sort() : [],
        firstAbsLikely: first ? Number(first.timestamp) > 1e12 : null,
        secondDeltaLikely: second
          ? Math.abs(Number(second.timestamp)) < 1e9
          : null
      })
    );
    try {
      const decoded = decodeHistoricalTickData(raw.tickData, {
        side,
        fromMs,
        toMs: now,
        digits: resolved.digits
      });
      console.log(JSON.stringify({ side, decodedWithWindow: decoded.length }));
    } catch (e) {
      console.log(
        JSON.stringify({
          side,
          errWindow: (e as Error).message,
          reason: (e as { reason?: string }).reason
        })
      );
    }
    try {
      const decoded = decodeHistoricalTickData(raw.tickData, {
        side,
        digits: resolved.digits
      });
      console.log(
        JSON.stringify({
          side,
          decodedNoWindow: decoded.length,
          spanMs:
            decoded.length > 0
              ? decoded[decoded.length - 1]!.brokerTimestampMs -
                decoded[0]!.brokerTimestampMs
              : 0
        })
      );
    } catch (e) {
      console.log(
        JSON.stringify({
          side,
          errNoWindow: (e as Error).message,
          reason: (e as { reason?: string }).reason
        })
      );
    }
  }
  await transport.disconnect();
}

main().catch((e) => {
  console.error(
    JSON.stringify({
      fatal: (e as Error).message,
      code: (e as { code?: string }).code,
      reason: (e as { reason?: string }).reason
    })
  );
  process.exit(1);
});
