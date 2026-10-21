import { expect, type Page, test } from "@playwright/test";
import { seriousOrCriticalViolations } from "./helpers/axe";
import { installPerformanceApiFixture } from "./helpers/g11-performance-fixture";

const node = (number: number, extra = {}) => ({
  id: `item-${number}`,
  key: `WLP-${number}`,
  title: `Hierarchy task ${number}`,
  stateName: "Backlog",
  stateCategory: "backlog",
  hasChildren: false,
  ...extra,
});
const current = node(1, { parentId: "item-9000" });
const root = node(9000, { parentId: null });
async function fixture(page: Page) {
  await installPerformanceApiFixture(page);
  await page.route("**/api/work-items/*/approvals", (route) =>
    route.fulfill({ json: { approvals: [] } }),
  );
  await page.route("**/api/work-items/*/sla", (route) =>
    route.fulfill({
      json: {
        key: route.request().url().split("/").at(-2),
        startedAt: "2026-10-21T00:00:00Z",
        evaluatedAt: "2026-10-21T00:00:00Z",
        metrics: ["first_response", "resolution"].map((metric) => ({
          metric,
          state: "none",
          dueAt: null,
          targetMinutes: null,
          consumedMinutes: 0,
          consumedPct: 0,
          remainingMinutes: null,
        })),
      },
    }),
  );
  let failNext = false;
  await page.route("**/api/work-items/*/children*", async (route) => {
    const url = new URL(route.request().url());
    const key = url.pathname.split("/").at(-2);
    const cursor = url.searchParams.get("cursor");
    if (key === "WLP-1" && cursor && failNext) {
      return route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "Try again",
      });
    }
    let parent = current;
    let ancestors: unknown[] = [root];
    let data: ReturnType<typeof node>[] = [];
    let nextCursor: string | null = null;
    let total = 0;
    let progress = { completed: 0, total: 0 };
    if (key === "WLP-9000") {
      parent = root;
      ancestors = [];
      data = cursor
        ? [node(1, { hasChildren: true })]
        : Array.from({ length: 50 }, (_, i) => node(i + 2));
      nextCursor = cursor ? null : "root-next";
      total = 51;
      progress = { completed: 10, total: 103 };
    } else if (key === "WLP-1") {
      data = cursor
        ? [node(150)]
        : Array.from({ length: 50 }, (_, i) =>
            node(i + 100, { hasChildren: i === 0 }),
          );
      nextCursor = cursor ? null : "current-next";
      total = 51;
      progress = { completed: 10, total: 52 };
    } else if (key === "WLP-100") {
      parent = { ...node(100), parentId: "item-1" };
      ancestors = [root, current];
      data = [node(200)];
      total = 1;
      progress = { completed: 0, total: 1 };
    }
    return route.fulfill({
      json: {
        parent,
        ancestors,
        data,
        page: { hasMore: nextCursor !== null, nextCursor },
        meta: { total },
        progress,
      },
    });
  });
  return {
    failNextPage: () => {
      failNext = true;
    },
    allowPages: () => {
      failNext = false;
    },
  };
}

