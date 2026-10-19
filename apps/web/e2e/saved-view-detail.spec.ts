import { expect, type Page, test } from "@playwright/test";
import { seriousOrCriticalViolations } from "./helpers/axe";
import {
  installPerformanceApiFixture,
  PROJECT_ID,
  WORKSPACE_ID,
} from "./helpers/g11-performance-fixture";

const STORED_FILTER = { field: "priority", op: "eq", value: "high" };
const savedView = {
  id: "view-detail-e2e",
  workspaceId: WORKSPACE_ID,
  createdBy: "person-e2e",
  name: "High priority queue",
  scope: "workspace",
  scopeId: WORKSPACE_ID,
  visibility: "private",
  sharedWithTeamId: null,
  layout: "list",
  query: {
    entity: "work_item",
    filter: STORED_FILTER,
    sort: [{ field: "key", direction: "asc" }],
  },
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
};

const row = (number: number, title: string) => ({
  id: `sv-item-${number}`,
  projectId: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  typeId: "type-g11",
  number,
  key: `WLP-${number}`,
  title,
  description: null,
  stateId: "state-g11",
  stateName: "Backlog",
  stateCategory: "backlog",
  priority: "high",
  assigneeId: null,
  assigneeName: null,
  requesterId: null,
  parentId: null,
  position: number.toFixed(10),
  customerVisibility: "private",
  startDate: null,
  dueDate: null,
  archivedAt: null,
  deletedAt: null,
  version: 1,
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:00:00.000Z",
});

const page = (items: unknown[], total = items.length) =>
  JSON.stringify({
    data: items,
    page: { hasMore: false, nextCursor: null },
    meta: { total },
  });

type Calls = {
  run: number;
  count: number;
  search: Array<Record<string, unknown>>;
  patch: Array<Record<string, unknown>>;
  pin: number;
  create: Array<Record<string, unknown>>;
};

/** Mocks the saved-view API for one view; `readable: false` answers 404 like an out-of-reach one. */
async function mockSavedViewApi(
  page_: Page,
  {
    readable = true,
    capabilities = {},
    view = savedView,
  }: {
    readable?: boolean;
    capabilities?: Record<string, boolean>;
    view?: typeof savedView;
  } = {},
) {
  const calls: Calls = {
    run: 0,
    count: 0,
    search: [],
    patch: [],
    pin: 0,
    create: [],
  };
  let current = view;
  let pinned = false;
  await page_.route("**/api/capabilities**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
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
    }),
  );
  await page_.route("**/api/views**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path.endsWith("/team-audiences"))
      return json({ data: [{ id: "team-1", name: "Service desk" }] });
    if (path.endsWith("/count")) {
      calls.count += 1;
      return json({ count: 7 });
    }
    if (path.endsWith("/run")) {
      calls.run += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: page(
          [row(1, "Printer queue stuck"), row(2, "VPN drops on resume")],
          7,
        ),
      });
    }
    if (path.endsWith("/pin")) {
      calls.pin += 1;
      pinned = !pinned;
      return json({ pinnedViewIds: pinned ? [current.id] : [] });
    }
    if (path.endsWith(`/${current.id}`)) {
      if (!readable) return json({ message: "Saved view not found" }, 404);
      if (request.method() === "PATCH") {
        const body = request.postDataJSON() as Record<string, unknown>;
        calls.patch.push(body);
        current = {
          ...current,
          ...body,
          updatedAt: "2026-10-07T00:00:00.000Z",
        } as typeof current;
        return json(current);
      }
      return json(current);
    }
    if (request.method() === "POST") {
      calls.create.push(request.postDataJSON() as Record<string, unknown>);
      return json({
        ...current,
        id: "view-cloned-e2e",
        name: "High priority queue copy",
      });
    }
    return json(readable ? [{ ...current, isPinned: pinned }] : []);
  });
  await page_.route("**/api/work-items/search", async (route) => {
    calls.search.push(
      route.request().postDataJSON() as Record<string, unknown>,
    );
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: page([row(3, "Shared link result")], 1),
    });
  });
  return calls;
}

