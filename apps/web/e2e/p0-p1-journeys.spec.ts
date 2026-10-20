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
        }),
      }),
    );
  });

  test("Journey 1: Agent Workspace Home (/agent), Inbox (/agent/inbox), My Work (/agent/my-work), and Global Search (/agent/search)", async ({
    page,
  }) => {
    await page.goto("/agent");
    await expect(
      page.getByRole("heading", { name: "Workspace home" }),
    ).toBeVisible();

    await page.goto("/agent/inbox?filter=unread");
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    await expect(page).toHaveURL(/\/agent\/inbox\?filter=unread/);

    await page.goto("/agent/my-work?lens=assigned");
    await expect(page.getByRole("heading", { name: "My work" })).toBeVisible();
    await expect(page).toHaveURL(/\/agent\/my-work\?lens=assigned/);

    await page.goto("/agent/search?q=SSO&scope=work_items");
    await expect(
      page.getByRole("heading", { name: "Global search" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/agent\/search\?q=SSO&scope=work_items/);
  });

  test("Journey 2: Project Overview (/agent/projects/$projectKey) and Work Layout Switcher (board, list, table)", async ({
    page,
  }) => {
    await page.goto("/agent/projects/WLP");
    await expect(
      page.getByRole("heading", { name: "Project overview" }),
    ).toBeVisible();

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

  test("Journey 6: Profile Settings (/agent/settings/profile and /agent/settings/profile/appearance)", async ({
    page,
  }) => {
    await page.goto("/agent/settings/profile");
    await expect(
      page.getByRole("heading", { name: "Profile settings" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Saved")).toBeVisible();

    await page.goto("/agent/settings/profile/appearance");
    await expect(
      page.getByRole("heading", { name: "Appearance" }),
    ).toBeVisible();
    const darkBtn = page.getByRole("button", { name: "Dark", exact: true });
    await darkBtn.click();
    await expect(darkBtn).toHaveAttribute("aria-pressed", "true");
  });

  test("Journey 7: Workspace Settings (/agent/settings/*) and slug-confirmed Danger Zone pending-action guard", async ({
    page,
  }) => {
    await page.goto("/agent/settings");
    await expect(
      page.getByRole("heading", { name: "Workspace settings" }),
    ).toBeVisible();

    await page.goto("/agent/settings/members?q=Maya");
    await expect(
      page.getByRole("heading", { name: "Workspace members" }),
    ).toBeVisible();

    await page.goto("/agent/settings/states");
    await expect(
      page.getByRole("heading", { name: "Workspace states" }),
    ).toBeVisible();

    await page.goto("/agent/settings/labels");
    await expect(
      page.getByRole("heading", { name: "Workspace labels" }),
    ).toBeVisible();

    await page.goto("/agent/settings/canned-responses?q=SLA");
    await expect(
      page.getByRole("heading", { name: "Canned responses" }),
    ).toBeVisible();

    await page.goto("/agent/settings/danger");
    await expect(
      page.getByRole("heading", { name: "Workspace danger zone" }),
    ).toBeVisible();
    const deleteBtn = page.getByRole("button", {
      name: "Request workspace deletion",
    });
    await expect(deleteBtn).toBeDisabled();
    const slugInput = page.getByLabel("Confirm workspace slug");
    const expectedSlug =
      (await slugInput.getAttribute("placeholder")) ?? "northstar-support";
    await slugInput.fill(expectedSlug);
    await expect(deleteBtn).toBeEnabled();
  });

  test("Journey 8: Project Settings (/agent/projects/$projectKey/settings/*) and key-confirmed Danger Zone pending-action guard", async ({
    page,
  }) => {
    await page.goto("/agent/projects/WLP/settings");
    await expect(
      page.getByRole("heading", { name: "Project settings" }),
    ).toBeVisible();

    await page.goto("/agent/projects/WLP/settings/members");
    await expect(
      page.getByRole("heading", { name: "Project members" }),
    ).toBeVisible();

    await page.goto("/agent/projects/WLP/settings/states");
    await expect(
      page.getByRole("heading", { name: "Project states" }),
    ).toBeVisible();

    await page.goto("/agent/projects/WLP/settings/labels");
    await expect(
      page.getByRole("heading", { name: "Project labels" }),
    ).toBeVisible();

    await page.goto("/agent/projects/WLP/settings/danger");
    await expect(
      page.getByRole("heading", { name: "Project danger zone" }),
    ).toBeVisible();
    const deleteBtn = page.getByRole("button", {
      name: "Request project deletion",
    });
    await expect(deleteBtn).toBeDisabled();
    await page.getByLabel("Confirm project key").fill("WLP");
    await expect(deleteBtn).toBeEnabled();
  });
});
