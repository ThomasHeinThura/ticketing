import { expect, test } from "@playwright/test";
import { installPerformanceApiFixture } from "./helpers/g11-performance-fixture";

test.describe("Stage P0 & P1 Integrated E2E Journeys", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await installPerformanceApiFixture(page);
    await page.route("**/api/projects/*/states", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "state-g11",
            stateTemplateId: "tpl-backlog",
            name: "Backlog",
            group: "backlog",
            position: 0,
            isDefault: true,
          },
          {
            id: "state-in-progress",
            stateTemplateId: "tpl-in-progress",
            name: "In progress",
            group: "started",
            position: 1,
            isDefault: false,
          },
        ]),
      }),
    );
    await page.route("**/api/capabilities**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          manageProjects: true,
          createProjects: true,
          updateProjects: true,
          deleteProjects: true,
          updateTasks: true,
          createTasks: true,
          deleteTasks: true,
          assignTasks: true,
          exportTasks: true,
          createLabels: true,
          updateLabels: true,
          deleteLabels: true,
          manageWorkspace: true,
          deleteWorkspace: true,
          inviteUsers: true,
          manageTeam: true,
          removeMembers: true,
          manageServiceCalendars: true,
          shareSavedViews: true,
          manageWorkspaceSettings: true,
          manageRoles: true,
          manageWebhooks: true,
          manageCustomFields: true,
        }),
      }),
    );
  });

  test("Journey 1: Agent Workspace Home (/agent), Inbox (/agent/inbox), My Work (/agent/my-work), and Global Search (/agent/search)", async ({
    page,
  }) => {
    await page.goto("/agent");
    // `/agent` home is kaneo's projects page inside the kaneo shell (sidebar + breadcrumb).
    await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible();
    await expect(page.getByTestId("g13-projects-content")).toBeVisible();

    await page.goto("/agent/inbox?filter=unread");
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    await expect(page).toHaveURL(/\/agent\/inbox\?filter=unread/);

    await page.goto("/agent/my-work?lens=assigned");
    await expect(page.getByRole("heading", { name: "My work" })).toBeVisible();
    await expect(page).toHaveURL(/\/agent\/my-work\?lens=assigned/);

    // Search is kaneo's workspace search page.
    await page.goto("/agent/search?q=SSO&scope=work_items");
    await expect(page).toHaveURL(/\/dashboard\/workspace\/[^/]+\/search/);
  });

  test("Journey 2: Project Overview (/agent/projects/$projectKey) and Work Layout Switcher (board, list, table)", async ({
    page,
  }) => {
    // A project opens on its work view.
    await page.goto("/agent/projects/WLP");
    await expect(page).toHaveURL(/\/agent\/projects\/WLP\/work/);

    await page.goto("/agent/projects/WLP/work?layout=list");
    await expect(page.getByTestId("work-item-list-populated")).toBeVisible();

    await page.goto("/agent/projects/WLP/work?layout=table");
    await expect(page.getByTestId("work-item-list-populated")).toBeVisible();

    await page.goto("/agent/projects/WLP/work?layout=board");
    await expect(
      page.getByRole("heading", { name: "In progress" }),
    ).toBeVisible();
  });

  test("Journey 3: Table layout (?layout=table) column controls, sorting, and CSV export control", async ({
    page,
  }) => {
    await page.goto("/agent/projects/WLP/work?layout=table");
    const table = page.getByTestId("work-item-list-populated");
    await expect(table).toBeVisible();

    await page.getByRole("button", { name: /Filter/i }).click();
    await expect(page.getByTestId("work-item-column-controls")).toBeVisible();
    await expect(page.getByTestId("work-item-export-csv")).toBeVisible();
  });

  test("Journey 4: Addressable work-item side pane (?item=WLP-1) open and close round-trip", async ({
    page,
  }) => {
    await page.goto("/agent/projects/WLP/work?layout=list&item=WLP-1");
    const sidePane = page.getByTestId("work-item-side-pane");
    await expect(sidePane).toBeVisible();
    await expect(sidePane).toContainText("WLP-1");

    await page.getByRole("button", { name: "Close side pane" }).click();
    await expect(sidePane).toBeHidden();
    await expect(page).not.toHaveURL(/item=WLP-1/);
  });

  test("Journey 5: Project Backlog (/agent/projects/$projectKey/backlog) ranking surface", async ({
    page,
  }) => {
    await page.goto("/agent/projects/WLP/backlog");
    const backlog = page.getByTestId("project-backlog-page");
    await expect(backlog).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Performance fixture · Backlog" }),
    ).toBeVisible();
  });

  // Journeys 6–8: the /agent settings URLs open kaneo's real, API-wired settings pages
  // (docs/02-design/design-principles.md § Integrate, don't add).
  test("Journey 6: profile settings URLs open kaneo account settings", async ({
    page,
  }) => {
    await page.goto("/agent/settings/profile");
    await expect(page).toHaveURL(
      /\/dashboard\/settings\/account\/information$/,
    );
    await page.goto("/agent/settings/profile/appearance");
    await expect(page).toHaveURL(
      /\/dashboard\/settings\/account\/preferences$/,
    );
  });

  test("Journey 7: workspace settings URLs open kaneo workspace settings", async ({
    page,
  }) => {
    for (const [from, to] of [
      ["/agent/settings", /\/dashboard\/settings\/workspace\/general$/],
      ["/agent/settings/labels", /\/dashboard\/settings\/workspace\/labels$/],
      ["/agent/settings/danger", /\/dashboard\/settings\/workspace\/general$/],
      ["/agent/settings/members", /\/dashboard\/workspace\/[^/]+\/members$/],
    ] as const) {
      await page.goto(from);
      await expect(page).toHaveURL(to);
    }
  });

  test("Journey 8: project settings URLs open kaneo project settings", async ({
    page,
  }) => {
    for (const [from, to] of [
      [
        "/agent/projects/WLP/settings",
        /\/dashboard\/settings\/projects\/[^/]+\/general$/,
      ],
      [
        "/agent/projects/WLP/settings/members",
        /\/dashboard\/settings\/projects\/[^/]+\/general$/,
      ],
      [
        "/agent/projects/WLP/settings/states",
        /\/dashboard\/settings\/projects\/[^/]+\/workflow$/,
      ],
    ] as const) {
      await page.goto(from);
      await expect(page).toHaveURL(to);
    }
  });
});