const storedUrl = (id = savedView.id) =>
  `/agent/views/${id}?workspaceId=${WORKSPACE_ID}&scope=workspace&scopeId=${WORKSPACE_ID}&layout=list&filter=priority%3Ahigh&sort=key&dir=asc`;

test("a readable view's own URL runs the stored view and shows its count", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installPerformanceApiFixture(page);
  const calls = await mockSavedViewApi(page);
  await page.goto(storedUrl());
  await expect(
    page.getByRole("heading", { name: "High priority queue", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("7 matching work items")).toBeVisible();
  await expect(page.getByText("Printer queue stuck")).toBeVisible();
  expect(calls.run).toBeGreaterThan(0);
  expect(calls.search).toHaveLength(0);
  await expect(page.getByTestId("saved-view-modified")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("saved-view-detail.png") });
});

test("a bare link to a readable view is replaced by its full definition (SV-19)", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  await mockSavedViewApi(page);
  await page.goto(`/agent/views/${savedView.id}`);
  await expect(
    page.getByRole("heading", { name: "High priority queue", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/workspaceId=ws-g11/u);
  await expect(page).toHaveURL(/scope=workspace/u);
  await expect(page).toHaveURL(/layout=list/u);
  await expect(page).toHaveURL(/filter=priority%3Ahigh/u);
  await expect(page).toHaveURL(/sort=key/u);
  await expect(page).toHaveURL(/dir=asc/u);
});

test("a complete link to a view the viewer cannot open runs its query as the viewer (SV-19)", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installPerformanceApiFixture(page);
  const calls = await mockSavedViewApi(page, { readable: false });
  await page.goto(
    `${storedUrl()}&columns=${encodeURIComponent('["key","title"]')}`,
  );
  await expect(page.getByTestId("saved-view-fallback")).toBeVisible();
  await expect(page.getByText("Shared link result")).toBeVisible();
  await expect(
    page.getByText("1 matching work item", { exact: true }),
  ).toBeVisible();
  expect(calls.run).toBe(0);
  expect(calls.count).toBe(0);
  expect(calls.search.at(-1)).toMatchObject({
    workspaceId: WORKSPACE_ID,
    query: {
      entity: "work_item",
      filter: STORED_FILTER,
      sort: [{ field: "key", order: "asc" }],
      columns: ["key", "title"],
    },
  });
  // Nothing that only the owner can do is offered for a view the viewer cannot read.
  await expect(page.getByRole("button", { name: "Pin" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit view" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Clone as private view" }),
  ).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("saved-view-shared-link.png"),
  });
});

test("an incomplete link to a view the viewer cannot open runs nothing", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  const calls = await mockSavedViewApi(page, { readable: false });
  await page.goto(
    `/agent/views/${savedView.id}?workspaceId=${WORKSPACE_ID}&filter=priority%3Ahigh`,
  );
  await expect(page.getByRole("alert")).toContainText("isn't available to you");
  expect(calls.search).toHaveLength(0);
  expect(calls.run).toBe(0);
});

test("a shared link to a project the viewer cannot reach is unavailable and runs nothing", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  const calls = await mockSavedViewApi(page, { readable: false });
  await page.goto(
    `/agent/views/${savedView.id}?workspaceId=${WORKSPACE_ID}&scope=project&scopeId=project-elsewhere&layout=list`,
  );
  await expect(
    page.getByRole("alert").filter({ hasText: "unavailable to your account" }),
  ).toBeVisible();
  expect(calls.search).toHaveLength(0);
});

test("a changed link runs as a direct search and says it is not the saved definition", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  const calls = await mockSavedViewApi(page);
  await page.goto(
    storedUrl().replace("filter=priority%3Ahigh", "filter=priority%3Alow"),
  );
  await expect(page.getByTestId("saved-view-modified")).toBeVisible();
  await expect(page.getByText("Shared link result")).toBeVisible();
  expect(calls.run).toBe(0);
  expect(calls.search.at(-1)).toMatchObject({
    query: { filter: { field: "priority", op: "eq", value: "low" } },
  });
});

