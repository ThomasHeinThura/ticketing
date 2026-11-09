import { expect, type Page, test } from "@playwright/test";
import { installPerformanceApiFixture } from "./helpers/g11-performance-fixture";
import {
  installReportsFitFixture,
  SLA_ATTAINMENT,
} from "./helpers/reports-fit-fixture";

// UAT re-audit, 3 Nov (reports): an SLA KPI tile with too little data keeps its sentence and its
// name inside the tile; a viewer is offered no save; the organisation filter comes with the
// report; Reports off shows one notice with no report request and no way into a second one.
// Runs on the G11 network-edge fixture plus the reports overlay. Screenshots are evidence files.

const VIEWPORTS = [
  ["desktop", { width: 1440, height: 900 }],
  ["tablet", { width: 768, height: 1024 }],
  ["phone", { width: 375, height: 812 }],
] as const;
const THEMES = ["light", "dark"] as const;

const INSUFFICIENT_SLA = {
  ...SLA_ATTAINMENT,
  metrics: [
    {
      key: "attainment",
      label: "Attainment",
      unit: "percent",
      value: null,
      n: 1,
      needed: 10,
    },
    ...SLA_ATTAINMENT.metrics.slice(1),
  ],
};

async function json(page: Page, pattern: RegExp, body: unknown) {
  await page.route(pattern, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    }),
  );
}

async function open(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme });
  await installPerformanceApiFixture(page);
  // The reports overlay also resolves `feature.reports` on for the active workspace.
  await installReportsFitFixture(page);
  await page.addInitScript((value) => {
    localStorage.setItem(
      "user-preferences",
      JSON.stringify({ state: { theme: value }, version: 0 }),
    );
  }, theme);
}

