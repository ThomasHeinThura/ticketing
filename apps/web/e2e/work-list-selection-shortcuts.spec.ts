import { expect, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  WORK_LIST_PATH,
} from "./helpers/g11-performance-fixture";

test("work-list keyboard selection survives the controlled shortcut split", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  await page.goto(WORK_LIST_PATH);
  await expect(page.getByTestId("work-item-list-populated")).toBeVisible();
  const selectionToggle = page.getByRole("button", { name: "Select items" });
  await selectionToggle.click();
  await expect(selectionToggle).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("ControlOrMeta+a");
  const toolbar = page.getByRole("toolbar", { name: "Bulk actions" });
  await expect(toolbar).toContainText("500 selected");

  await page.keyboard.press("Escape");
  await expect(toolbar).toHaveCount(0);
  await expect(selectionToggle).toHaveAttribute("aria-pressed", "false");
});
