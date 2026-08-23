import { buildVolumeProfile } from "./profileEngine";
import type { GcProfileSnapshot } from "./shadowTypes";

export interface GcProviderOptions {
  /** Explicit override when an authorised feed is connected later. */
  snapshot?: Partial<GcProfileSnapshot> | null;
  atr?: number | null;
  session?: string;
}

/**
 * COMEX GC profile provider abstraction.
 * Does not fabricate confirmation — returns UNAVAILABLE until a real feed is wired.
 */
export function fetchComexGcProfile(options: GcProviderOptions = {}): GcProfileSnapshot {
  if (options.snapshot && options.snapshot.poc != null && options.snapshot.vah != null && options.snapshot.val != null) {
    const asOf = options.snapshot.timestamp ?? new Date().toISOString();
    const vp = buildVolumeProfile({
      source: "COMEX_GC",
      session: options.snapshot.session ?? options.session ?? "UNKNOWN",
      poc: options.snapshot.poc,
      vah: options.snapshot.vah,
      val: options.snapshot.val,
      barCount: 40,
      volumeObservations: options.snapshot.volume != null ? 40 : 1,
      asOf,
      atr: options.atr ?? null
    });
    return {
      provider: options.snapshot.provider ?? "manual_override",
      contract: options.snapshot.contract ?? null,
      contractExpiry: options.snapshot.contractExpiry ?? null,
      rolloverState: options.snapshot.rolloverState ?? "UNKNOWN",
      timestamp: asOf,
      delayStatus: options.snapshot.delayStatus ?? "DELAYED",
      session: options.snapshot.session ?? options.session ?? null,
      poc: options.snapshot.poc,
      vah: options.snapshot.vah,
      val: options.snapshot.val,
      volume: options.snapshot.volume ?? null,
      profileQuality: vp.valid ? "GOOD" : "PARTIAL",
      asVolumeProfile: vp,
      note: "GC profile supplied by override — verify contract and delay status."
    };
  }

  return {
    provider: "none",
    contract: null,
    contractExpiry: null,
    rolloverState: "UNKNOWN",
    timestamp: null,
    delayStatus: "UNAVAILABLE",
    session: null,
    poc: null,
    vah: null,
    val: null,
    volume: null,
    profileQuality: "UNAVAILABLE",
    asVolumeProfile: null,
    note:
      "GC CONFIRMATION UNAVAILABLE. Do not fabricate COMEX volume. Options: delayed exchange data, authorised futures API, or paid market-data vendor — do not purchase without approval."
  };
}

export const GC_DATA_SOURCE_OPTIONS = [
  {
    tier: "free_delayed",
    name: "Exchange-delayed GC quotes (vendor-dependent)",
    note: "Often 10–15 min delayed; suitable for research confirmation only."
  },
  {
    tier: "broker_chart",
    name: "Broker/TradingView GC continuous chart profile",
    note: "Not identical to COMEX pit/electronic contract volume; label delay/source."
  },
  {
    tier: "paid",
    name: "Paid futures market-data (e.g. CME-authorised feed)",
    note: "Requires explicit approval before subscription or activation."
  }
] as const;
