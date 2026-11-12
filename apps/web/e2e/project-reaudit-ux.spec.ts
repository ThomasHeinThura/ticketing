import { expect, type Page, type Route, test } from "@playwright/test";
import {
  BOARD_PROJECT_ID,
  BOARD_STATES,
  boardItemId,
  installPerformanceApiFixture,
  makeWorkItem,
  PROJECT_ID,
  PROJECT as project,
} from "./helpers/g11-performance-fixture";
import { installProjectOverviewFixture } from "./helpers/project-overview-fixture";

// UAT re-audit (3 Nov 2026) on the project screens, against the mocked API at the network
// edge: the project tab strip at tablet and desktop widths, not-found Project URLs, the board
// at phone width, the triage queue, the contract card, Documents for a caller without
// project:update (the fixture's default capabilities), and the project workflow settings,
// which show only the States editor.

/** Saves review evidence in the test's own output folder (test-results/…). */
async function shot(page: Page, name: string) {
  // Let open/close animations settle so the picture shows the resting state.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== "running"),
  );
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
}

/** The agent app keeps its own theme preference (dark by default), not the OS scheme. */
async function useTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((value) => {
    window.localStorage.setItem(
      "user-preferences",
      JSON.stringify({ state: { theme: value }, version: 0 }),
    );
  }, theme);
}

const json = (route: Route, body: unknown) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: {
      "Access-Control-Allow-Origin": "http://127.0.0.1:4178",
      "Access-Control-Allow-Credentials": "true",
    },
    body: JSON.stringify(body),
  });

