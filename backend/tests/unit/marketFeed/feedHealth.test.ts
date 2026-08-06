import { beforeEach, describe, expect, it } from "vitest";
import plan15Fixture from "../../fixtures/pine3Plan15mPayload.json";
import confirm5Fixture from "../../fixtures/pine3Confirm5mPayload.json";
import quote1Fixture from "../../fixtures/pine3Quote1mPayload.json";
import legacyStrategyFixture from "../../fixtures/intradayStrategyPayload.json";
import { freshPayload } from "../../helpers";
import {
  evaluateSharedFeedHealth,
  publicMarketFeedHealth
} from "../../../src/services/marketFeed/feedHealth";
import {
  __resetSharedFeedMemoryForTests,
  recordSharedFeedAccepted
} from "../../../src/services/marketFeed/sharedFeed";
import { InMemoryStore } from "../../../src/services/storage/inMemoryStore";
import type { TradingViewPayload } from "../../../src/models/types";

const feedUserId = "shared-market-feed";

const withMetadata = (
  fixture: Record<string, unknown>,
  metadata: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
): TradingViewPayload =>
  freshPayload(fixture, {
    ...overrides,
    metadata: {
      ...(fixture.metadata as Record<string, unknown>),
      ...metadata
    }
  });

const record = async (
  store: InMemoryStore,
  payload: TradingViewPayload,
  at = new Date().toISOString()
): Promise<void> => {
  await recordSharedFeedAccepted({
    store,
    userId: feedUserId,
    webhookId: "shared-webhook-id",
    payload,
    eventId: payload.eventId,
    at
  });
};

describe("shared market feed health", () => {
  let store: InMemoryStore;

  beforeEach(async () => {
    process.env.GOLDMETA_SHARED_FEED_UID = feedUserId;
    __resetSharedFeedMemoryForTests();
    store = new InMemoryStore();
    await store.createWebhookConnection({
      userId: feedUserId,
      webhookId: "shared-webhook-id",
      secret: null
    });
  });

  it("is green when PLAN_15M and matching CONFIRM_5M are recent; QUOTE_1M is optional", async () => {
    const now = Date.now();
    await record(store, freshPayload(plan15Fixture), new Date(now - 60_000).toISOString());
    await record(store, freshPayload(confirm5Fixture), new Date(now - 30_000).toISOString());

    const health = await evaluateSharedFeedHealth(store, { now });
    expect(health.status).toBe("green");
    expect(health.plan15m.healthy).toBe(true);
    expect(health.confirm5m.healthy).toBe(true);
    expect(health.quote1m.healthy).toBe(false);
    expect(publicMarketFeedHealth(health).quoteStatus).toBe("limited");
    expect(publicMarketFeedHealth(health).title).toBe("GoldMeta Market Feed");
    expect(publicMarketFeedHealth(health).subtitle).toBe("All systems operational");
    expect(health.sharedWebhookActive).toBe(true);
  });

  it("reports live quote status when QUOTE_1M traffic is healthy", async () => {
    const now = Date.now();
    await record(store, freshPayload(plan15Fixture), new Date(now - 60_000).toISOString());
    await record(store, freshPayload(confirm5Fixture), new Date(now - 30_000).toISOString());
    await record(store, freshPayload(quote1Fixture), new Date(now - 10_000).toISOString());

    const health = await evaluateSharedFeedHealth(store, { now });
    expect(health.status).toBe("green");
    expect(health.quote1m.healthy).toBe(true);
    expect(health.quoteStatus).toBe("live");
  });

  it("is amber when PLAN_15M is healthy but CONFIRM_5M is missing, stale, or mismatched", async () => {
    const now = Date.now();
    await record(store, freshPayload(plan15Fixture), new Date(now - 60_000).toISOString());

    let health = await evaluateSharedFeedHealth(store, { now });
    expect(health.status).toBe("amber");
    expect(health.confirm5m.reasons).toContain("MISSING");

    await record(store, freshPayload(confirm5Fixture), new Date(now - 30 * 60_000).toISOString());
    health = await evaluateSharedFeedHealth(store, { now });
    expect(health.status).toBe("amber");
    expect(health.confirm5m.reasons).toContain("STALE");

    __resetSharedFeedMemoryForTests();
    store = new InMemoryStore();
    await record(store, freshPayload(plan15Fixture), new Date(now - 60_000).toISOString());
    await record(
      store,
      withMetadata(confirm5Fixture, { planSourceKey: "different-plan-source" }),
      new Date(now - 30_000).toISOString()
    );
    health = await evaluateSharedFeedHealth(store, { now });
    expect(health.status).toBe("amber");
    expect(health.confirmationSourceKeyMatch).toBe(false);
    expect(health.confirm5m.reasons).toContain("PLAN_SOURCE_KEY_MISMATCH");
  });

  it("is red when PLAN_15M is missing, stale, legacy, or role-mismatched", async () => {
    const now = Date.now();
    let health = await evaluateSharedFeedHealth(store, { now });
    expect(health.status).toBe("red");
    expect(health.plan15m.reasons).toContain("MISSING");

    await record(store, freshPayload(plan15Fixture), new Date(now - 30 * 60_000).toISOString());
    health = await evaluateSharedFeedHealth(store, { now });
    expect(health.status).toBe("red");
    expect(health.plan15m.reasons).toContain("STALE");

    __resetSharedFeedMemoryForTests();
    store = new InMemoryStore();
    await record(store, freshPayload(legacyStrategyFixture));
    health = await evaluateSharedFeedHealth(store, { now });
    expect(health.status).toBe("red");
    expect(health.noRecentLegacyTraffic).toBe(false);

    __resetSharedFeedMemoryForTests();
    store = new InMemoryStore();
    await record(
      store,
      withMetadata(plan15Fixture, { chartMatchesRole: false }),
      new Date(now - 60_000).toISOString()
    );
    health = await evaluateSharedFeedHealth(store, { now });
    expect(health.status).toBe("red");
    expect(health.plan15m.reasons).toContain("CHART_ROLE_MISMATCH");
  });

  it("does not become green from an active webhook or setup checkbox without accepted traffic", async () => {
    const health = await evaluateSharedFeedHealth(store, { now: Date.now() });
    expect(health.sharedWebhookActive).toBe(true);
    expect(health.status).toBe("red");
    expect(health.plan15m.received).toBe(false);
  });
});
