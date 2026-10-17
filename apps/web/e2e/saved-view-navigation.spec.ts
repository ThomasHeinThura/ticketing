import { expect, type Page, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  WORKSPACE_ID,
} from "./helpers/g11-performance-fixture";

const query = {
  entity: "work_item",
  filter: { field: "priority", op: "eq", value: "high" },
  sort: [{ field: "key", direction: "asc" }],
};

const views = [
  {
    id: "view-private-pin",
    name: "Pinned private queue",
    visibility: "private",
    isPinned: true,
  },
  {
    id: "view-workspace-visible",
    name: "Workspace visible queue",
    visibility: "workspace",
    isPinned: false,
  },
  {
    id: "view-private-unpinned",
    name: "Private unpinned queue",
    visibility: "private",
    isPinned: false,
  },
  {
    id: "view-team-unpinned",
    name: "Team unpinned queue",
    visibility: "team",
    isPinned: false,
  },
] as const;

function savedView(view: (typeof views)[number]) {
  return {
    ...view,
    workspaceId: WORKSPACE_ID,
    createdBy: "user-g11",
    scope: "workspace",
    scopeId: WORKSPACE_ID,
    sharedWithTeamId: view.visibility === "team" ? "team-g11" : null,
    layout: "list",
    query,
    createdAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
  };
}

const emptyPage = {
  data: [],
  page: { hasMore: false, nextCursor: null },
  meta: { total: 0 },
};

async function installSavedViewNavigationApi(page: Page) {
  await page.route("**/api/views**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const id =
      path.endsWith("/count") || path.endsWith("/run")
        ? path.split("/").at(-2)
        : path.split("/").at(-1);
    if (path.endsWith("/count"))
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ count: 0 }),
      });
    if (path.endsWith("/run"))
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emptyPage),
      });
    const view = views.find((candidate) => candidate.id === id);
    const body = view ? savedView(view) : views.map(savedView);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

test("agent project work navigates through workspace views and the viewer's pin", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installPerformanceApiFixture(page);
  await installSavedViewNavigationApi(page);

  await page.goto("/agent/projects/WLP/work?layout=list");
  await expect(
    page.getByRole("link", { name: "Seeded work item 1", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/layout=list/u);
  await expect(page.locator('[data-sidebar="sidebar"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Saved views" })).toHaveCount(
    1,
  );
  await expect(
    page.getByRole("button", { name: "Workspace visible queue" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pinned private queue" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Private unpinned queue" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Team unpinned queue" }),
  ).toHaveCount(0);
  const workspaceNav = page.getByRole("button", {
    name: "Workspace visible queue",
  });
  const pinnedNav = page.getByRole("button", { name: "Pinned private queue" });
  await expect(pinnedNav).toBeVisible();
  const sidebarNames = await page
    .locator('[data-sidebar="sidebar"] button')
    .evaluateAll((buttons) =>
      buttons.map((button) => button.textContent?.trim() ?? ""),
    );
  const pinnedIndex = sidebarNames.findIndex((name) =>
    name.startsWith("Pinned private queue"),
  );
  const workspaceIndex = sidebarNames.findIndex((name) =>
    name.startsWith("Workspace visible queue"),
  );
  expect(pinnedIndex).toBeGreaterThanOrEqual(0);
  expect(workspaceIndex).toBeGreaterThan(pinnedIndex);
  await page.screenshot({
    path: testInfo.outputPath("project-work-sidebar.png"),
  });

  await workspaceNav.click();
  await expect(
    page.getByRole("heading", { name: "Workspace visible queue", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/agent\/views\/view-workspace-visible/u);
  await expect(page).toHaveURL(/workspaceId=ws-g11/u);
  await expect(page).toHaveURL(/scope=workspace/u);
  await expect(page).toHaveURL(/layout=list/u);
  await expect(page).toHaveURL(/filter=priority%3Ahigh/u);
  await expect(page.locator('[data-sidebar="sidebar"]')).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath("workspace-view-detail.png"),
  });

  await page.getByRole("button", { name: "Saved views" }).click();
  await expect(page).toHaveURL(/\/agent\/views(?:\?|$)/u);
  await expect(
    page.getByRole("heading", { name: "Saved views", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Workspace visible queue" }),
  ).toBeVisible();
  await expect(page.locator('[data-sidebar="sidebar"]')).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath("saved-views-index-from-agent.png"),
  });

  await page
    .locator('[data-sidebar="sidebar"]')
    .getByRole("button", { name: "Pinned private queue" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Pinned private queue", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/agent\/views\/view-private-pin/u);
  await expect(page.locator('[data-sidebar="sidebar"]')).toHaveCount(1);

  await page.setViewportSize({ width: 375, height: 720 });
  await page.emulateMedia({ colorScheme: "dark" });
  const sidebarTrigger = page.getByRole("button", { name: "Toggle sidebar" });
  await expect(sidebarTrigger).toBeVisible();
  await sidebarTrigger.focus();
  await sidebarTrigger.press("Enter");
  const mobileSidebar = page.getByRole("dialog", { name: "Sidebar" });
  await expect(mobileSidebar).toBeVisible();
  const mobileWorkspaceView = page.getByRole("button", {
    name: "Workspace visible queue",
  });
  await expect(mobileWorkspaceView).toBeVisible();
  await mobileWorkspaceView.click();
  await expect(mobileSidebar).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Workspace visible queue", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("mobile-dark-workspace-view.png"),
  });
});
