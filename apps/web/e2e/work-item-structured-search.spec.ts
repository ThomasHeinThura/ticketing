import { expect, test } from "@playwright/test";
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

test("structured work-item filter is applied and restored from the worklist URL", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installPerformanceApiFixture(page);
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
  const filter = page.getByRole("textbox", { name: "Filter work items" });
  await filter.fill("priority:high");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
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

test("invalid structured filter shows the worklist error state", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  await page.route("**/api/work-items/search", async (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ message: "Invalid priority value" }),
    }),
  );
  await page.goto(WORK_LIST_PATH);
  await page
    .getByRole("textbox", { name: "Filter work items" })
    .fill("priority:bad");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await expect(page).toHaveURL(/filter=priority%3Abad/u);
  await expect(page.getByTestId("work-item-list-error")).toBeVisible();
});
