import { expect, type Page, test } from "@playwright/test";
import { seriousOrCriticalViolations } from "./helpers/axe";
import {
  installPerformanceApiFixture,
  WORKSPACE_ID,
} from "./helpers/g11-performance-fixture";

const baseView = {
  workspaceId: WORKSPACE_ID,
  createdBy: "person-e2e",
  scope: "workspace",
  scopeId: WORKSPACE_ID,
  sharedWithTeamId: null,
  layout: "list",
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
};
const views = [
  {
    ...baseView,
    id: "view-pinned-e2e",
    name: "Escalations",
    visibility: "private",
    isPinned: true,
    query: {
      entity: "work_item",
      filter: { field: "priority", op: "eq", value: "urgent" },
    },
  },
  {
    ...baseView,
    id: "view-workspace-e2e",
    name: "Everything open",
    visibility: "workspace",
    isPinned: false,
    query: { entity: "work_item" },
  },
];

type Calls = {
  deletions: string[];
  creates: Array<Record<string, unknown>>;
  pins: string[];
  approvals: number;
  cancels: number;
};

async function mockViewsApi(
  page: Page,
  {
    deleteStatus = 202,
    capabilities = {},
  }: { deleteStatus?: number; capabilities?: Record<string, boolean> } = {},
) {
  const calls: Calls = {
    deletions: [],
    creates: [],
    pins: [],
    approvals: 0,
    cancels: 0,
  };
  let state = "pending";
  let pendingId = "pending-view-delete-1-e2e";
  let requested = 0;
  const json = (
    route: import("@playwright/test").Route,
    body: unknown,
    status = 200,
  ) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  await page.route("**/api/capabilities**", (route) =>
    json(route, {
      manageProjects: false,
      createProjects: false,
      updateProjects: false,
      deleteProjects: false,
      updateTasks: false,
      createTasks: false,
      deleteTasks: false,
      assignTasks: false,
      createLabels: false,
      updateLabels: false,
      deleteLabels: false,
      manageWorkspace: false,
      deleteWorkspace: false,
      inviteUsers: false,
      manageTeam: false,
      removeMembers: false,
      manageServiceCalendars: false,
      shareSavedViews: false,
      manageWorkspaceSettings: false,
      ...capabilities,
    }),
  );
  await page.route("**/api/views**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/count"))
      return json(route, { count: path.includes("pinned") ? 12 : 3 });
    if (path.endsWith("/pin")) {
      calls.pins.push(path.split("/").at(-2) ?? "");
      return json(route, { pinnedViewIds: [] });
    }
    if (request.method() === "DELETE") {
      calls.deletions.push(path.split("/").at(-1) ?? "");
      if (deleteStatus !== 202)
        return json(
          route,
          { message: "Insufficient capability" },
          deleteStatus,
        );
      requested += 1;
      pendingId = `pending-view-delete-${requested}-e2e`;
      state = "pending";
      return json(
        route,
        {
          pendingActionId: pendingId,
          action: "delete",
          summary: { name: "Escalations" },
          confirmation: "click",
          expiresAt: "2026-10-30T00:00:00.000Z",
          approveUrl: `/api/me/pending-actions/${pendingId}/approve`,
        },
        202,
      );
    }
    if (request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      calls.creates.push(body);
      return json(route, {
        ...baseView,
        ...body,
        id: "view-new-e2e",
        updatedAt: "2026-10-07T00:00:00.000Z",
      });
    }
    if (path.endsWith("/api/views")) return json(route, views);
    return json(
      route,
      views.find((view) => path.endsWith(view.id)) ?? views[0],
    );
  });
  await page.route(
    "**/api/me/pending-actions/pending-view-delete-**",
    async (route) => {
      const url = route.request().url();
      if (url.endsWith("/cancel")) {
        calls.cancels += 1;
        state = "cancelled";
        return json(route, {});
      }
      if (url.endsWith("/approve")) {
        calls.approvals += 1;
        state = "executed";
        return json(route, { id: pendingId, state });
      }
      return json(route, {
        id: pendingId,
        action: "delete",
        origin: "web",
        targetType: "saved_view",
        targetIds: ["view-pinned-e2e"],
        summary: { name: "Escalations" },
        confirmation: "click",
        approvalSupported: true,
        state,
        createdAt: "2026-10-06T00:00:00.000Z",
        expiresAt: "2026-10-30T00:00:00.000Z",
        invalidationReason: null,
        decidedAt: null,
        executedAt: null,
        requestingKeyName: null,
      });
    },
  );
  await page.route("**/api/work-items/search", (route) =>
    json(route, {
      data: [],
      page: { hasMore: false, nextCursor: null },
      meta: { total: 0 },
    }),
  );
  return calls;
}

