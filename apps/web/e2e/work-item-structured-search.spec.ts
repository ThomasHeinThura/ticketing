import { expect, type Page, test } from "@playwright/test";
import { seriousOrCriticalViolations } from "./helpers/axe";
import {
  installPerformanceApiFixture,
  WORK_LIST_PATH,
} from "./helpers/g11-performance-fixture";

const SEARCH_ROUTE = "**/api/work-items/search";

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

type SearchRequest = {
  workspaceId?: string;
  query: { filter?: unknown; sort?: unknown; columns?: unknown };
};

/** Answers every search with one row and records what the page sent. */
async function mockSearch(
  page: Page,
  respond: (request: SearchRequest) => {
    status?: number;
    contentType?: string;
    body: string;
  } = (request) => ({
    body: JSON.stringify({
      data: [
        JSON.stringify(request.query.filter).includes('"high"')
          ? row(1, "high")
          : row(2, "low"),
      ],
      page: { hasMore: false, nextCursor: null },
      meta: { total: 1 },
    }),
  }),
) {
  const requests: SearchRequest[] = [];
  await page.route(SEARCH_ROUTE, async (route) => {
    const request = route.request().postDataJSON() as SearchRequest;
    requests.push(request);
    const reply = respond(request);
    return route.fulfill({
      status: reply.status ?? 200,
      contentType: reply.contentType ?? "application/json",
      body: reply.body,
    });
  });
  return requests;
}

const openFilter = (page: Page) =>
  page.getByRole("button", { name: /^Filter/ }).click();

test("structured filter is applied, scoped to the project and restored from the URL", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installPerformanceApiFixture(page);
  const requests = await mockSearch(page);

  await page.goto(WORK_LIST_PATH);
  await openFilter(page);
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
  });
  expect(requests.at(-1)).toMatchObject({
    workspaceId: "ws-g11",
    query: {
      entity: "work_item",
      filter: {
        op: "and",
        clauses: [
          { field: "project", op: "eq", value: "WLP" },
          { field: "priority", op: "eq", value: "high" },
        ],
      },
    },
  });

  await page.getByRole("button", { name: "Title" }).click();
  await expect(page).toHaveURL(/sort=title/u);
  await expect(page).toHaveURL(/filter=priority%3Ahigh/u);
  await expect
    .poll(() => requests.at(-1)?.query)
    .toMatchObject({ sort: [{ field: "title", order: "asc" }] });

  // The filtered list is addressable: a reload reproduces the same query.
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Filter work items" }),
  ).toHaveValue("priority:high");
  await expect(page.getByText("Matching high priority item")).toBeVisible();
});

test("a plain list read stays on the list route and loads no filter editor", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  const requests = await mockSearch(page);
  await page.goto(WORK_LIST_PATH);
  await expect(
    page.locator("[data-testid=work-item-list-populated] tbody tr").first(),
  ).toBeVisible();
  await expect(
    page.getByRole("form", { name: "Work item filters" }),
  ).toHaveCount(0);
  expect(requests).toHaveLength(0);
});

test("visual and text modes keep sort, direction and columns through history and reload", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  const requests = await mockSearch(page);

  await page.goto(
    `${WORK_LIST_PATH}&sort=priority&dir=desc&columns=%5B%22key%22%2C%22priority%22%5D&filter=assignee%3A%40me`,
  );
  await expect(
    page.getByRole("form", { name: "Work item filters" }),
  ).toBeVisible();
  // The chosen columns, in order, and nothing else.
  await expect(
    page.getByRole("columnheader").filter({ hasText: /\S/u }),
  ).toHaveText(["Key", "Priority"]);
  await expect
    .poll(() => requests.at(-1)?.query)
    .toMatchObject({
      sort: [{ field: "priority", order: "desc" }],
      columns: ["key", "priority"],
    });

  await page.getByRole("button", { name: "Text" }).click();
  await expect(page).toHaveURL(/filterMode=text/u);
  const filter = page.getByRole("textbox", { name: "Filter work items" });
  await filter.fill("(priority:high OR assignee:@me) AND due:>=7d");
  await page.getByRole("button", { name: "Apply filter" }).click();
  await expect(page).toHaveURL(/filter=%28priority%3Ahigh/u);
  for (const kept of [/sort=priority/u, /dir=desc/u, /columns=/u])
    await expect(page).toHaveURL(kept);

  await page.getByRole("button", { name: "Visual" }).click();
  await expect(page).toHaveURL(/filterMode=visual/u);
  await expect(
    page.getByRole("combobox", { name: "Group operator" }).first(),
  ).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/filterMode=text/u);
  await expect(
    page.getByRole("textbox", { name: "Filter work items" }),
  ).toHaveValue("(priority:high OR assignee:@me) AND due:>=7d");
  await page.goBack();
  await expect(page).toHaveURL(/filterMode=text/u);
  await page.goBack();
  await expect(page.getByRole("button", { name: "Text" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await page.goForward();
  await page.reload();
  await expect(page).toHaveURL(/filterMode=text/u);
  await expect(
    page.getByRole("columnheader").filter({ hasText: /\S/u }),
  ).toHaveText(["Key", "Priority"]);
});

test("invalid text stays in the editor and never reaches the search endpoint", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  const requests = await mockSearch(page);
  await page.goto(WORK_LIST_PATH);
  await openFilter(page);
  await page.getByRole("button", { name: "Text" }).click();
  await page
    .getByRole("textbox", { name: "Filter work items" })
    .fill("priority:bad");
  await page.getByRole("button", { name: "Apply filter" }).click();
  await expect(page.getByRole("alert")).toContainText("priority");
  await expect(page).not.toHaveURL(/filter=/u);
  expect(requests).toHaveLength(0);
});

