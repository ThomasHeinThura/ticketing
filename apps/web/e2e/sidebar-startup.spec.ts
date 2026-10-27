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
  // The work list renders its canonical table while project states load, then Kaneo's
  // grouped list (`[data-task-id]` rows); either one is the primary content.
  const list = page.locator("[data-testid=work-item-list-populated]");
  const renderedRows = async () =>
    Math.max(
      await list.locator("tbody tr").count(),
      await list.locator("[data-task-id]").count(),
    );
  // A serialized sidebar -> navigation download would deadlock this boundary.
  await page.route("**/assets/app-sidebar-*.js", async (route) => {
    await navigationRequested;
    await route.continue();
  });
  await page.route(/\/assets\/nav-projects-[^/]+\.js$/, async (route) => {
    rowsAtNavigationRequest = await renderedRows();
    releaseSidebar();
    await route.continue();
  });
  await page.goto("/agent/projects/WLP/work?layout=list");
  await expect.poll(renderedRows).toBe(500);
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

test("sidebar defers project creation code until the user opens the existing dialog", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  await page.route("**/api/capabilities?*", async (route) => {
    await route.fulfill({ json: { createProjects: true, createTasks: true } });
  });
  let creationRequested = false;
  page.on("request", (request) => {
    if (/\/assets\/create-project-modal-[^/]+\.js$/.test(request.url()))
      creationRequested = true;
  });
  await page.goto("/agent/projects/WLP/work?layout=list");
  // The sidebar names the project through the runtime terminology ("Add Project").
  const addProject = page.getByRole("button", { name: /^Add project$/iu });
  await expect(addProject).toBeVisible({ timeout: 15000 });
  // Let the work route finish settling (its interim table is replaced by the grouped list)
  // before clicking, so the click lands on the mounted sidebar.
  await expect(
    page.getByText("Seeded work item 1", { exact: true }).first(),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(creationRequested).toBe(false);
  await addProject.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(creationRequested).toBe(true);
  const name = dialog.getByPlaceholder("Project name", { exact: true });
  await name.fill("Deferred project");
  await expect(name).toHaveValue("Deferred project");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await addProject.click();
  await expect(name).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
