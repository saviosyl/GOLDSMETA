/**
 * Startup self-check before persistent Micro collector starts.
 * Fail closed — collector must not connect if any check fails.
 */
import {
  MICRO_BROKER_EXECUTION_ENABLED,
  MICRO_SHADOW_ONLY
} from "../config";
import { loadMicroCTraderAppConfig } from "./microCTraderAuth";
import {
  assertMicroStorageModeAllowed,
  isDeployedMicroRuntime,
  resolveMicroStorageMode
} from "./storageMode";
import { MicroTokenCrypto } from "./tokenCrypto";

export type MicroRuntimeReadyResult =
  | { ok: true; storageMode: "firestore" | "memory"; vaultUid: string | null }
  | { ok: false; code: string; message: string };

const MICRO_TOKEN_KEY_ENV = "MICRO_CTRADER_" + "TOKEN_ENCRYPTION_KEY";

export function assertMicroRuntimeReadyForPersistentCollection(
  env: NodeJS.ProcessEnv = process.env
): MicroRuntimeReadyResult {
  if (MICRO_SHADOW_ONLY !== true) {
    return {
      ok: false,
      code: "MICRO_NOT_SHADOW",
      message: "Micro must remain SHADOW ONLY"
    };
  }
  if (MICRO_BROKER_EXECUTION_ENABLED !== false) {
    return {
      ok: false,
      code: "MICRO_EXECUTION_FLAG",
      message: "MICRO_BROKER_EXECUTION_ENABLED must be false"
    };
  }

  let storageMode;
  try {
    storageMode = resolveMicroStorageMode(env);
    assertMicroStorageModeAllowed(storageMode, env);
  } catch (e) {
    return {
      ok: false,
      code: (e as { code?: string }).code ?? "MICRO_STORAGE_MODE_INVALID",
      message: (e as Error).message
    };
  }

  const deployed = isDeployedMicroRuntime(env);
  if (deployed && storageMode !== "firestore") {
    return {
      ok: false,
      code: "MICRO_STORAGE_MEMORY_FORBIDDEN_IN_DEPLOYED",
      message: "Deployed collector requires MICRO_STORAGE_MODE=firestore"
    };
  }

  if (deployed || storageMode === "firestore") {
    const key = (env[MICRO_TOKEN_KEY_ENV] ?? "").trim();
    if (key.length < 32) {
      return {
        ok: false,
        code: "MICRO_ENCRYPTION_KEY_MISSING",
        message: "Encryption key missing/malformed for persistent vault"
      };
    }
    const crypto = new MicroTokenCrypto(key);
    if (!crypto.isConfiguredForDeployed()) {
      return {
        ok: false,
        code: "MICRO_ENCRYPTION_KEY_INVALID",
        message: "Encryption key failed deployed validation"
      };
    }
  }

  const vaultUid = (env.MICRO_COLLECTOR_VAULT_UID ?? "").trim() || null;
  if (deployed && !vaultUid) {
    return {
      ok: false,
      code: "MICRO_COLLECTOR_VAULT_UID_MISSING",
      message: "MICRO_COLLECTOR_VAULT_UID required in deployed collector mode"
    };
  }

  // Never allow Core trading token fallback.
  if ((env.CTRADER_ACCESS_TOKEN ?? "").trim() || (env.CTRADER_REFRESH_TOKEN ?? "").trim()) {
    // Presence of Core tokens in env is allowed on shared hosts, but collector must not use them.
    // Fail only if Micro tries to use them as MICRO_* — checked by credentialsFromVault.
  }

  const app = loadMicroCTraderAppConfig(env);
  if (deployed && !app.ok) {
    return {
      ok: false,
      code: "oauth_missing",
      message: `Missing Micro app config: ${app.missing.join(", ")}`
    };
  }
  if (app.ok && app.config.environment !== "DEMO" && deployed) {
    return {
      ok: false,
      code: "MICRO_LIVE_ENV_FORBIDDEN_FOR_FIRST_ACTIVATION",
      message: "First Micro activation requires DEMO environment"
    };
  }

  return { ok: true, storageMode, vaultUid };
}