test("a recognized but unavailable field shows the server's 422 beside the filter and an error state", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  // Hono answers a refused filter with plain text, not JSON.
  await mockSearch(page, () => ({
    status: 422,
    contentType: "text/plain",
    body: "Filter field unavailable: label",
  }));
  await page.goto(WORK_LIST_PATH);
  await openFilter(page);
  await page.getByRole("button", { name: "Text" }).click();
  await page
    .getByRole("textbox", { name: "Filter work items" })
    .fill("label:urgent");
  await page.getByRole("button", { name: "Apply filter" }).click();
  await expect(page).toHaveURL(/filter=label%3Aurgent/u);
  await expect(page.getByTestId("work-item-list-error")).toBeVisible();
  // The server's own wording and field name stay out of the UI.
  await expect(page.getByTestId("work-item-search-error")).toHaveText(
    "A field in this filter isn't available yet.",
  );
});

test("a filter that matches nothing says so and keeps the filter visible", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  await mockSearch(page, () => ({
    body: JSON.stringify({
      data: [],
      page: { hasMore: false, nextCursor: null },
      meta: { total: 0 },
    }),
  }));
  await page.goto(`${WORK_LIST_PATH}&filter=priority%3Aurgent`);
  await expect(page.getByTestId("work-item-list-empty")).toContainText(
    "No work items match this filter",
  );
  await expect(
    page.getByRole("form", { name: "Work item filters" }),
  ).toBeVisible();
});

test("the work list offers no export control (F3 hold)", async ({ page }) => {
  await installPerformanceApiFixture(page);
  await mockSearch(page);
  await page.goto(`${WORK_LIST_PATH}&filter=priority%3Ahigh`);
  await expect(page.getByTestId("work-item-list-populated")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /export|download/i }),
  ).toHaveCount(0);
});

test("the board says it does not apply a URL filter instead of looking unfiltered", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  await mockSearch(page);
  await page.goto(
    "/agent/projects/WLP/work?layout=board&filter=priority%3Ahigh",
  );
  await expect(page.getByTestId("board-filter-notice")).toBeVisible();
});

for (const mode of ["visual", "text"] as const) {
  test(`the filter editor in ${mode} mode has no serious or critical axe violations @a11y`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await installPerformanceApiFixture(page);
    await mockSearch(page);
    await page.goto(
      `${WORK_LIST_PATH}&filterMode=${mode}&filter=${encodeURIComponent("(priority:high OR assignee:@me) AND label:urgent")}`,
    );
    await expect(
      page.getByRole("form", { name: "Work item filters" }),
    ).toBeVisible();
    await expect(page.getByTestId("work-item-list-populated")).toBeVisible();
    expect(await seriousOrCriticalViolations(page)).toEqual([]);
  });
}

test("a filter matching more than one page loads the rest on demand", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  const requests = await mockSearch(page, (request) => {
    const second = (request as { cursor?: string }).cursor === "cursor-1";
    return {
      body: JSON.stringify({
        data: second ? [row(3, "high")] : [row(1, "high"), row(2, "high")],
        page: second
          ? { hasMore: false, nextCursor: null }
          : { hasMore: true, nextCursor: "cursor-1" },
        meta: { total: 3 },
      }),
    };
  });
  await page.goto(`${WORK_LIST_PATH}&filter=priority%3Ahigh`);
  const rows = page.locator("[data-testid=work-item-list-populated] tbody tr");
  await expect(rows).toHaveCount(2);
  await page.getByTestId("work-item-list-load-more").click();
  await expect(rows).toHaveCount(3);
  await expect(page.getByTestId("work-item-list-load-more")).toHaveCount(0);
  expect((requests.at(-1) as { cursor?: string }).cursor).toBe("cursor-1");
});

test("the filter toggle is a disclosure: focus enters the editor and returns on close", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  await mockSearch(page);
  await page.goto(WORK_LIST_PATH);
  const toggle = page.getByRole("button", { name: "Filter" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).not.toHaveAttribute("aria-pressed", /.*/u);
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Visual" })).toBeFocused();
  await page.getByRole("button", { name: "Text" }).click();
  await page
    .getByRole("textbox", { name: "Filter work items" })
    .press("Escape");
  await expect(
    page.getByRole("form", { name: "Work item filters" }),
  ).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});