test("hierarchy preserves the current branch beyond the loaded page, pagination and disclosures on reload", async ({
  page,
}, info) => {
  await fixture(page);
  await page.goto("/agent/work-items/WLP-1?activity=comments");
  const section = page.getByTestId("work-item-hierarchy");
  await expect(section.getByText("10/52", { exact: true })).toBeVisible();
  await expect(section.locator('[aria-current="page"]')).toContainText(
    "WLP-1 ·",
  );
  await expect(
    section.getByText("Current branch outside the loaded page"),
  ).toBeVisible();
  await section
    .getByRole("button", {
      name: "Load more children of WLP-9000",
      exact: true,
    })
    .click();
  await expect(
    section.getByText("Current branch outside the loaded page"),
  ).toHaveCount(0);
  await section
    .getByRole("button", { name: "Expand WLP-100", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    section.getByRole("link", {
      name: "WLP-200 · Hierarchy task 200",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    section.getByRole("link", {
      name: "WLP-200 · Hierarchy task 200",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    section.getByText("Current branch outside the loaded page"),
  ).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("activity")).toBe("comments");
  expect(await seriousOrCriticalViolations(page)).toEqual([]);
  await section
    .getByRole("button", { name: "Hierarchy", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("kaneo-inline-hierarchy.png"),
    fullPage: true,
  });
  await section.getByRole("button", { name: "Hierarchy", exact: true }).click();
  await page.reload();
  await expect(section.getByRole("link")).toHaveCount(0);
  await section.getByRole("button", { name: "Hierarchy", exact: true }).click();
  await expect(section.locator('[aria-current="page"]')).toBeVisible();
});

test("a failed child page preserves rows and offers a working retry", async ({
  page,
}) => {
  const controls = await fixture(page);
  await page.goto("/agent/work-items/WLP-1");
  const section = page.getByTestId("work-item-hierarchy");
  await expect(section.getByText("10/52", { exact: true })).toBeVisible();
  controls.failNextPage();
  await section
    .getByRole("button", { name: "Load more children of WLP-1", exact: true })
    .click();
  await expect(section.getByRole("alert")).toBeVisible();
  await expect(
    section.getByRole("link", {
      name: "WLP-149 · Hierarchy task 149",
      exact: true,
    }),
  ).toBeVisible();
  controls.allowPages();
  await section.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    section.getByRole("link", {
      name: "WLP-150 · Hierarchy task 150",
      exact: true,
    }),
  ).toBeVisible();
  await expect(section.getByRole("alert")).toHaveCount(0);
});

test("hierarchy remains usable on mobile in dark mode with reduced motion", async ({
  page,
}, info) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/agent/work-items/WLP-1");
  const section = page.getByTestId("work-item-hierarchy");
  await expect(section.locator('[aria-current="page"]')).toBeVisible();
  await section
    .getByRole("button", { name: "Load more children of WLP-1", exact: true })
    .click();
  await expect(
    section.getByRole("link", {
      name: "WLP-150 · Hierarchy task 150",
      exact: true,
    }),
  ).toBeVisible();
  await section
    .getByRole("button", { name: "Hierarchy", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("kaneo-inline-hierarchy-mobile-dark.png"),
    fullPage: true,
  });
});

test("side-pane hierarchy keeps its item and disclosure state after reload", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/agent/projects/WLP/work?layout=list&item=WLP-1");
  const section = page.getByTestId("work-item-hierarchy");
  await section
    .getByRole("button", { name: "Expand WLP-100", exact: true })
    .click();
  await expect(
    section.getByRole("link", {
      name: "WLP-200 · Hierarchy task 200",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    section.getByRole("link", {
      name: "WLP-200 · Hierarchy task 200",
      exact: true,
    }),
  ).toBeVisible();
  const url = new URL(page.url());
  expect(url.searchParams.get("item")).toBe("WLP-1");
  expect(url.searchParams.get("layout")).toBe("list");
});

test("crafted page counts stop bounded replay while manual loading reaches further pages", async ({
  page,
}) => {
  await fixture(page);
  let requests = 0;
  await page.route("**/api/work-items/WLP-1/children*", async (route) => {
    requests++;
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    const index = cursor ? Number(cursor) : 0;
    await route.fulfill({
      json: {
        parent: { ...node(1), parentId: null },
        ancestors: [],
        data: [node(300 + index)],
        page: {
          hasMore: index < 4,
          nextCursor: index < 4 ? String(index + 1) : null,
        },
        meta: { total: 5 },
        progress: { total: 5, completed: 0 },
      },
    });
  });
  const query = new URLSearchParams({
    hierarchy: JSON.stringify({
      itemKey: "WLP-1",
      expanded: ["WLP-1"],
      pages: { "WLP-1": Number.MAX_SAFE_INTEGER },
    }),
  });
  await page.goto(`/agent/work-items/WLP-1?${query}`);
  const section = page.getByTestId("work-item-hierarchy");
  await expect(
    section.getByText("Restored the first 3 pages. Load more to continue."),
  ).toBeVisible();
  await expect(
    section.getByRole("link", {
      name: "WLP-302 · Hierarchy task 302",
      exact: true,
    }),
  ).toBeVisible();
  expect(requests).toBe(3);
  await section
    .getByRole("button", { name: "Load more children of WLP-1", exact: true })
    .click();
  await expect(
    section.getByRole("link", {
      name: "WLP-303 · Hierarchy task 303",
      exact: true,
    }),
  ).toBeVisible();
  await section
    .getByRole("button", { name: "Load more children of WLP-1", exact: true })
    .click();
  await expect(
    section.getByRole("link", {
      name: "WLP-304 · Hierarchy task 304",
      exact: true,
    }),
  ).toBeVisible();
  expect(requests).toBe(5);
});
