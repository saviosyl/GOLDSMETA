/**
 * Explicit Micro persistence mode.
 * Deployed Cloud runtime MUST use firestore — memory is fail-closed.
 */
export type MicroStorageMode = "memory" | "firestore";

export function isDeployedMicroRuntime(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if ((env.MICRO_DEPLOYED_RUNTIME ?? "").trim().toLowerCase() === "true") {
    return true;
  }
  if ((env.APP_ENV ?? "").trim().toLowerCase() === "production") {
    return true;
  }
  // Cloud Run / Cloud Functions indicators
  if ((env.K_SERVICE ?? "").trim()) return true;
  if ((env.FUNCTION_TARGET ?? "").trim()) return true;
  if ((env.K_REVISION ?? "").trim()) return true;
  return false;
}

export function resolveMicroStorageMode(
  env: NodeJS.ProcessEnv = process.env
): MicroStorageMode {
  const explicit = (env.MICRO_STORAGE_MODE ?? "").trim().toLowerCase();
  if (explicit === "memory" || explicit === "firestore") {
    if (explicit === "memory" && isDeployedMicroRuntime(env)) {
      throw Object.assign(
        new Error("MICRO_STORAGE_MEMORY_FORBIDDEN_IN_DEPLOYED"),
        { code: "MICRO_STORAGE_MEMORY_FORBIDDEN_IN_DEPLOYED" }
      );
    }
    return explicit;
  }

  if (isDeployedMicroRuntime(env)) return "firestore";

  const storageBackend = (env.STORAGE_BACKEND ?? "").trim().toLowerCase();
  if (storageBackend === "firestore") return "firestore";
  if (storageBackend === "memory") return "memory";

  const appEnv = (env.APP_ENV ?? env.NODE_ENV ?? "").trim().toLowerCase();
  if (appEnv === "test" || appEnv === "development") return "memory";

  // Prefer firestore when Firebase is configured (non-test).
  if ((env.FIREBASE_CONFIG ?? "").trim() || (env.FIREBASE_PROJECT_ID ?? "").trim()) {
    return "firestore";
  }
  return "memory";
}

export function assertMicroStorageModeAllowed(
  mode: MicroStorageMode,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (mode === "memory" && isDeployedMicroRuntime(env)) {
    throw Object.assign(
      new Error("MICRO_STORAGE_MEMORY_FORBIDDEN_IN_DEPLOYED"),
      { code: "MICRO_STORAGE_MEMORY_FORBIDDEN_IN_DEPLOYED" }
    );
  }
}
