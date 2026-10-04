import { expect, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  PROJECT_ID,
  WORKSPACE_ID,
} from "./helpers/g11-performance-fixture";

test("responsive task properties, real fixture writes, help, and 200-card board", async ({
  browser,
}) => {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      await installPerformanceApiFixture(page);
      const writes: string[] = [];
      page.on("request", (request) => {
        if (request.method() !== "GET")
          writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
      });

      await page.goto(
        `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/task/legacy-task-1`,
      );
      const status = page.getByRole("button", { name: "Backlog", exact: true });
      await expect(status).toBeVisible();
      await expect(status).toHaveCount(1);
      await status.click();
      await page
        .getByRole("button", { name: /^In progress/ })
        .last()
        .click();
      await expect(
        page.getByRole("button", { name: "In progress", exact: true }),
      ).toBeVisible();

      await page
        .getByRole("button", { name: /Unassigned/ })
        .last()
        .click();
      await page
        .getByRole("button", { name: /G11 Agent/ })
        .last()
        .click();
      await expect(
        page.getByRole("button", { name: /G11 Agent/ }),
      ).toBeVisible();
      await expect
        .poll(() => writes)
        .toEqual([
          "PUT /api/task/status/legacy-task-1",
          "PUT /api/task/assignee/legacy-task-1",
        ]);

      await page.keyboard.press("?");
      const help = page.getByRole("dialog");
      await expect(help).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(help).toBeHidden();

      await page.goto(
        `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/board`,
      );
      await expect(page.locator('[data-task-id^="legacy-task-"]')).toHaveCount(
        200,
      );
      await expect(
        page.getByText("Seeded legacy task 200", { exact: true }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  }
});
