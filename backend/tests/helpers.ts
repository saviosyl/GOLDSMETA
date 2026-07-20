import { randomUUID } from "crypto";
import { tradingViewPayloadSchema, type TradingViewPayload } from "../src/models/types";

export const freshPayload = (
  fixture: unknown,
  overrides: Record<string, unknown> = {}
): TradingViewPayload => {
  const cloned = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;
  const timestamp = new Date().toISOString();
  return tradingViewPayloadSchema.parse({
    ...cloned,
    eventId: `${String(cloned.eventId ?? "fixture")}-${randomUUID()}`,
    barTime: timestamp,
    sentAt: timestamp,
    ...overrides
  });
};

export const stalePayload = (fixture: unknown): TradingViewPayload =>
  tradingViewPayloadSchema.parse(JSON.parse(JSON.stringify(fixture)) as unknown);
