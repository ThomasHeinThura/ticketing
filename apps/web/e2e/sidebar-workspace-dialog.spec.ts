import { expect, test } from "@playwright/test";
import { installPerformanceApiFixture } from "./helpers/g11-performance-fixture";

test("sidebar workspace creation opens on demand and resets after cancellation", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  await page.goto("/agent/projects/WLP/work?layout=list");
  await expect(page.getByTestId("work-item-list-populated")).toBeVisible();
  const switcher = page.getByRole("button", {
    name: "Performance workspace",
    exact: true,
  });
  await expect(switcher).toBeVisible();
  await switcher.click();
  await page.getByRole("menuitem", { name: /Add workspace/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const name = dialog.getByPlaceholder("Workspace name");
  await expect(name).toBeFocused();
  await name.fill("Discard this draft");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await switcher.click();
  await page.getByRole("menuitem", { name: /Add workspace/i }).click();
  await expect(name).toHaveValue("");
  await page.screenshot({
    path: "test-results/kaneo-workspace-create-on-demand.png",
  });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
