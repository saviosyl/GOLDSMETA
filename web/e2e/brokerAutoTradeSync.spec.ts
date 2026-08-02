import { expect, test } from "@playwright/test";

test.describe("Broker → AutoTrade state sync", () => {
  for (const project of ["desktop", "mobile"] as const) {
    test(`${project}: selected Demo account and market state match across pages`, async ({
      page
    }, testInfo) => {
      const isMobile = testInfo.project.name.includes("mobile");
      if (project === "desktop" && isMobile) test.skip();
      if (project === "mobile" && !isMobile) test.skip();

      await page.goto("/ui-review/brokers");
      await expect(page.getByTestId("broker-control-centre")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("broker-connection-status")).toHaveText(/Connected/i);
      await expect(page.getByTestId("broker-account-type")).toHaveText(/Demo account selected/i);
      await expect(page.getByTestId("autotrade-off-badge")).toHaveText("OFF");

      // Refresh paths should not break sync
      if (await page.getByTestId("ctrader-refresh-accounts-btn").isVisible()) {
        await page.getByTestId("ctrader-refresh-accounts-btn").click();
        await expect(page.getByTestId("broker-action-banner")).toBeVisible();
      }
      if (await page.getByTestId("ctrader-diagnostics-btn").isVisible()) {
        await page.getByTestId("ctrader-diagnostics-btn").click();
      }

      await page.goto("/ui-review/autotrade");
      await expect(page.getByTestId("autotrade-page")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("autotrade-broker-badge")).toHaveText(
        /Pepperstone.*Demo.*\*\*\*\*4821|Pepperstone Demo/i
      );
      await expect(page.getByTestId("autotrade-connection-label")).toHaveText(/Connected/i);
      await expect(page.getByTestId("autotrade-mode-pill")).toHaveText("OFF");
      await expect(page.getByTestId("autotrade-broker-badge")).not.toHaveText(
        /No Demo account selected/i
      );
      await expect(page.getByTestId("autotrade-market-label")).not.toHaveText(/status unknown/i);
      await expect(page.getByTestId("autotrade-market-label")).toHaveText(/XAUUSD · Market closed/i);
      await expect(page.getByTestId("autotrade-step-3-status")).toHaveText(/Complete/i);
      await expect(page.getByTestId("autotrade-step-4-status")).toHaveText(/Complete/i);
      await expect(page.getByTestId("autotrade-step-5-status")).toHaveText(/Complete/i);
      await expect(page.getByTestId("autotrade-step-6-status")).toHaveText(/Complete/i);
      await expect(page.getByTestId("autotrade-step-10-status")).toHaveText(/Locked/i);
      await expect(page.getByTestId("autotrade-step-11-status")).toHaveText(/Locked/i);

      const activity = page.getByTestId("autotrade-activity");
      await expect(activity).toBeVisible();
      const text = await activity.innerText();
      expect(text).toMatch(/Demo account \*\*\*\*4821 connected\. AutoTrade OFF/i);
      expect(text.indexOf("connected. AutoTrade OFF")).toBeLessThan(
        text.indexOf("reconnect required")
      );

      await page.emulateMedia({ media: "print" });
      await expect(page.getByTestId("autotrade-status")).toBeVisible();
      await expect(page.getByTestId("autotrade-broker-badge")).not.toHaveText(
        /No Demo account selected/i
      );
      await expect(page.getByTestId("autotrade-market-label")).not.toHaveText(/status unknown/i);
    });
  }
});
