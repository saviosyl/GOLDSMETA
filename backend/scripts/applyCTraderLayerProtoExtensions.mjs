#!/usr/bin/env node
/**
 * Extends @reiryoku/ctrader-layer protobufs with ProtoOAGetPositionUnrealizedPnL
 * (payload 2187/2188) and SELF-VERIFIES required margin schema.
 *
 * Idempotent. EXIT NON-ZERO when the installed dependency schema is incompatible
 * or the UnrealizedPnL extension cannot be verified after patching.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const pkgRoot = path.join(root, "node_modules", "@reiryoku", "ctrader-layer");
const pkg = path.join(pkgRoot, "protobuf");
const modelPath = path.join(pkg, "OpenApiModelMessages.proto");
const messagesPath = path.join(pkg, "OpenApiMessages.proto");

function fail(msg) {
  console.error(`[ctrader-proto] FAIL: ${msg}`);
  process.exit(1);
}

function mustInclude(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    fail(`missing required definition: ${label} (${needle})`);
  }
}

if (!fs.existsSync(pkgRoot)) {
  fail("@reiryoku/ctrader-layer is not installed");
}
if (!fs.existsSync(modelPath) || !fs.existsSync(messagesPath)) {
  fail("ctrader-layer protobuf files missing");
}

let pkgVersion = "unknown";
try {
  pkgVersion = JSON.parse(
    fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8")
  ).version;
} catch {
  /* keep unknown */
}

let model = fs.readFileSync(modelPath, "utf8");
let messages = fs.readFileSync(messagesPath, "utf8");

// --- Dependency schema that PR #109 relies on (must already exist) ---
const dependencyChecks = [
  [model, "optional uint64 usedMargin = 13", "ProtoOAPosition.usedMargin"],
  [model, "optional uint32 moneyDigits = 15", "ProtoOAPosition.moneyDigits"],
  [model, "message ProtoOAExpectedMargin", "ProtoOAExpectedMargin message"],
  [model, "required int64 buyMargin = 2", "ProtoOAExpectedMargin.buyMargin"],
  [model, "required int64 sellMargin = 3", "ProtoOAExpectedMargin.sellMargin"],
  [messages, "message ProtoOAExpectedMarginReq", "ProtoOAExpectedMarginReq"],
  [messages, "message ProtoOAExpectedMarginRes", "ProtoOAExpectedMarginRes"],
  [
    model,
    "PROTO_OA_EXPECTED_MARGIN_REQ = 2139",
    "PROTO_OA_EXPECTED_MARGIN_REQ enum"
  ],
  [
    model,
    "PROTO_OA_EXPECTED_MARGIN_RES = 2140",
    "PROTO_OA_EXPECTED_MARGIN_RES enum"
  ]
];
for (const [src, needle, label] of dependencyChecks) {
  mustInclude(src, needle, label);
}

// --- Apply UnrealizedPnL extension (idempotent) ---
let patched = false;

if (!model.includes("PROTO_OA_GET_POSITION_UNREALIZED_PNL_REQ = 2187")) {
  if (!model.includes("PROTO_OA_DEAL_LIST_BY_POSITION_ID_RES = 2180;")) {
    fail(
      "cannot patch payload enum — PROTO_OA_DEAL_LIST_BY_POSITION_ID_RES anchor missing"
    );
  }
  const before = model;
  model = model.replace(
    "    PROTO_OA_DEAL_LIST_BY_POSITION_ID_RES = 2180;\n}",
    `    PROTO_OA_DEAL_LIST_BY_POSITION_ID_RES = 2180;
    PROTO_OA_GET_POSITION_UNREALIZED_PNL_REQ = 2187;
    PROTO_OA_GET_POSITION_UNREALIZED_PNL_RES = 2188;
}`
  );
  if (model === before) {
    fail("payload enum patch did not apply");
  }
  patched = true;
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
  patched = true;
}

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
  patched = true;
}

if (patched) {
  fs.writeFileSync(modelPath, model);
  fs.writeFileSync(messagesPath, messages);
  // Re-read for verification
  model = fs.readFileSync(modelPath, "utf8");
  messages = fs.readFileSync(messagesPath, "utf8");
}

// --- Self-verify UnrealizedPnL extension + dependency still intact ---
const verify = [
  [model, "PROTO_OA_GET_POSITION_UNREALIZED_PNL_REQ = 2187", "2187 REQ enum"],
  [model, "PROTO_OA_GET_POSITION_UNREALIZED_PNL_RES = 2188", "2188 RES enum"],
  [model, "message ProtoOAPositionUnrealizedPnL", "ProtoOAPositionUnrealizedPnL"],
  [
    messages,
    "message ProtoOAGetPositionUnrealizedPnLReq",
    "ProtoOAGetPositionUnrealizedPnLReq"
  ],
  [
    messages,
    "message ProtoOAGetPositionUnrealizedPnLRes",
    "ProtoOAGetPositionUnrealizedPnLRes"
  ],
  [model, "optional uint64 usedMargin = 13", "ProtoOAPosition.usedMargin"],
  [model, "optional uint32 moneyDigits = 15", "ProtoOAPosition.moneyDigits"],
  [model, "required int64 buyMargin = 2", "ProtoOAExpectedMargin.buyMargin"],
  [model, "required int64 sellMargin = 3", "ProtoOAExpectedMargin.sellMargin"],
  [messages, "message ProtoOAExpectedMarginReq", "ProtoOAExpectedMarginReq"],
  [messages, "message ProtoOAExpectedMarginRes", "ProtoOAExpectedMarginRes"]
];
for (const [src, needle, label] of verify) {
  mustInclude(src, needle, label);
}

if (patched) {
  console.log(
    `[ctrader-proto] ProtoOAGetPositionUnrealizedPnL extension applied and verified (ctrader-layer@${pkgVersion})`
  );
} else {
  console.log(
    `[ctrader-proto] ProtoOAGetPositionUnrealizedPnL already present — verified (ctrader-layer@${pkgVersion})`
  );
}
