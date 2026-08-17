/**
 * Broker-facing Demo margin refresh + expected-margin lookup.
 * Demo host only. Never invents freeMargin from balance when positions unknown.
 */

import { loadCTraderConfig } from "./config";
import {
  getConnection,
  loadTokenEncryptionSecret,
  persistRotatedTokensAtomic
} from "./connectionStore";
import { refreshAccessToken } from "./oauth";
import { type CTraderOpenApiClient } from "./openApiClient";
import { decryptTokenPayload, encryptTokenPayload } from "./tokenCrypto";
import { type MarginGateResult } from "./authoritativeMargin";
import { isCTraderLiveEnabled } from "./flags";
import { denyCTraderMutation } from "./mutationGuard";
import { runAuthoritativeMarginSequence } from "./fastAutoTrade/marginSequence";
import { withFastDemoSession } from "./fastAutoTrade/demoSession";
import { withBoundedOp } from "./fastAutoTrade/boundedOp";

export type DemoMarginGateArgs = {
  ownerUid: string;
  side: "BUY" | "SELL";
  /** Final protocol volume (cents) after step rounding — never rawLots. */
  protocolVolume: number;
  symbolId: string;
  /** Optional inject for tests. */
  openApiClient?: CTraderOpenApiClient;
  nowMs?: number;
  maxAgeMs?: number;
};

async function ensureFreshAccessToken(ownerUid: string): Promise<{
  accessToken: string;
  connection: NonNullable<Awaited<ReturnType<typeof getConnection>>>;
}> {
  const cfg = loadCTraderConfig();
  const clientId = (process.env.CTRADER_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.CTRADER_CLIENT_SECRET ?? "").trim();
  if (!cfg.configured || !clientId || !clientSecret) {
    throw new Error("CONFIGURATION_REQUIRED");
  }

  const connection = await getConnection(ownerUid);
  if (!connection) throw new Error("CTRADER_NOT_CONNECTED");
  const secret = loadTokenEncryptionSecret();
  if (!secret) throw new Error("[REDACTED]_KEY");
  const payload = JSON.parse(
    decryptTokenPayload(connection.tokens.ciphertext, secret)
  ) as { accessToken?: string; refreshToken?: string };
  if (!payload.accessToken || !payload.refreshToken) {
    throw new Error("CTRADER_TOKENS_MISSING");
  }

  let accessToken = payload.accessToken;
  let refreshToken = payload.refreshToken;
  let tokenVersion = connection.tokens.tokenVersion ?? 0;
  let freshConn = connection;

  const expiresAt = Date.parse(connection.tokens.accessExpiresAt);
  const stale =
    !Number.isFinite(expiresAt) || expiresAt < Date.now() + 60_000;
  if (stale) {
    const rotated = await refreshAccessToken({
      clientId,
      clientSecret,
      refreshToken
    });
    const ciphertext = encryptTokenPayload(
      JSON.stringify({
        accessToken: rotated.accessToken,
        refreshToken: rotated.refreshToken ?? refreshToken
      }),
      secret
    );
    await persistRotatedTokensAtomic({
      ownerUid,
      expectedCiphertext: connection.tokens.ciphertext,
      expectedTokenVersion: tokenVersion,
      newTokens: {
        ciphertext,
        accessExpiresAt: new Date(
          Date.now() + (rotated.expiresIn ?? 3600) * 1000
        ).toISOString(),
        refreshedAt: new Date().toISOString(),
        tokenVersion: tokenVersion + 1
      }
    });
    accessToken = rotated.accessToken;
    freshConn = (await getConnection(ownerUid))!;
  }

  return { accessToken, connection: freshConn };
}

/**
 * Refresh authoritative Demo margin + expected margin for the final volume,
 * then apply the fail-closed safety gate.
 */
