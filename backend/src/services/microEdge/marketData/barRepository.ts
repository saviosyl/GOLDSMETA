import type { MicroBar } from "../types";
import type { MicroCTraderReadOnlyClient } from "./microCTraderClient";

export async function loadCompletedBars(
  client: MicroCTraderReadOnlyClient,
  tf: "M1" | "M5" | "M15",
  limit = 500
): Promise<MicroBar[]> {
  const bars = await client.getTrendbars(tf, limit);
  // Ensure chronological and completed (closeTime present).
  return bars.filter((b) => Number.isFinite(b.closeTimeMs)).sort((a, b) => a.closeTimeMs - b.closeTimeMs);
}
