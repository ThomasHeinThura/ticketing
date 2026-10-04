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

      const taskReady = page.waitForResponse((response) => {
        const request = response.request();
        return (
          request.method() === "GET" &&
          new URL(response.url()).pathname === "/api/task/legacy-task-1" &&
          response.ok()
        );
      });
      await page.goto(
        `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/task/legacy-task-1`,
      );
      await taskReady;
      const status = page.getByRole("button", { name: "Backlog", exact: true });
      await expect(status).toBeVisible();
      await expect(status).toHaveCount(1);
      await status.click();
      await page
        .getByRole("button", { name: /^In progress/ })
        .last()
        .click();
      const selectedStatus = page
        .locator('[data-slot="popover-trigger"]:visible')
        .filter({ hasText: "In progress" });
      await expect(selectedStatus).toHaveCount(1);
      await expect(selectedStatus).toHaveAttribute("aria-expanded", "false");

      await page
        .getByRole("button", { name: /Unassigned/ })
        .last()
        .click();
      await page
        .getByRole("button", { name: /G11 Agent/ })
        .last()
        .click();
      const selectedAssignee = page
        .locator('[data-slot="popover-trigger"]:visible')
        .filter({ hasText: "G11 Agent" });
      await expect(selectedAssignee).toHaveCount(1);
      await expect(selectedAssignee).toHaveAttribute("aria-expanded", "false");
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

      const boardReady = page.waitForResponse((response) => {
        const request = response.request();
        return (
          request.method() === "GET" &&
          new URL(response.url()).pathname ===
            `/api/task/tasks/${PROJECT_ID}` &&
          response.ok()
        );
      });
      await page.goto(
        `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/board`,
      );
      await boardReady;
      await expect(page.locator('[data-task-id^="legacy-task-"]')).toHaveCount(
        200,
      );
      await expect(
        page.getByText("Seeded legacy task 200", { exact: true }),
      ).toBeVisible();

      const keyboardCard = page.locator(
        '[data-task-id="legacy-task-1"][role="button"][aria-describedby^="DndDescribedBy"]',
      );
      const liftedKeyboardCard = page.locator(
        '[data-task-id="legacy-task-1"][data-task-dragging="true"]',
      );
      const announcement = (text: string) =>
        page.locator('[aria-live="assertive"]').filter({ hasText: text });
      const taskWrites: Array<{ path: string; body: unknown }> = [];
      page.on("request", (request) => {
        if (
          request.method() === "PUT" &&
          new URL(request.url()).pathname.startsWith("/api/v2/task/")
        ) {
          taskWrites.push({
            path: new URL(request.url()).pathname,
            body: request.postDataJSON(),
          });
        }
      });

      await keyboardCard.focus();
      await expect(keyboardCard).toBeFocused();
      await page.keyboard.press("Space");
      await expect(liftedKeyboardCard).toHaveCount(1);
      await expect(
        announcement("Picked up draggable item legacy-task-1."),
      ).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(liftedKeyboardCard).toHaveCount(0);
      await expect(
        announcement(
          "Dragging was cancelled. Draggable item legacy-task-1 was dropped.",
        ),
      ).toHaveCount(1);
      expect(taskWrites).toHaveLength(0);

      await keyboardCard.focus();
      await page.keyboard.press("Space");
      await expect(liftedKeyboardCard).toHaveCount(1);
      await expect(
        announcement("Picked up draggable item legacy-task-1."),
      ).toHaveCount(1);
      await page.keyboard.press("ArrowDown");
      await expect(
        announcement(
          "Draggable item legacy-task-1 was moved over droppable area",
        ),
      ).toHaveCount(1);
      const keyboardDrop = page.waitForResponse((response) => {
        const request = response.request();
        return (
          request.method() === "PUT" &&
          new URL(response.url()).pathname === "/api/v2/task/legacy-task-1" &&
          response.ok()
        );
      });
      await page.keyboard.press("Space");
      await expect(
        announcement(
          "Draggable item legacy-task-1 was dropped over droppable area",
        ),
      ).toHaveCount(1);
      await keyboardDrop;
      await expect.poll(() => taskWrites.length).toBe(50);
      expect(
        taskWrites.find((write) => write.path === "/api/v2/task/legacy-task-1")
          ?.body,
      ).toMatchObject({ position: 1 });
    } finally {
      await context.close();
    }
  }
});
