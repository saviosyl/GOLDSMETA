/**
 * Peek authorized accounts after OAuth token exchange.
 * App auth + GetAccountList only — no AccountAuth, no orders.
 * Validates permissionScope === SCOPE_VIEW (fail closed on SCOPE_TRADE).
 */
import { CTraderConnection } from "@reiryoku/ctrader-layer";
import type { MicroCTraderEnvironment } from "./microCTraderAuth";
import {
  assertViewOnlyPermissionScope,
  parseAuthorizedAccounts,
  parsePermissionScope,
  type MicroAuthorizedAccount,
  type MicroPermissionScope
} from "./accountSelection";
import { assertReadOnlyCommand } from "./microCTraderProtocol";

const DEMO_HOST = "demo.ctraderapi.com";
const LIVE_HOST = "live.ctraderapi.com";
const PORT = 5035;

export type MicroAccountListResult = {
  permissionScope: MicroPermissionScope;
  accounts: MicroAuthorizedAccount[];
  raw: unknown;
};

export async function fetchMicroAuthorizedAccounts(args: {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  environment: MicroCTraderEnvironment;
  /** When true (default), reject SCOPE_TRADE. */
  requireViewScope?: boolean;
  factory?: (host: string, port: number) => {
    open: () => Promise<unknown>;
    close: () => Promise<unknown> | void;
    sendCommand: (cmd: string, payload: Record<string, unknown>) => Promise<unknown>;
  };
}): Promise<MicroAuthorizedAccount[]> {
  const full = await fetchMicroAccountList(args);
  return full.accounts;
}

export async function fetchMicroAccountList(args: {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  environment: MicroCTraderEnvironment;
  requireViewScope?: boolean;
  factory?: (host: string, port: number) => {
    open: () => Promise<unknown>;
    close: () => Promise<unknown> | void;
    sendCommand: (cmd: string, payload: Record<string, unknown>) => Promise<unknown>;
  };
}): Promise<MicroAccountListResult> {
  const host = args.environment === "LIVE" ? LIVE_HOST : DEMO_HOST;
  const factory =
    args.factory ??
    ((h: string, p: number) =>
      new CTraderConnection({ host: h, port: p }) as unknown as {
        open: () => Promise<unknown>;
        close: () => Promise<unknown> | void;
        sendCommand: (
          cmd: string,
          payload: Record<string, unknown>
        ) => Promise<unknown>;
      });
  const conn = factory(host, PORT);
  try {
    await conn.open();
    assertReadOnlyCommand("ProtoOAApplicationAuthReq");
    await conn.sendCommand("ProtoOAApplicationAuthReq", {
      clientId: args.clientId,
      clientSecret: args.clientSecret
    });
    assertReadOnlyCommand("ProtoOAGetAccountListByAccessTokenReq");
    const res = await conn.sendCommand(
      "ProtoOAGetAccountListByAccessTokenReq",
      { accessToken: args.accessToken }
    );
    const permissionScope: MicroPermissionScope =
      args.requireViewScope !== false
        ? assertViewOnlyPermissionScope(res).permissionScope
        : parsePermissionScope(res);
    return {
      permissionScope,
      accounts: parseAuthorizedAccounts(res),
      raw: res
    };
  } finally {
    try {
      await conn.close();
    } catch {
      /* ignore */
    }
  }
}
