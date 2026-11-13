import { expect, test } from "@playwright/test";
import english from "../../../i18n/en-US.json";
import {
  installPerformanceApiFixture,
  WORK_ITEM_KEY,
} from "./helpers/g11-performance-fixture";

test("detail state closes and shows immediately, locks both controls, then rolls back with the translated refusal", async ({
  page,
}, testInfo) => {
  await installPerformanceApiFixture(page, { workflowCapabilities: true });
  let release = () => {};
  let received = false;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `**/api/work-items/${WORK_ITEM_KEY}/transition`,
    async (route) => {
      received = true;
      await held;
      await route.fulfill({ status: 403, json: { message: "Forbidden" } });
    },
  );
  await page.goto(`/agent/work-items/${WORK_ITEM_KEY}`);
  const state = page.getByTestId("work-item-state-control");
  const assignee = page.getByTestId("work-item-assignee-control");
  await expect(state).toContainText("Backlog");
  await state.click();
  // This is the actual library menu, so a wrong selector cannot pass vacuously.
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem", { name: "In progress" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect.poll(() => received).toBe(true);
  await expect(state).toContainText("In progress");
  await expect(state).toBeDisabled();
  await expect(assignee).toBeDisabled();
  await expect(state).toHaveAttribute("aria-busy", "true");
  await expect(state.locator('[aria-label="Loading"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("pending.png") });
  release();
  await expect(state).toContainText("Backlog");
  await expect(state).toBeEnabled();
  await expect(assignee).toBeEnabled();
  const message = english.workItems.journey.transitionForbidden.replace(
    "{{term_work_item_one}}",
    english.term.agent.work_item_one,
  );
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("refused.png") });
});
