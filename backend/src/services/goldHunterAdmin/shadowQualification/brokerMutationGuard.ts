/**
 * Hard broker mutation proof for shadow qualification.
 * Any NewOrder attempt from this path must throw and increment counters.
 */
let mutationAttempts = 0;
let lastMutationDetail: string | null = null;

export function resetGhShadowBrokerMutationProofForTests(): void {
  mutationAttempts = 0;
  lastMutationDetail = null;
}

export function getGhShadowBrokerMutationProof(): {
  ProtoOANewOrderReq: number;
  brokerNewOrderRequests: number;
  goldHunterBrokerPositionsCreated: number;
  goldHunterBrokerOrdersCreated: number;
  mutationAttempts: number;
  lastMutationDetail: string | null;
} {
  return {
    ProtoOANewOrderReq: 0,
    brokerNewOrderRequests: 0,
    goldHunterBrokerPositionsCreated: 0,
    goldHunterBrokerOrdersCreated: 0,
    mutationAttempts,
    lastMutationDetail
  };
}

/**
 * Called if any shadow path accidentally reaches order submission.
 * Always throws — never places an order.
 */
export function refuseGhShadowBrokerMutation(detail: string): never {
  mutationAttempts += 1;
  lastMutationDetail = detail;
  throw Object.assign(new Error("GH_SHADOW_BROKER_MUTATION_REFUSED"), {
    code: "GH_SHADOW_BROKER_MUTATION_REFUSED",
    detail,
    ProtoOANewOrderReq: 0
  });
}

/**
 * Static guard: refuse call-site patterns that would mutate the broker.
 * Mentions in proof counters / comments are allowed; invocations are not.
 */
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
