/**
 * Peek authorized accounts after OAuth token exchange.
 * App auth + GetAccountList only — no AccountAuth, no orders.
 */
import { CTraderConnection } from "@reiryoku/ctrader-layer";
import type { MicroCTraderEnvironment } from "./microCTraderAuth";
import {
  parseAuthorizedAccounts,
  type MicroAuthorizedAccount
} from "./accountSelection";
import { assertReadOnlyCommand } from "./microCTraderProtocol";

const DEMO_HOST = "demo.ctraderapi.com";
const LIVE_HOST = "live.ctraderapi.com";
const PORT = 5035;

export async function fetchMicroAuthorizedAccounts(args: {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  environment: MicroCTraderEnvironment;
  factory?: (host: string, port: number) => {
    open: () => Promise<unknown>;
    close: () => Promise<unknown> | void;
    sendCommand: (cmd: string, payload: Record<string, unknown>) => Promise<unknown>;
  };
}): Promise<MicroAuthorizedAccount[]> {
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
    return parseAuthorizedAccounts(res);
  } finally {
    try {
      await conn.close();
    } catch {
      /* ignore */
    }
  }
}