for (const scheme of ["light", "dark"] as const) {
  test.describe(`project tab strip (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test("a 768 px tablet gets the project menu instead of a clipped strip", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await useTheme(page, scheme);
      await installPerformanceApiFixture(page);
      await page.goto("/agent/projects/WLP/work?layout=list");
      const menu = page.getByRole("button", { name: "Project navigation" });
      await expect(menu).toBeVisible();
      await expect(page.getByLabel("Work items", { exact: true })).toBeHidden();
      await menu.click();
      await expect(
        page.getByRole("button", { name: "Documents" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Team" })).toBeVisible();
      await shot(page, `tabstrip-768-${scheme}`);
    });

    for (const width of [1024, 1440]) {
      test(`at ${width} px every tab is visible or listed under More`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await useTheme(page, scheme);
        await installPerformanceApiFixture(page);
        await page.goto("/agent/projects/WLP/work?layout=list");
        const strip = page.getByLabel("Work items", { exact: true });
        await expect(strip).toBeVisible();
        await expect(
          strip.getByRole("button", { name: "Work items", exact: true }),
        ).toHaveAttribute("aria-current", "page");
        const hidden = await strip.evaluate((root) => {
          const viewport = root.querySelector<HTMLElement>(
            "[data-slot=scroll-area-viewport]",
          );
          const frame = viewport?.getBoundingClientRect();
          return [...root.querySelectorAll<HTMLElement>("[data-project-view]")]
            .filter((tab) => {
              const box = tab.getBoundingClientRect();
              return (
                !frame ||
                box.left < frame.left - 1 ||
                box.right > frame.right + 1
              );
            })
            .map((tab) => tab.textContent);
        });
        const more = page.getByRole("button", { name: "More Project views" });
        if (hidden.length === 0) {
          await expect(more).toHaveCount(0);
          await shot(page, `tabstrip-${width}-${scheme}`);
          return;
        }
        await expect(more).toBeVisible();
        await shot(page, `tabstrip-${width}-${scheme}`);
        await more.click();
        const items = page.getByRole("menuitem");
        await expect(items).toHaveText(hidden as string[]);
        await shot(page, `tabstrip-${width}-${scheme}-more`);
        await page.keyboard.press("Escape");

        // A vertical wheel over the strip scrolls it sideways.
        const viewport = strip.locator("[data-slot=scroll-area-viewport]");
        await viewport.hover();
        await page.mouse.wheel(0, 300);
        await expect
          .poll(() => viewport.evaluate((element) => element.scrollLeft))
          .toBeGreaterThan(0);
      });
    }
  });
}

test.describe("missing or out-of-reach Project URLs", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await installPerformanceApiFixture(page);
  });

  for (const path of [
    "/agent/projects/NOPE/work",
    "/agent/projects/NOPE/backlog",
    "/dashboard/settings/projects/missing-project/general",
    "/dashboard/settings/projects/missing-project/workflow",
  ]) {
    test(`${path} shows the not-found denial`, async ({ page }) => {
      await page.goto(path);
      const denial = page.getByTestId("project-not-found");
      await expect(denial).toContainText(
        "This Project does not exist or is out of reach.",
      );
      await expect(
        denial.getByRole("link", { name: "Back to Projects" }),
      ).toHaveAttribute("href", "/agent");
      await expect(
        page.getByText("Couldn't load", { exact: false }),
      ).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
      await shot(page, `not-found${path.replaceAll("/", "_")}`);
    });
  }
});

test("board at 375: one column fits the screen and Blocked sits inside its card", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await useTheme(page, "light");
  await installPerformanceApiFixture(page, { boardProject: true });
  // Registered after the shared fixture, so it is tried first: the board's rows as the
  // fixture builds them (50 per state), with BRD-1 blocked by two open items.
  await page.route(
    `**/api/projects/${BOARD_PROJECT_ID}/work-items**`,
    (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const data = Array.from({ length: 200 }, (_, index) => {
        const number = index + 1;
        const state = BOARD_STATES[Math.floor(index / 50)];
        return {
          ...makeWorkItem(number),
          id: boardItemId(number),
          projectId: BOARD_PROJECT_ID,
          key: `BRD-${number}`,
          title: `Seeded board item ${number}`,
          stateId: state.id,
          stateName: state.name,
          stateCategory: state.group,
          position: ((index % 50) + 1).toFixed(10),
          ...(number === 1 ? { blockedByOpenCount: 2 } : {}),
        };
      });
      return json(route, {
        data,
        page: { hasMore: false, nextCursor: null },
        meta: {},
      });
    },
  );
  await page.goto("/agent/projects/BRD/work?layout=board");
  const column = page.getByTestId("work-item-board-column").first();
  await expect(column).toBeVisible();
  const box = await column.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(375 - 32);
  const card = page.locator('[data-work-item-key="BRD-1"]');
  const frame = card.locator(".kanban-board-task-card");
  await expect(frame.getByTestId("work-item-blocked-badge")).toBeVisible();
  await shot(page, "board-375-light");
});

test("project overview contract card at 375 shows whole dates", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await useTheme(page, "light");
  await installPerformanceApiFixture(page);
  await installProjectOverviewFixture(page, PROJECT_ID, {
    project,
    contract: {
      startDate: "2026-10-01",
      endDate: "2027-09-30",
      contractedMinutes: 7200,
      coverage: "9x5",
      kickoffStatus: "completed",
      kickoffDate: "2026-10-05",
    },
    recentEntriesVisible: false,
  });
  await page.goto("/agent/projects/WLP");
  const panel = page.getByTestId("project-contract-panel");
  await panel.scrollIntoViewIfNeeded();
  const values = panel.locator("dd");
  await expect(values.first()).toBeVisible();
  const clipped = await values.evaluateAll((nodes) =>
    nodes
      .filter((node) => node.scrollWidth > node.clientWidth + 1)
      .map((node) => node.textContent),
  );
  expect(clipped).toEqual([]);
  await panel.screenshot({
    path: test.info().outputPath("overview-375-contract.png"),
  });
});

test("Documents empty state does not ask a reader to add documents", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await installPerformanceApiFixture(page);
  await installProjectOverviewFixture(page, PROJECT_ID, { project });
  await page.route(`**/api/project/${PROJECT_ID}/document-links`, (route) =>
    route.request().method() === "GET" ? json(route, []) : route.fallback(),
  );
  await page.goto("/agent/projects/WLP/documents");
  const empty = page.getByTestId("project-documents-empty");
  await expect(empty).toContainText(
    "No documents are registered for this Project yet.",
  );
  await expect(empty).not.toContainText("Add the contract");
  await expect(page.getByRole("button", { name: "Add document" })).toHaveCount(
    0,
  );
  await shot(page, "documents-empty-reader");
});

test("project workflow settings show the States editor, not the old board columns or GitHub automation rules", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installPerformanceApiFixture(page);
  const workflowRuleReads: string[] = [];
  await page.route("**/api/workflow-rule/**", (route) => {
    workflowRuleReads.push(route.request().url());
    return json(route, []);
  });
  await page.goto(`/dashboard/settings/projects/${PROJECT_ID}/workflow`);
  await expect(
    page.getByRole("heading", { name: "States", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Columns", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Automation Rules", exact: true }),
  ).toHaveCount(0);
  expect(workflowRuleReads).toEqual([]);
  await shot(page, "workflow-settings-states-only");
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`triage queue at 1280 (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test("aligns with the header, fits without sideways scroll and opens a row on click", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await useTheme(page, scheme);
      await installPerformanceApiFixture(page, { triageCapability: true });
      await page.route("**/api/submissions**", (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/api/submissions"))
          return json(route, {
            submissions: [
              {
                ref: "SUB-3",
                summary: "VPN drops every hour for the whole Rotterdam office",
                submission: {
                  state: "new",
                  createdAt: "2026-10-31T19:32:37.000Z",
                },
                requestType: { id: "rt-1", name: "Incident report" },
                requester: { displayName: "Ada Example-Lovelace" },
                organisation: { name: "Northstar Logistics International" },
                suggestedDuplicates: [
                  { id: "w1", key: "WLP-4", title: "VPN flaps" },
                ],
              },
            ],
            page: { hasMore: false, nextCursor: null },
          });
        return route.fallback();
      });
      await page.route("**/api/request-types**", (route) =>
        json(route, { requestTypes: [] }),
      );
      await page.route("**/api/intake/queues**", (route) => json(route, []));
      await page.goto("/agent/triage?state=new");
      const table = page.getByRole("table");
      await expect(table).toBeVisible();
      const title = page.locator("header h1").first();
      const content = page.getByTestId("triage-content");
      const [titleBox, contentBox] = await Promise.all([
        title.boundingBox(),
        content.boundingBox(),
      ]);
      // The content starts at the header's text gutter, not on the panel edge.
      expect(
        Math.abs((contentBox?.x ?? 0) + 16 - (titleBox?.x ?? 0) - 8),
      ).toBeLessThanOrEqual(8);
      const frame = await table.evaluate((element) => {
        const scroller = element.parentElement as HTMLElement;
        return {
          scrollWidth: scroller.scrollWidth,
          clientWidth: scroller.clientWidth,
        };
      });
      expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
      await shot(page, `triage-1280-${scheme}`);
      await page.getByText("Northstar Logistics International").click();
      await expect(page).toHaveURL(/ref=SUB-3/);
    });
  });
}