test("a layout this screen cannot render is stated, runs nothing and keeps its stored query", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  const calls = await mockSavedViewApi(page, {
    view: { ...savedView, layout: "board" },
    capabilities: { manageWorkspaceSettings: true },
  });
  await page.goto(`/agent/views/${savedView.id}`);
  await expect(page.getByTestId("saved-view-unsupported")).toBeVisible();
  expect(calls.run).toBe(0);
  expect(calls.search).toHaveLength(0);
  await page.getByRole("button", { name: "Edit view" }).click();
  await page
    .getByRole("textbox", { name: "View name" })
    .fill("Board view renamed");
  await page.getByRole("button", { name: "Save view" }).click();
  await expect
    .poll(() => calls.patch.at(-1))
    .toEqual({
      name: "Board view renamed",
      visibility: "private",
      sharedWithTeamId: null,
    });
});

test("editing saves the name, audience and the query the URL carries", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installPerformanceApiFixture(page);
  const calls = await mockSavedViewApi(page, {
    capabilities: { manageWorkspaceSettings: true, shareSavedViews: false },
  });
  await page.goto(storedUrl());
  await expect(page.getByText("7 matching work items")).toBeVisible();
  await page.getByRole("button", { name: "Edit view" }).click();
  await page.getByRole("textbox", { name: "View name" }).fill("Escalations");
  await page.getByRole("combobox", { name: "Visibility" }).click();
  // A caller who cannot share with a team is offered private and workspace only.
  await expect(page.getByRole("option", { name: "Team" })).toHaveCount(0);
  await page.getByRole("option", { name: "Workspace" }).click();
  await page.getByRole("button", { name: "Text" }).click();
  await page
    .getByRole("textbox", { name: "Filter work items" })
    .fill("priority:urgent");
  await page.getByRole("button", { name: "Apply filter" }).click();
  await expect(page.getByTestId("saved-view-modified")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("saved-view-editing.png"),
  });
  await page.getByRole("button", { name: "Save view" }).click();
  await expect
    .poll(() => calls.patch.at(-1))
    .toEqual({
      name: "Escalations",
      visibility: "workspace",
      sharedWithTeamId: null,
      layout: "list",
      query: {
        entity: "work_item",
        filter: { field: "priority", op: "eq", value: "urgent" },
        sort: [{ field: "key", direction: "asc" }],
      },
    });
});

test("pin and clone act on the viewer's own copy", async ({ page }) => {
  await installPerformanceApiFixture(page);
  const calls = await mockSavedViewApi(page);
  await page.goto(storedUrl());
  await expect(page.getByText("7 matching work items")).toBeVisible();
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unpin" })).toBeVisible();
  expect(calls.pin).toBe(1);
  await page.getByRole("button", { name: "Clone as private view" }).click();
  await expect
    .poll(() => calls.create.at(-1))
    .toMatchObject({
      workspaceId: WORKSPACE_ID,
      name: "High priority queue copy",
      visibility: "private",
      scope: "workspace",
      layout: "list",
      query: { entity: "work_item", filter: STORED_FILTER },
    });
});

test("the saved view screen has no serious or critical axe violations, reading and editing @a11y", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installPerformanceApiFixture(page);
  await mockSavedViewApi(page, {
    capabilities: { manageWorkspaceSettings: true, shareSavedViews: true },
  });
  await page.goto(storedUrl());
  await expect(page.getByText("Printer queue stuck")).toBeVisible();
  expect(await seriousOrCriticalViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Edit view" }).click();
  await expect(
    page.getByRole("form", { name: "Work item filters" }),
  ).toBeVisible();
  expect(await seriousOrCriticalViolations(page)).toEqual([]);
});

test("a shared link to a view the viewer cannot open has no serious or critical axe violations @a11y", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  await mockSavedViewApi(page, { readable: false });
  await page.goto(storedUrl());
  await expect(page.getByTestId("saved-view-fallback")).toBeVisible();
  await expect(page.getByText("Shared link result")).toBeVisible();
  expect(await seriousOrCriticalViolations(page)).toEqual([]);
});
