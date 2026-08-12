#!/usr/bin/env node
/**
 * Extends @reiryoku/ctrader-layer protobufs with ProtoOAGetPositionUnrealizedPnL
 * (payload 2187/2188) — required for authoritative equity when positions are open.
 * Idempotent. Safe to run on every npm install.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const pkg = path.join(
  root,
  "node_modules",
  "@reiryoku",
  "ctrader-layer",
  "protobuf"
);

const modelPath = path.join(pkg, "OpenApiModelMessages.proto");
const messagesPath = path.join(pkg, "OpenApiMessages.proto");

if (!fs.existsSync(modelPath) || !fs.existsSync(messagesPath)) {
  console.warn(
    "[ctrader-proto] @reiryoku/ctrader-layer protobufs not installed — skip"
  );
  process.exit(0);
}

let model = fs.readFileSync(modelPath, "utf8");
if (!model.includes("PROTO_OA_GET_POSITION_UNREALIZED_PNL_REQ")) {
  model = model.replace(
    "    PROTO_OA_DEAL_LIST_BY_POSITION_ID_RES = 2180;\n}",
    `    PROTO_OA_DEAL_LIST_BY_POSITION_ID_RES = 2180;
    PROTO_OA_GET_POSITION_UNREALIZED_PNL_REQ = 2187;
    PROTO_OA_GET_POSITION_UNREALIZED_PNL_RES = 2188;
}`
  );
}

if (!model.includes("message ProtoOAPositionUnrealizedPnL")) {
  model += `

/** Unrealized P/L for a single open position (deposit currency units × 10^moneyDigits). */
message ProtoOAPositionUnrealizedPnL {
    required int64 positionId = 1;
    required int64 grossUnrealizedPnL = 2;
    required int64 netUnrealizedPnL = 3;
}
`;
}

fs.writeFileSync(modelPath, model);

let messages = fs.readFileSync(messagesPath, "utf8");
if (!messages.includes("message ProtoOAGetPositionUnrealizedPnLReq")) {
  messages += `

/** Request for unrealized P/L of all open positions on the account. */
message ProtoOAGetPositionUnrealizedPnLReq {
    optional ProtoOAPayloadType payloadType = 1 [default = PROTO_OA_GET_POSITION_UNREALIZED_PNL_REQ];
    required int64 ctidTraderAccountId = 2;
}

/** Response with per-position gross/net unrealized P/L. */
message ProtoOAGetPositionUnrealizedPnLRes {
    optional ProtoOAPayloadType payloadType = 1 [default = PROTO_OA_GET_POSITION_UNREALIZED_PNL_RES];
    required int64 ctidTraderAccountId = 2;
    repeated ProtoOAPositionUnrealizedPnL positionUnrealizedPnL = 3;
    required uint32 moneyDigits = 4;
}
`;
  fs.writeFileSync(messagesPath, messages);
}

console.log("[ctrader-proto] ProtoOAGetPositionUnrealizedPnL extension applied");