export async function assertDemoAuthoritativeMarginGate(
  args: DemoMarginGateArgs
): Promise<MarginGateResult> {
  if (isCTraderLiveEnabled()) {
    denyCTraderMutation("liveOrder");
  }

  const cfg = loadCTraderConfig();
  const clientId = (process.env.CTRADER_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.CTRADER_CLIENT_SECRET ?? "").trim();
  if (!cfg.configured || !clientId || !clientSecret) {
    return {
      ok: false,
      reason: "MARGIN_UNAVAILABLE",
      notes: ["CONFIGURATION_REQUIRED"],
      marginSnapshot: null,
      expectedMargin: null,
      marginAgeMs: null
    };
  }

  if (!(args.protocolVolume > 0) || !Number.isFinite(args.protocolVolume)) {
    return {
      ok: false,
      reason: "EXPECTED_MARGIN_UNAVAILABLE",
      notes: ["protocolVolume invalid for ProtoOAExpectedMarginReq"],
      marginSnapshot: null,
      expectedMargin: null,
      marginAgeMs: null
    };
  }

  let accessToken: string;
  let connection: NonNullable<Awaited<ReturnType<typeof getConnection>>>;
  try {
    ({ accessToken, connection } = await ensureFreshAccessToken(args.ownerUid));
  } catch (err) {
    return {
      ok: false,
      reason: "MARGIN_UNAVAILABLE",
      notes: [
        err instanceof Error ? err.message : "token refresh failed"
      ],
      marginSnapshot: null,
      expectedMargin: null,
      marginAgeMs: null
    };
  }

  if (connection.selectedAccountIsLive || connection.environment === "LIVE") {
    return {
      ok: false,
      reason: "LIVE_ACCOUNT_FORBIDDEN",
      notes: ["selected Live account — ZERO Demo margin submission"],
      marginSnapshot: null,
      expectedMargin: null,
      marginAgeMs: null
    };
  }
  if (!connection.selectedAccountId) {
    return {
      ok: false,
      reason: "MARGIN_UNAVAILABLE",
      notes: ["CTRADER_ACCOUNT_NOT_SELECTED"],
      marginSnapshot: null,
      expectedMargin: null,
      marginAgeMs: null
    };
  }

  const api = args.openApiClient;
  const creds = {
    accessToken,
    clientId,
    clientSecret,
    ctidTraderAccountId: connection.selectedAccountId
  };

  // Injected test client: keep the same sequence (expected → snapshot LAST).
  if (api) {
    if (
      !api.fetchAuthoritativeDemoMarginSnapshot ||
      !api.fetchDemoExpectedMargin
    ) {
      return {
        ok: false,
        reason: "MARGIN_UNAVAILABLE",
        notes: ["Open API margin methods unavailable"],
        marginSnapshot: null,
        expectedMargin: null,
        marginAgeMs: null
      };
    }
    return runAuthoritativeMarginSequence({
      fetchExpectedMargin: () =>
        api.fetchDemoExpectedMargin!({
          ...creds,
          symbolId: args.symbolId,
          volume: args.protocolVolume,
          side: args.side
        }),
      fetchAuthoritativeSnapshot: () =>
        api.fetchAuthoritativeDemoMarginSnapshot!(creds),
      nowMs: args.nowMs,
      maxAgeMs: args.maxAgeMs,
      selectedAccountIsLive: false
    });
  }

  // Production: expected margin + snapshot on one authenticated Demo session.
  try {
    return await withBoundedOp("MARGIN_SEQUENCE", 20_000, () =>
      withFastDemoSession(creds, (session) =>
        runAuthoritativeMarginSequence({
          fetchExpectedMargin: () =>
            session.expectedMargin({
              symbolId: args.symbolId,
              volume: args.protocolVolume,
              side: args.side
            }),
          fetchAuthoritativeSnapshot: () => session.authoritativeSnapshot(),
          nowMs: args.nowMs,
          maxAgeMs: args.maxAgeMs,
          selectedAccountIsLive: false
        })
      )
    );
  } catch (err) {
    return {
      ok: false,
      reason: "MARGIN_UNAVAILABLE",
      notes: [
        err instanceof Error ? err.message : "margin sequence failed"
      ],
      marginSnapshot: null,
      expectedMargin: null,
      marginAgeMs: null
    };
  }
}
