import { describe, expect, it } from "vitest";
import { buildOnboardingSteps } from "./AutoTradeOnboarding";

describe("buildOnboardingSteps", () => {
  it("advances steps 3–6 to Complete and keeps 7–9 available when Demo account + gold resolve", () => {
    const steps = buildOnboardingSteps({
      emailVerified: true,
      connected: true,
      accountSelected: true,
      mode: "demo",
      goldOk: true,
      settingsSaved: true,
      checksOk: true,
      previewOk: false,
      tradingAuthorised: false,
      autoTradeOn: false
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId[3].status).toBe("Complete");
    expect(byId[4].status).toBe("Complete");
    expect(byId[5].status).toBe("Complete");
    expect(byId[6].status).toBe("Complete");
    expect(byId[7].status).toBe("Complete");
    expect(byId[8].status).toBe("Complete");
    expect(byId[9].status).toBe("Current");
    expect(byId[10].status).toBe("Locked");
    expect(byId[11].status).toBe("Locked");
  });

  it("does not lock steps 7–9 behind each other after gold is resolved", () => {
    const steps = buildOnboardingSteps({
      emailVerified: true,
      connected: true,
      accountSelected: true,
      mode: "demo",
      goldOk: true,
      settingsSaved: false,
      checksOk: false,
      previewOk: false,
      tradingAuthorised: false,
      autoTradeOn: false
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId[7].status).toBe("Current");
    expect(byId[8].status).toBe("Current");
    expect(byId[9].status).toBe("Current");
  });
});