test("a saved view deletion is a request that enters the pending-action review flow", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installPerformanceApiFixture(page);
  const calls = await mockViewsApi(page);
  await page.goto("/agent/views");
  await expect(
    page.getByRole("heading", { name: "Saved views", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Escalations" }),
  ).toBeVisible();
  await expect(page.getByText("12 matching work items")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("saved-views-index.png") });

  await page
    .getByRole("button", { name: "Request deletion of Escalations" })
    .click();
  await expect(page).toHaveURL(/pending-actions\/pending-view-delete-1-e2e/u);
  // Nothing was deleted by the request: it is only a pending action to review.
  expect(calls.deletions).toEqual(["view-pinned-e2e"]);
  await expect(
    page.getByRole("heading", { name: "Pending action" }),
  ).toBeVisible();
  await expect(page.getByText("view-pinned-e2e")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("saved-view-pending-action.png"),
  });
  await page.getByRole("button", { name: "Delete" }).click();
  await expect.poll(() => calls.approvals).toBe(1);

  await page.goto("/agent/views");
  await page
    .getByRole("button", { name: "Request deletion of Escalations" })
    .click();
  await expect(page).toHaveURL(/pending-actions\/pending-view-delete-2-e2e/u);
  await page.getByRole("button", { name: "Cancel request" }).click();
  await expect(
    page.getByText("The pending action was cancelled."),
  ).toBeVisible();
  expect(calls.cancels).toBe(1);
});

test("a refused deletion request keeps the list and says why", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  const calls = await mockViewsApi(page, { deleteStatus: 403 });
  await page.goto("/agent/views?query=Everything");
  await page
    .getByRole("button", { name: "Request deletion of Everything open" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Only the owner of a view",
  );
  await expect(page).toHaveURL(/\/agent\/views\?query=Everything/u);
  await expect(
    page.getByRole("heading", { name: "Everything open" }),
  ).toBeVisible();
  expect(calls.deletions).toEqual(["view-workspace-e2e"]);
});

test("the index filters by name through the URL, pins, and duplicates as a private view", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  const calls = await mockViewsApi(page);
  await page.goto("/agent/views");
  await page
    .getByRole("textbox", { name: "Filter saved views" })
    .fill("everything");
  await expect(page).toHaveURL(/query=everything/u);
  await expect(page.getByRole("heading", { name: "Escalations" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Pin Everything open" }).click();
  await expect.poll(() => calls.pins).toEqual(["view-workspace-e2e"]);
  await page
    .getByRole("button", {
      name: "Duplicate Everything open as a private view",
    })
    .click();
  await expect
    .poll(() => calls.creates.at(-1))
    .toMatchObject({
      name: "Everything open copy",
      visibility: "private",
      scope: "workspace",
      layout: "list",
      query: { entity: "work_item" },
    });
  await expect(page).toHaveURL(/\/agent\/views\/view-new-e2e\?/u);
});

test("a new view is private by default and sharing is offered only with the capability", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  const calls = await mockViewsApi(page);
  await page.goto("/agent/views");
  await page.getByRole("textbox", { name: "View name" }).fill("My queue");
  await page.getByRole("combobox", { name: "Visibility" }).click();
  await expect(page.getByRole("option", { name: "Private" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Team" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "Workspace" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Create view" }).click();
  await expect
    .poll(() => calls.creates.at(-1))
    .toMatchObject({
      name: "My queue",
      visibility: "private",
      scope: "workspace",
      scopeId: WORKSPACE_ID,
      layout: "list",
      query: { entity: "work_item" },
    });
});

test("the saved views index has no serious or critical axe violations @a11y", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  await mockViewsApi(page, {
    capabilities: { shareSavedViews: true, manageWorkspaceSettings: true },
  });
  await page.goto("/agent/views");
  await expect(page.getByText("12 matching work items")).toBeVisible();
  expect(await seriousOrCriticalViolations(page)).toEqual([]);
});
