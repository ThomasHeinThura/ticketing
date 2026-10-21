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

for (const view of ["work?layout=list", "backlog"]) {
  test(`project create control on ${view} does not wait for the workspace roster`, async ({
    page,
  }) => {
    await installPerformanceApiFixture(page);
    let releaseRoster: () => void = () => undefined;
    const rosterReleased = new Promise<void>((resolve) => {
      releaseRoster = resolve;
    });
    await page.route("**/api/workspace/ws-g11/members", async (route) => {
      await rosterReleased;
      await route.fallback();
    });
    let requestedProject = false;
    await page.route("**/api/capabilities?*", async (route) => {
      const projectId = new URL(route.request().url()).searchParams.get(
        "projectId",
      );
      if (projectId === "project-g11") requestedProject = true;
      await route.fulfill({
        json: { createTasks: projectId === "project-g11" },
      });
    });
    try {
      await page.goto(`/agent/projects/WLP/${view}`);
      await expect(page.getByTestId("create-work-item-trigger")).toBeVisible();
      expect(requestedProject).toBe(true);
    } finally {
      releaseRoster();
    }
  });

  test(`project denial hides create on ${view} despite workspace permission`, async ({
    page,
  }) => {
    await installPerformanceApiFixture(page);
    const projectCapabilityReply = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/capabilities" &&
        url.searchParams.get("projectId") === "project-g11"
      );
    });
    await page.route("**/api/capabilities?*", async (route) => {
      const projectId = new URL(route.request().url()).searchParams.get(
        "projectId",
      );
      await route.fulfill({ json: { createTasks: projectId === null } });
    });
    await page.goto(`/agent/projects/WLP/${view}`);
    const response = await projectCapabilityReply;
    expect(await response.json()).toMatchObject({ createTasks: false });
    await expect(
      page.getByRole("heading", { name: /Performance fixture/ }),
    ).toBeVisible();
    await expect(page.getByTestId("create-work-item-trigger")).toHaveCount(0);
  });
}
