import { expect, type TestInfo, test } from "@playwright/test";
import { withMfaCsrfApp } from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";
import {
  installPerformanceApiFixture,
  WORK_LIST_PATH,
} from "./helpers/g11-performance-fixture";

const row = (number: number, priority: "high" | "low") => ({
  id: `search-item-${number}`,
  projectId: "project-g11",
  workspaceId: "ws-g11",
  typeId: "type-g11",
  number,
  key: `WLP-${number}`,
  title:
    priority === "high"
      ? "Matching high priority item"
      : "Nonmatching low priority item",
  description: null,
  stateId: "state-g11",
  stateName: "Backlog",
  stateCategory: "backlog",
  priority,
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

function apiOrigin(testInfo: TestInfo) {
  return testInfo.project.use.baseURL as string;
}

test("structured work-item filter is applied and restored from the worklist URL", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installPerformanceApiFixture(page, { apiOrigin: apiOrigin(testInfo) });
  const requests: Array<Record<string, unknown>> = [];
  await page.route("**/api/work-items/search", async (route) => {
    const request = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(request);
    const query = request.query as { filter?: unknown; sort?: unknown };
    const body = JSON.stringify(query.filter);
    if (body.includes('"bad"'))
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: "Invalid priority value" }),
      });
    const matchesHigh = body.includes('"high"');
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [matchesHigh ? row(1, "high") : row(2, "low")],
        page: { hasMore: false, nextCursor: null },
        meta: { total: 1 },
      }),
    });
  });

  await page.goto(WORK_LIST_PATH);
  await page.getByRole("button", { name: "Text" }).click();
  const filter = page.getByRole("textbox", { name: "Filter work items" });
  await filter.fill("priority:high");
  await page.getByRole("button", { name: "Apply filter" }).click();
  await expect(page).toHaveURL(/filter=priority%3Ahigh/u);
  await expect(page.getByText("Matching high priority item")).toBeVisible();
  await expect(page.getByText("Nonmatching low priority item")).toHaveCount(0);
  await expect(
    page.locator("[data-testid=work-item-list-populated] tbody tr"),
  ).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath("structured-work-item-filter.png"),
    fullPage: true,
  });
  expect(requests.at(-1)?.query).toMatchObject({
    entity: "work_item",
    filter: {
      op: "and",
      clauses: [
        { field: "project", op: "eq", value: "WLP" },
        { field: "priority", op: "eq", value: "high" },
      ],
    },
  });

  await page.getByRole("button", { name: "Title" }).click();
  await expect(page).toHaveURL(/sort=title/u);
  await expect(page).toHaveURL(/filter=priority%3Ahigh/u);
  await expect
    .poll(() => requests.at(-1)?.query)
    .toMatchObject({ sort: [{ field: "title", order: "asc" }] });

  await page.reload();
  await expect(filter).toHaveValue("priority:high");
  await expect(page.getByText("Matching high priority item")).toBeVisible();
});

test("visual and text modes retain query URL state through history and reload", async ({
  page,
}, testInfo) => {
  await installPerformanceApiFixture(page, { apiOrigin: apiOrigin(testInfo) });
  const requests: Array<Record<string, unknown>> = [];
  await page.route("**/api/work-items/search", async (route) => {
    const request = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(request);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [row(1, "high")],
        page: { hasMore: false, nextCursor: null },
        meta: { total: 1 },
      }),
    });
  });

  await page.goto(
    `${WORK_LIST_PATH}&sort=priority&dir=desc&columns=%5B%22key%22%2C%22priority%22%5D`,
  );
  const textMode = page.getByRole("button", { name: "Text" });
  await textMode.click();
  await expect(page).toHaveURL(/filterMode=text/u);
  const filter = page.getByRole("textbox", { name: "Filter work items" });
  await filter.fill("(priority:high OR assignee:@me) AND due:>=7d");
  await page.getByRole("button", { name: "Apply filter" }).click();
  await expect(page).toHaveURL(/filter=%28priority%3Ahigh/u);
  await expect(page).toHaveURL(/sort=priority/u);
  await expect(page).toHaveURL(/dir=desc/u);
  await expect(page).toHaveURL(/columns=/u);
  await expect
    .poll(() => requests.at(-1)?.query)
    .toMatchObject({
      sort: [{ field: "priority", order: "desc" }],
      columns: ["key", "priority"],
    });

  await page.getByRole("button", { name: "Visual" }).click();
  await expect(page).toHaveURL(/filterMode=visual/u);
  await expect(
    page.getByRole("combobox", { name: "Group operator" }).first(),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/filterMode=text/u);
  await expect(filter).toHaveValue(
    "(priority:high OR assignee:@me) AND due:>=7d",
  );
  await page.reload();
  await expect(filter).toHaveValue(
    "(priority:high OR assignee:@me) AND due:>=7d",
  );
});

