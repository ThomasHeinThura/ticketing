import { expect, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  WORK_LIST_PATH,
} from "./helpers/g11-performance-fixture";

test("work-list create dialog shell opens, closes, and reopens independently of the list", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installPerformanceApiFixture(page);
  await page.goto(WORK_LIST_PATH);

  const trigger = page.getByTestId("create-work-item-trigger");
  const dialog = page.getByRole("dialog");
  await expect(trigger).toBeVisible();
  await expect(
    page.locator("[data-testid=work-item-list-populated] tbody tr"),
  ).toHaveCount(500);

  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: /create/i })).toBeVisible();
  await expect(dialog.getByTestId("create-work-item-title")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("create-work-item-dialog.png"),
  });

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("create-work-item-title")).toBeVisible();
});
