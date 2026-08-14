/**
 * Fail-closed safety for research capture.
 * Structurally refuses execution adapters and non-VIEW scopes.
 */
import type { MicroPermissionScope } from "../../../marketData/accountSelection";
import { GH_FAST_MUTATION_SURFACE } from "../versions";

export type ResearchSafetyIdentity = {
  mode: "RESEARCH_CAPTURE_ONLY";
  permissionScope: "SCOPE_VIEW";
  mutationSurface: "NONE";
  brokerRequests: 0;
  brokerOrders: 0;
  shadowOrders: 0;
  openShadowTrade: false;
  executionAdapter: "NONE";
};

const FORBIDDEN_ADAPTER_NAMES = [
  "ShadowExecutionAdapter",
  "ForbiddenLiveExecutionAdapter",
  "GhFastExecutionAdapter"
] as const;

/**
 * Research capture has no execution path. Any attempt to inject an adapter fails.
 * Named to make misuse obvious in reviews / static scans.
 */
export function refuseExecutionAdapter(adapter: unknown): never {
  const name =
    adapter && typeof adapter === "object" && "name" in adapter
      ? String((adapter as { name?: unknown }).name)
      : typeof adapter;
  throw new Error(
    `RESEARCH_CAPTURE_REFUSING_EXECUTION_ADAPTER:${name || "unknown"}`
  );
}

/** Boot-time identity — always zeros / NONE / SCOPE_VIEW. */
export function researchSafetyIdentity(): ResearchSafetyIdentity {
  if (GH_FAST_MUTATION_SURFACE !== "NONE") {
    throw new Error("RESEARCH_CAPTURE_REFUSING_NON_NONE_MUTATION_SURFACE");
  }
  return {
    mode: "RESEARCH_CAPTURE_ONLY",
    permissionScope: "SCOPE_VIEW",
    mutationSurface: "NONE",
    brokerRequests: 0,
    brokerOrders: 0,
    shadowOrders: 0,
    openShadowTrade: false,
    executionAdapter: "NONE"
  };
}

/** Fail closed unless permission is exactly SCOPE_VIEW. */
export function assertResearchViewOnlyScope(
  scope: MicroPermissionScope | null | undefined
): asserts scope is "SCOPE_VIEW" {
  if (scope === "SCOPE_TRADE") {
    throw Object.assign(
      new Error("RESEARCH_CAPTURE_REFUSING_SCOPE_TRADE"),
      { code: "RESEARCH_CAPTURE_REFUSING_SCOPE_TRADE" }
    );
  }
  if (scope !== "SCOPE_VIEW") {
    throw Object.assign(
      new Error("RESEARCH_CAPTURE_REFUSING_UNKNOWN_SCOPE"),
      { code: "RESEARCH_CAPTURE_REFUSING_UNKNOWN_SCOPE" }
    );
  }
}

/** Detect forbidden adapter constructors by name (defense in depth). */
export function isForbiddenExecutionAdapterName(name: string): boolean {
  return (FORBIDDEN_ADAPTER_NAMES as readonly string[]).includes(name);
}

/**
 * Guard used by runtime constructors — rejects any non-undefined adapter arg.
 * Research APIs must not expose an adapter parameter; this catches misuse.
 */
export function assertNoExecutionAdapterArgument(arg: unknown): void {
  if (arg !== undefined && arg !== null) {
    refuseExecutionAdapter(arg);
  }
}