test("invalid structured filter shows the worklist error state", async ({
  page,
}, testInfo) => {
  await installPerformanceApiFixture(page, { apiOrigin: apiOrigin(testInfo) });
  await page.route("**/api/work-items/search", async (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ message: "Invalid priority value" }),
    }),
  );
  await page.goto(WORK_LIST_PATH);
  await page.getByRole("button", { name: "Text" }).click();
  await page
    .getByRole("textbox", { name: "Filter work items" })
    .fill("priority:bad");
  await page.getByRole("button", { name: "Apply filter" }).click();
  await expect(page).toHaveURL(/filter=priority%3Abad/u);
  await expect(page.getByTestId("work-item-list-error")).toBeVisible();
});

test("fixture-backed structured search renders real scoped work items", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(12_000);
  await withMfaCsrfApp(async ({ origin, email, password }) => {
    await page.goto(new URL("/auth/sign-up", origin).toString());
    await page.getByLabel("Full name").fill("Disposable Search Admin");
    await page.getByLabel("Email").fill(email);
    await page.locator('input[autocomplete="new-password"]').fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/onboarding(?:\?|$)/u);
    await page.getByLabel("Workspace name").fill("Structured Search Workspace");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page).toHaveURL(/\/dashboard\/workspace\//u);
    const workspaceId = new URL(page.url()).pathname
      .split("/")
      .filter(Boolean)
      .at(-1);
    expect(workspaceId).toBeTruthy();

    const csrfResponse = await page.request.get(
      new URL("/api/me/csrf-token", origin).toString(),
      { headers: { Origin: origin } },
    );
    expect(csrfResponse.status()).toBe(200);
    const { token } = (await csrfResponse.json()) as { token: string };
    const headers = { Origin: origin, "X-TaskDesk-CSRF": token };
    const projectResponse = await page.request.post(
      new URL("/api/project", origin).toString(),
      {
        headers,
        data: {
          workspaceId,
          name: "Structured Search Fixture",
          icon: "Folder",
          slug: "SSEA",
        },
      },
    );
    expect(projectResponse.status()).toBe(200);
    const project = (await projectResponse.json()) as {
      id: string;
      slug: string;
    };
    const typesResponse = await page.request.get(
      new URL(
        `/api/workspace/${workspaceId}/work-item-types`,
        origin,
      ).toString(),
      { headers: { Origin: origin } },
    );
    expect(typesResponse.status()).toBe(200);
    const types = (await typesResponse.json()) as Array<{ id: string }>;
    const type = types[0];
    expect(type).toBeDefined();
    for (const item of [
      { title: "Fixture high priority result", priority: "high" },
      { title: "Fixture low priority excluded", priority: "low" },
    ]) {
      const response = await page.request.post(
        new URL(`/api/projects/${project.id}/work-items`, origin).toString(),
        { headers, data: { typeId: type?.id, ...item } },
      );
      expect(response.status()).toBe(200);
    }

    await page.goto(
      new URL(
        `/agent/projects/${project.slug}/work?layout=list`,
        origin,
      ).toString(),
    );
    await expect(
      page.getByRole("heading", { name: "Structured Search Fixture" }),
    ).toBeVisible();
    const filter = page.getByRole("textbox", { name: "Filter work items" });
    await filter.fill("priority:high");
    await page.getByRole("button", { name: "Apply filter" }).click();
    await expect(page).toHaveURL(/filter=priority%3Ahigh/u);
    await expect(page.getByText("Fixture high priority result")).toBeVisible();
    await expect(page.getByText("Fixture low priority excluded")).toHaveCount(
      0,
    );
    await page.reload();
    await expect(filter).toHaveValue("priority:high");
    await expect(page.getByText("Fixture high priority result")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("fixture-backed-structured-search.png"),
      fullPage: true,
    });
  });
});
