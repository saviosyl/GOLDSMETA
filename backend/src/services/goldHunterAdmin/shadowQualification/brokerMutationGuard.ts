/**
 * Broker mutation surface for shadow qualification.
 * Static proof ≠ live broker counters (verified post-deploy).
 */
let mutationAttempts = 0;
let lastMutationDetail: string | null = null;

export function resetGhShadowBrokerMutationProofForTests(): void {
  mutationAttempts = 0;
  lastMutationDetail = null;
}

export type GhShadowMutationSurfaceReport = {
  /** Static analysis of shadow source — not a live broker counter. */
  staticMutationSurface: "NO_BROKER_CALL_SITES" | "BROKER_CALL_SITES_DETECTED";
  /** Runtime verification placeholders — authoritative after research deploy. */
  runtimeVerification: {
    newOrderReqCount: number | null;
    brokerOrdersCreated: number | null;
    brokerPositionsCreated: number | null;
    note: string;
  };
  /** Local refuse() attempts (should stay 0 in healthy runs). */
  localRefuseAttempts: number;
  lastRefuseDetail: string | null;
};

export function getGhShadowMutationSurfaceReport(): GhShadowMutationSurfaceReport {
  return {
    staticMutationSurface: "NO_BROKER_CALL_SITES",
    runtimeVerification: {
      newOrderReqCount: null,
      brokerOrdersCreated: null,
      brokerPositionsCreated: null,
      note:
        "Runtime broker counters are verified after research deployment against live telemetry — not hard-coded zeros."
    },
    localRefuseAttempts: mutationAttempts,
    lastRefuseDetail: lastMutationDetail
  };
}

/** @deprecated Use getGhShadowMutationSurfaceReport — zeros are not broker-authoritative. */
export function getGhShadowBrokerMutationProof(): {
  staticMutationSurface: "NO_BROKER_CALL_SITES";
  ProtoOANewOrderReq_static: "NONE";
  note: string;
  mutationAttempts: number;
  lastMutationDetail: string | null;
} {
  return {
    staticMutationSurface: "NO_BROKER_CALL_SITES",
    ProtoOANewOrderReq_static: "NONE",
    note: "Static surface only — not live broker proof",
    mutationAttempts,
    lastMutationDetail
  };
}

export function refuseGhShadowBrokerMutation(detail: string): never {
  mutationAttempts += 1;
  lastMutationDetail = detail;
  throw Object.assign(new Error("GH_SHADOW_BROKER_MUTATION_REFUSED"), {
    code: "GH_SHADOW_BROKER_MUTATION_REFUSED",
    detail
  });
}

export function assertGhShadowNoBrokerMutationSurface(sourceText: string): void {
  const callSites = [
    /\bnew\s+ProtoOANewOrderReq\b/,
    /\bProtoOANewOrderReq\s*\.\s*\w+/,
    /\bsubmitDemoMarketOrder\s*\(/,
    /\bsubmitGoldHunterDemoOrder\s*\(/,
    /\bsendNewOrder\s*\(/
  ];
  if (callSites.some((re) => re.test(sourceText))) {
    throw new Error("GH_SHADOW_SOURCE_CONTAINS_BROKER_MUTATION");
  }
}
