/**
 * Verify research capture SCOPE_VIEW from actual broker authorization payload.
 * Does not trust a caller-supplied string alone for deployment/campaign attach.
 */
import {
  assertViewOnlyPermissionScope,
  parsePermissionScope,
  type MicroPermissionScope
} from "../../../marketData/accountSelection";

export type ResearchScopeVerification = {
  ok: true;
  permissionScope: "SCOPE_VIEW";
  rawPermissionScope: MicroPermissionScope;
  source: "broker_authorization_response";
};

/**
 * Fail closed unless the broker authorization/account permission response
 * resolves to SCOPE_VIEW via parsePermissionScope / assertViewOnlyPermissionScope.
 */
export function verifyResearchScopeFromBrokerAuth(
  authorizationResponse: unknown
): ResearchScopeVerification {
  const raw = parsePermissionScope(authorizationResponse);
  if (raw === "SCOPE_TRADE") {
    throw Object.assign(new Error("RESEARCH_CAPTURE_REFUSING_SCOPE_TRADE"), {
      code: "RESEARCH_CAPTURE_REFUSING_SCOPE_TRADE",
      permissionScope: raw
    });
  }
  if (raw === "UNKNOWN") {
    throw Object.assign(new Error("RESEARCH_CAPTURE_REFUSING_UNKNOWN_SCOPE"), {
      code: "RESEARCH_CAPTURE_REFUSING_UNKNOWN_SCOPE",
      permissionScope: raw
    });
  }
  const asserted = assertViewOnlyPermissionScope(authorizationResponse);
  return {
    ok: true,
    permissionScope: asserted.permissionScope,
    rawPermissionScope: raw,
    source: "broker_authorization_response"
  };
}