async function shot(page: Page, name: string) {
  await page.screenshot({
    path: test.info().outputPath(`${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

/** `/api/capabilities` for a role that holds only `flags` (all false: a viewer). */
async function capabilities(page: Page, flags: Record<string, boolean>) {
  await page.route(/\/api\/capabilities(\?|$)/u, (route) =>
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
        createSavedViews: false,
        shareSavedViews: false,
        manageWorkspaceSettings: false,
        transitionTasks: false,
        rankTasks: false,
        manageProjectSettings: false,
        bindProjectOrganisation: false,
        ...flags,
      }),
    }),
  );
}

for (const [viewportName, viewport] of VIEWPORTS)
  for (const theme of THEMES)
    test(`SLA KPI tile with too little data fits at ${viewportName} (${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await open(page, theme);
      await json(
        page,
        /\/api\/dashboards\/fit-dashboard\/widgets\/w-sla\/data(\?|$)/u,
        INSUFFICIENT_SLA,
      );
      await page.goto("/agent/dashboard");
      const tile = page
        .getByTestId("dashboard-widget")
        .filter({ has: page.getByTestId("dashboard-widget-insufficient") });
      await expect(
        tile.getByText("Not enough data (1 of 10 needed)", { exact: true }),
      ).toBeVisible();
      await expect(tile.getByText("Attainment", { exact: true })).toBeVisible();
      const fit = await tile.evaluate((card) => {
        const frame = card.querySelector<HTMLElement>(
          '[data-slot="scroll-area-viewport"]',
        );
        const content = card.querySelector<HTMLElement>(
          '[data-testid="dashboard-widget-insufficient"]',
        );
        if (!frame || !content) return { ok: false, why: "missing" };
        const outer = frame.getBoundingClientRect();
        const inner = content.getBoundingClientRect();
        return {
          ok:
            frame.scrollHeight <= frame.clientHeight + 1 &&
            inner.bottom <= outer.bottom + 1 &&
            inner.right <= outer.right + 1,
          why: `${frame.scrollHeight}/${frame.clientHeight} ${Math.round(inner.bottom)}/${Math.round(outer.bottom)}`,
        };
      });
      expect(fit.ok, fit.why).toBe(true);
      await tile.scrollIntoViewIfNeeded();
      await shot(page, `dashboard-sla-insufficient-${viewportName}-${theme}`);
    });

for (const theme of THEMES)
  test(`a viewer is offered no save (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, theme);
    await capabilities(page, {});
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/views"))
        posts.push(request.url());
      if (request.url().includes("/api/views/team-audiences"))
        posts.push(request.url());
    });
    await page.goto("/agent/reports");
    await expect(
      page.getByRole("heading", { name: "Reports", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Dashboards", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("New custom report", { exact: true }),
    ).toHaveCount(0);
    await shot(page, `reports-index-viewer-${theme}`);
    await page.goto("/agent/reports/new");
    await expect(
      page.getByText("Your role can run reports but not save them.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Save report" })).toHaveCount(
      0,
    );
    await shot(page, `report-builder-viewer-${theme}`);
    expect(posts).toEqual([]);
  });

// The report-relevant capabilities of the built-in roles (packages/permissions roles.ts): a member
// holds saved_view:create; a lead holds saved_view:share, which implies it. Neither holds
// project:create, which the create-project organisation picker needs.
const ROLES = [
  ["viewer", {}],
  ["member", { createSavedViews: true }],
  ["lead", { createSavedViews: true, shareSavedViews: true }],
] as const;

for (const [role, flags] of ROLES)
  test(`the organisation filter lists the report's own organisations (${role})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "dark");
    await capabilities(page, flags);
    await json(page, /\/api\/reports\/sla_attainment(\?|$)/u, {
      ...SLA_ATTAINMENT,
      organisations: [
        { id: "org-acme", name: "Acme Ltd" },
        { id: "org-globex", name: "Globex" },
      ],
    });
    const asked: string[] = [];
    const forbidden: string[] = [];
    const consoleForbidden: string[] = [];
    page.on("request", (request) => {
      if (
        request.url().includes("/api/project/organisations") ||
        request.url().includes("/api/views/team-audiences")
      )
        asked.push(request.url());
    });
    page.on("response", (response) => {
      if (response.status() === 403) forbidden.push(response.url());
    });
    page.on("console", (message) => {
      if (message.type() === "error" && message.text().includes("403"))
        consoleForbidden.push(message.text());
    });
    await page.goto("/agent/reports/sla_attainment");
    await page.getByRole("button", { name: "Organisation" }).click();
    await expect(page.getByRole("button", { name: "Globex" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Acme Ltd" })).toBeVisible();
    await shot(page, `report-organisation-filter-${role}-dark`);
    await page.keyboard.press("Escape");
    // A role that may create a saved view is offered the custom report and its save.
    await page.goto("/agent/reports");
    await expect(
      page.getByRole("heading", { name: "Reports", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("New custom report", { exact: true }),
    ).toHaveCount(role === "viewer" ? 0 : 1);
    await page.goto("/agent/reports/new");
    await expect(
      page.getByRole("heading", { name: "Report builder", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Save report" })).toHaveCount(
      role === "viewer" ? 0 : 1,
    );
    // The agent pane scrolls inside itself: bring the save card (or the no-save notice) on screen.
    const saveState =
      role === "viewer"
        ? page.getByTestId("report-builder-read-only")
        : page.getByRole("button", { name: "Save report" });
    await expect(saveState).toBeVisible();
    if (role === "viewer") {
      await expect(saveState).toHaveText(
        "Your role can run reports but not save them.",
      );
    }
    await saveState.scrollIntoViewIfNeeded();
    await shot(page, `report-builder-${role}-dark`);
    expect(asked).toEqual([]);
    expect(forbidden).toEqual([]);
    expect(consoleForbidden).toEqual([]);
  });

for (const theme of THEMES)
  test(`Reports off: one notice, no report request, no way in (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, theme);
    await page.route(
      /\/api\/(workspaces\/[^/]+\/)?features\/resolved/u,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ features: [] }),
        }),
    );
    const reportRequests: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (/^\/api\/(reports|dashboards|report-exports)/u.test(path))
        reportRequests.push(path);
    });
    for (const [url, title] of [
      ["/agent/dashboard", "Dashboard"],
      ["/agent/reports", "Reports"],
      ["/agent/reports/new", "Report builder"],
    ] as const) {
      await page.goto(url);
      await expect(
        page.getByRole("heading", { name: title, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Reports are off", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("Open editor", { exact: true })).toHaveCount(
        0,
      );
      await expect(
        page.getByText("New custom report", { exact: true }),
      ).toHaveCount(0);
      await shot(page, `reports-off-${title.replace(/\s/gu, "-")}-${theme}`);
    }
    expect(reportRequests).toEqual([]);
  });
