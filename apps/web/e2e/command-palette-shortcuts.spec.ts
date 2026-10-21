import { expect, test } from "@playwright/test";
import { installPerformanceApiFixture } from "./helpers/g11-performance-fixture";

const shortcut = process.platform === "darwin" ? "Meta+k" : "Control+k";

for (const warmed of [false, true]) {
  test(`palette ${warmed ? "warm" : "cold"} toggle keeps focus and keyboard ownership`, async ({
    page,
  }, testInfo) => {
    await installPerformanceApiFixture(page);
    let releaseSidebar: () => void = () => undefined;
    const sidebarReleased = new Promise<void>((resolve) => {
      releaseSidebar = resolve;
    });
    if (!warmed) {
      await page.route("**/assets/app-sidebar-*.js", async (route) => {
        await sidebarReleased;
        await route.continue();
      });
    }
    try {
      await page.goto("/agent/projects/WLP/work?layout=list");
      const popup = page.locator('[data-slot="command-dialog-popup"]');
      if (warmed) await expect(popup).toHaveCount(1);
      else await expect(popup).toHaveCount(0);
      const trigger = page.getByTestId("create-work-item-trigger");
      await trigger.focus();
      await page.keyboard.press(shortcut);
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const input = dialog.getByPlaceholder(/search/i);
      await expect(input).toBeFocused();
      await input.fill("Projects");
      await expect(
        dialog.getByRole("option", { name: /^Projects\b/ }),
      ).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("palette-open.png") });
      for (const key of ["Tab", "Shift+Tab"]) {
        await page.keyboard.press(key);
        await expect
          .poll(() =>
            dialog.evaluate((element) =>
              element.contains(document.activeElement),
            ),
          )
          .toBe(true);
      }
      // The global toggle remains available while typing in the palette input.
      await input.focus();
      await page.keyboard.press(shortcut);
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await page.keyboard.press(shortcut);
      await expect(input).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    } finally {
      releaseSidebar();
    }
  });
}
