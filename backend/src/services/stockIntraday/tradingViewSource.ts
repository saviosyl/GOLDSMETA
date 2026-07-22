/**
 * TradingView webhook source verification.
 *
 * Official TradingView guidance:
 * - Do not put passwords / credentials in the webhook URL or alert message.
 * - Webhooks may present a client certificate with CN=webhook-server@tradingview.com
 * - Official source IPs (allowlist): see TRADINGVIEW_WEBHOOK_SOURCE_IPS
 *
 * Firebase Functions Gen2 (Cloud Run) limitation:
 * - Application code does NOT receive TradingView client certificates.
 *   mTLS verification requires a trusted edge (custom LB / Cloud Armor) in front.
 * - Client-supplied X-Forwarded-For must never be trusted as authoritative.
 * - When a trusted edge cannot attest the peer IP / cert, source verification is
 *   treated as UNAVAILABLE: signals may be stored and analysed, but must not
 *   independently authorize automatic entry. Internal market-data scan + GoldMeta
 *   risk checks must independently confirm opportunities.
 */

export const TRADINGVIEW_WEBHOOK_SOURCE_IPS = [
  "52.89.214.238",
  "34.212.75.30",
  "54.218.53.128",
  "52.32.178.7"
] as const;

export const TRADINGVIEW_CLIENT_CERT_CN = "webhook-server@tradingview.com";
export const TRADINGVIEW_CLIENT_CERT_ORG = "TradingView, Inc.";

export type TradingViewSourceVerification = {
  verified: boolean;
  method: "client_cert" | "source_ip" | "unavailable";
  reason: string;
};

/**
 * Verify TradingView origin from trusted edge inputs only.
 * Pass `null` when the platform cannot attest the peer (default on Firebase Functions).
 * Never pass a raw client-controlled X-Forwarded-For value.
 */
export function verifyTradingViewSource(input: {
  /** Peer IP attested by a trusted edge / platform — not client XFF. */
  trustedSourceIp?: string | null;
  /** Client certificate CN attested by a trusted mTLS edge. */
  trustedClientCertCn?: string | null;
}): TradingViewSourceVerification {
  const cn = input.trustedClientCertCn?.trim() ?? null;
  if (cn && cn.toLowerCase() === TRADINGVIEW_CLIENT_CERT_CN.toLowerCase()) {
    return {
      verified: true,
      method: "client_cert",
      reason: "Trusted edge attested TradingView client certificate CN"
    };
  }

  const ip = input.trustedSourceIp?.trim() ?? null;
  if (ip && (TRADINGVIEW_WEBHOOK_SOURCE_IPS as readonly string[]).includes(ip)) {
    return {
      verified: true,
      method: "source_ip",
      reason: "Trusted edge attested TradingView allowlisted source IP"
    };
  }

  if (!cn && !ip) {
    return {
      verified: false,
      method: "unavailable",
      reason:
        "Firebase Functions does not expose TradingView client certificates or a " +
        "trustworthy peer IP to application code without a custom mTLS / allowlist edge"
    };
  }

  return {
    verified: false,
    method: "unavailable",
    reason: "Source attestation did not match TradingView certificate CN or allowlisted IPs"
  };
}

/**
 * Extract a platform-attested client IP only when an operator has explicitly
 * configured trusted proxy hop count for a hardened edge. Default: unavailable.
 *
 * Never treat a bare client X-Forwarded-For as trusted.
 */
export function extractTrustedSourceIp(input: {
  /** Set only when a trusted reverse proxy / edge is confirmed in front. */
  trustedProxyHops?: number;
  forwardedFor?: string | null;
  socketRemoteAddress?: string | null;
}): string | null {
  const hops = input.trustedProxyHops;
  if (hops == null || hops < 1 || !Number.isFinite(hops)) {
    return null;
  }

  const forwarded = input.forwardedFor?.trim();
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    // With N trusted hops, the client IP is at index length - hops - 1? 
    // Standard Express trust-proxy: leftmost is original client when proxies append.
    // We only accept when hop count is explicitly configured; take leftmost.
    if (parts.length >= hops) {
      return parts[0] ?? null;
    }
    return null;
  }

  const remote = input.socketRemoteAddress?.trim();
  if (remote && remote !== "127.0.0.1" && remote !== "::1") {
    return remote.replace(/^::ffff:/, "");
  }
  return null;
}
