/**
 * Demo submission may enable for Gold Hunter / manual Demo orders.
 * Live stays hard-locked.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  isCTraderDemoOrderSubmissionEnabled,
  isCTraderLiveEnabled,
  snapshotCTraderFlags
} from "../../../../src/services/broker/ctrader/flags";

describe("Demo / Live execution lock", () => {
  const prev = process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;

  afterEach(() => {
    if (prev === undefined) delete process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    else process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = prev;
  });

  it("keeps Live hard-locked while Demo submission can be enabled", () => {
    process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = "true";
    expect(isCTraderDemoOrderSubmissionEnabled()).toBe(true);
    expect(isCTraderLiveEnabled()).toBe(false);
    const snap = snapshotCTraderFlags();
    expect(snap.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED).toBe(true);
    expect(snap.CTRADER_LIVE_ENABLED).toBe(false);
    expect(snap.BROKER_EXECUTION_ENABLED).toBe(false);
  });
});
