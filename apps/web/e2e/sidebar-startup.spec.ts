import { expect, test } from "@playwright/test";
import { installPerformanceApiFixture } from "./helpers/g11-performance-fixture";

test("project navigation downloads after primary content without waiting for the sidebar chunk", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  let releaseSidebar: () => void = () => undefined;
  const navigationRequested = new Promise<void>((resolve) => {
    releaseSidebar = resolve;
  });
  let rowsAtNavigationRequest: number | undefined;
  // A serialized sidebar -> navigation download would deadlock this boundary.
  await page.route("**/assets/app-sidebar-*.js", async (route) => {
    await navigationRequested;
    await route.continue();
  });
  await page.route(/\/assets\/nav-projects-[^/]+\.js$/, async (route) => {
    rowsAtNavigationRequest = await page
      .locator("[data-testid=work-item-list-populated] tbody tr")
      .count();
    releaseSidebar();
    await route.continue();
  });
  await page.goto("/agent/projects/WLP/work?layout=list");
  await expect(
    page.locator("[data-testid=work-item-list-populated] tbody tr"),
  ).toHaveCount(500);
  await expect(
    page.getByRole("button", { name: "Inbox", exact: true }),
  ).toBeVisible();
  expect(rowsAtNavigationRequest).toBe(500);
  await expect(
    page.getByRole("button", { name: "Performance fixture", exact: true }),
  ).toBeVisible();
});
