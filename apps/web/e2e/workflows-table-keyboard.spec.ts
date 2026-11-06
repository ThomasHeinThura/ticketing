import { expect, type Page, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  WORKSPACE_ID,
} from "./helpers/g11-performance-fixture";

// Synthetic API responses exercise the actual workflow settings screen without changing data.
async function installWorkflowFixture(page: Page) {
  await installPerformanceApiFixture(page);
  await page.route("**/api/workflows**", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      json: [
        {
          id: "workflow-keyboard-test",
          workspaceId: WORKSPACE_ID,
          key: "workflow-keyboard-reachability-example",
          name: "Synthetic change approval workflow",
          activeVersionId: "workflow-version-test",
          version: 1,
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
        },
      ],
    });
  });
  await page.route("**/api/change-cab-template**", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      json: {
        applied: true,
        workflowId: "workflow-keyboard-test",
        approvedStateTemplateId: "state-test",
        adoptedProjectIds: [],
        changeTypeCount: 1,
      },
    });
  });
}

test("a keyboard user can reveal the workflow table at phone width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installWorkflowFixture(page);
  await page.goto("/dashboard/settings/workspace/workflows");

  const region = page.getByRole("region", { name: "Workflows", exact: true });
  const viewport = region.locator('[data-slot="scroll-area-viewport"]');
  const workflow = region.getByRole("button", {
    name: "Synthetic change approval workflow",
    exact: true,
  });
  await expect(workflow).toBeVisible();
  expect(
    await viewport.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true);

  // Reach the scroll viewport through normal tab order rather than programmatic focus.
  let reached = false;
  for (let index = 0; index < 50; index += 1) {
    await page.keyboard.press("Tab");
    if (
      await viewport.evaluate((element) => document.activeElement === element)
    ) {
      reached = true;
      break;
    }
  }
  expect(reached).toBe(true);
  await expect(viewport).toBeFocused();
  expect(
    await viewport.evaluate((element) => element.matches(":focus-visible")),
  ).toBe(true);
  await expect
    .poll(() =>
      viewport.evaluate((element) => getComputedStyle(element).boxShadow),
    )
    .not.toBe("none");

  const lastCell = region
    .getByRole("row")
    .filter({ hasText: "Synthetic change approval workflow" })
    .getByRole("cell")
    .last();
  const lastCellIsFullyVisible = () =>
    lastCell.evaluate((cell) => {
      const frame = cell.closest('[data-slot="scroll-area-viewport"]');
      if (!frame) return false;
      const cellBounds = cell.getBoundingClientRect();
      const frameBounds = frame.getBoundingClientRect();
      return (
        cellBounds.left >= frameBounds.left - 1 &&
        cellBounds.right <= frameBounds.right + 1
      );
    });
  expect(await lastCellIsFullyVisible()).toBe(false);
  for (let index = 0; index < 80; index += 1) {
    await page.keyboard.press("ArrowRight");
    if (await lastCellIsFullyVisible()) break;
    await page.waitForTimeout(30);
  }
  await expect.poll(lastCellIsFullyVisible).toBe(true);
  await expect(viewport).toBeFocused();

  for (let index = 0; index < 80; index += 1) {
    await page.keyboard.press("ArrowLeft");
    if ((await viewport.evaluate((element) => element.scrollLeft)) <= 1) break;
    await page.waitForTimeout(30);
  }
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollLeft))
    .toBeLessThanOrEqual(1);
  await page.keyboard.press("Tab");
  await expect(workflow).toBeFocused();
});

test("the workflow table remains usable when it fits at desktop width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await installWorkflowFixture(page);
  await page.goto("/dashboard/settings/workspace/workflows");

  const region = page.getByRole("region", { name: "Workflows", exact: true });
  const viewport = region.locator('[data-slot="scroll-area-viewport"]');
  const workflow = region.getByRole("button", {
    name: "Synthetic change approval workflow",
    exact: true,
  });
  await expect(workflow).toBeVisible();
  expect(
    await viewport.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await workflow.focus();
  await expect(workflow).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(workflow).not.toBeFocused();
});
