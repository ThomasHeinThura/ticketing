import { expect, type Page, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  PROJECT_ID,
  PROJECT as project,
} from "./helpers/g11-performance-fixture";
import { installProjectOverviewFixture } from "./helpers/project-overview-fixture";

// S3/S3b: a project opens on its Overview; /work and every old project link keep working.
// The API is mocked at the network edge (the G11 fixture plus a stateful Overview fixture).

async function capabilities(page: Page, canEdit: boolean) {
  await page.route("**/api/capabilities**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        manageProjects: canEdit,
        createProjects: canEdit,
        updateProjects: canEdit,
        deleteProjects: false,
        updateTasks: true,
        createTasks: canEdit,
        deleteTasks: false,
        assignTasks: true,
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
        manageProjectSettings: canEdit,
      }),
    }),
  );
}

test.describe("Project Overview (S3)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await installPerformanceApiFixture(page);
  });

  test("opens on the Overview, with Overview first in the tab strip", async ({
    page,
  }) => {
    await capabilities(page, true);
    await installProjectOverviewFixture(page, PROJECT_ID, { project });
    await page.goto("/agent/projects/WLP");
    await expect(page).toHaveURL(/\/agent\/projects\/WLP$/);
    await expect(page.getByTestId("project-overview-page")).toBeVisible();
    const header = page.getByTestId("project-overview-header-line");
    await expect(header).toContainText("Acme Ltd");
    await expect(header).toContainText("WLP");
    await expect(header).toContainText("12 open");
    await expect(header).toContainText("2 breached");
    await expect(page.getByTestId("project-kpi-work")).toContainText("30/42");
    await expect(page.getByTestId("project-overview-attention")).toBeVisible();

    const tabs = page.getByLabel("Work items", { exact: true });
    // Web-first assertions wait for the tab strip to render (allTextContents does not).
    await expect(tabs.getByRole("button").nth(0)).toHaveText("Overview");
    await expect(tabs.getByRole("button").nth(1)).toHaveText("Backlog");
    await expect(
      tabs.getByRole("button", { name: "Overview", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("old links keep working: /work, /backlog and the tabs", async ({
    page,
  }) => {
    await capabilities(page, true);
    await installProjectOverviewFixture(page, PROJECT_ID, { project });
    await page.goto("/agent/projects/WLP/work?layout=list");
    await expect(page).toHaveURL(/\/agent\/projects\/WLP\/work/);
    await expect(page.getByTestId("work-item-list-populated")).toBeVisible();

    await page.goto("/agent/projects/WLP/backlog");
    await expect(page.getByTestId("project-backlog-page")).toBeVisible();

    await page
      .getByLabel("Work items", { exact: true })
      .getByRole("button", { name: "Overview", exact: true })
      .click();
    await expect(page).toHaveURL(/\/agent\/projects\/WLP$/);
    await expect(page.getByTestId("project-overview-page")).toBeVisible();

    await page.goto("/agent/projects/WLP/prerequisites");
    await expect(page.getByTestId("project-prerequisite-row")).toContainText(
      "Customer VPN access",
    );
    await page.goto("/agent/projects/WLP/team");
    await expect(page.getByTestId("project-stakeholder-row")).toContainText(
      "Mia Manager",
    );
    await page.goto("/agent/projects/WLP/documents");
    await expect(page.getByTestId("project-document-row")).toContainText(
      "Statement of work",
    );
  });

  test("edits the summary and adds a contract, and the page shows them", async ({
    page,
  }) => {
    await capabilities(page, true);
    const state = await installProjectOverviewFixture(page, PROJECT_ID, {
      project,
    });
    await page.goto("/agent/projects/WLP");
    await page.getByTestId("project-overview-edit-summary").click();
    const dialog = page.getByRole("dialog", { name: "Edit summary" });
    await dialog.getByLabel("Objective").fill("Run first-line support");
    await dialog.getByRole("button", { name: "Save summary" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("project-summary-panel")).toContainText(
      "Run first-line support",
    );
    expect(state.requests.at(-1)).toMatchObject({
      method: "PATCH",
      body: { objective: "Run first-line support" },
    });

    await page.getByTestId("project-contract-edit").click();
    const contractDialog = page.getByRole("dialog", { name: "Add contract" });
    await contractDialog.getByLabel("Contracted hours").fill("120");
    // The end date defaults empty: enter it through the library date field's text entry.
    await contractDialog
      .getByRole("button", { name: /End date/u })
      .first()
      .click();
    await page.getByLabel("End date (YYYY-MM-DD)").fill("2099-12-31");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await contractDialog.getByRole("button", { name: "Save contract" }).click();
    await expect(contractDialog).toBeHidden();
    await expect(page.getByTestId("project-contract-panel")).toContainText(
      "45 h of 120 h used",
    );
    expect(state.requests.at(-1)).toMatchObject({
      method: "PUT",
      body: { contractedMinutes: 7200, endDate: "2099-12-31" },
    });
  });

  test("New item opens the create modal for this project", async ({ page }) => {
    await capabilities(page, true);
    await installProjectOverviewFixture(page, PROJECT_ID, { project });
    await page.goto("/agent/projects/WLP");
    await page.getByTestId("project-overview-new-item").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(project.slug);
    await expect(dialog).toContainText("To Do");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("Archive asks for confirmation, archives and leaves the project", async ({
    page,
  }) => {
    await capabilities(page, true);
    const state = await installProjectOverviewFixture(page, PROJECT_ID, {
      project,
    });
    await page.goto("/agent/projects/WLP");
    await page.getByTestId("project-overview-more").click();
    await page.getByRole("menuitem", { name: "Archive Project" }).click();
    const confirm = page.getByRole("alertdialog", {
      name: `Archive ${project.name}?`,
    });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toBeHidden();
    expect(state.requests.some((r) => r.path.endsWith("/archive"))).toBe(false);

    await page.getByTestId("project-overview-more").click();
    await page.getByRole("menuitem", { name: "Archive Project" }).click();
    await page.getByTestId("project-overview-archive-confirm").click();
    await expect(page).toHaveURL(/\/agent$/);
    expect(state.requests.at(-1)).toMatchObject({
      method: "PUT",
      path: `/api/project/${PROJECT_ID}/archive`,
    });
  });

  test("a viewer sees the Overview without edit controls", async ({ page }) => {
    await capabilities(page, false);
    await installProjectOverviewFixture(page, PROJECT_ID, { project });
    await page.goto("/agent/projects/WLP");
    await expect(page.getByTestId("project-overview-page")).toBeVisible();
    await expect(page.getByTestId("project-contract-panel")).toContainText(
      "No contract is recorded.",
    );
    await expect(page.getByTestId("project-overview-edit-summary")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("project-contract-edit")).toHaveCount(0);
    await expect(page.getByTestId("project-overview-new-item")).toHaveCount(0);
    await expect(page.getByTestId("project-overview-more")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add milestone" }),
    ).toHaveCount(0);
  });

  test("adds a milestone; a refused add keeps the dialog open with the reason", async ({
    page,
  }) => {
    await capabilities(page, true);
    const state = await installProjectOverviewFixture(page, PROJECT_ID, {
      project,
    });
    await page.goto("/agent/projects/WLP");
    const panel = page.getByTestId("project-milestones-panel");
    await expect(panel).toContainText("Go-live");
    state.refuse.set("POST /milestones", 403);
    await panel.getByRole("button", { name: "Add milestone" }).click();
    const dialog = page.getByRole("dialog", { name: "Add milestone" });
    await dialog.getByLabel("Name").fill("Hand-over");
    await dialog.getByRole("button", { name: "Date", exact: true }).click();
    const entry = page.getByLabel("Date (YYYY-MM-DD)");
    await entry.fill("2099-05-01");
    await entry.press("Enter");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toContainText(
      "You do not have permission to do that.",
    );
    await expect(panel).not.toContainText("Hand-over");

    state.refuse.delete("POST /milestones");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(panel).toContainText("Hand-over");
    expect(state.requests.at(-1)).toMatchObject({
      method: "POST",
      path: `/api/project/${PROJECT_ID}/milestones`,
      body: { name: "Hand-over", date: "2099-05-01T00:00:00.000Z" },
    });
    await page.reload();
    await expect(page.getByTestId("project-milestones-panel")).toContainText(
      "Hand-over",
    );
  });

  test("adds and ticks a prerequisite; a failed tick leaves it open", async ({
    page,
  }) => {
    await capabilities(page, true);
    const state = await installProjectOverviewFixture(page, PROJECT_ID, {
      project,
    });
    await page.goto("/agent/projects/WLP/prerequisites");
    await expect(page.getByTestId("project-prerequisites-page")).toBeVisible();
    await page.getByRole("button", { name: "Add prerequisite" }).click();
    const dialog = page.getByRole("dialog", { name: "Add prerequisite" });
    await dialog.getByLabel("Title").fill("Firewall rule for the jump host");
    await dialog.getByRole("button", { name: "Add prerequisite" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page
        .getByTestId("project-prerequisite-row")
        .filter({ hasText: "Firewall rule for the jump host" }),
    ).toBeVisible();
    expect(state.requests.at(-1)).toMatchObject({
      method: "POST",
      body: {
        title: "Firewall rule for the jump host",
        ownerSide: "customer",
        isBlocking: true,
      },
    });

    const tick = page.getByRole("checkbox", {
      name: 'Mark "Customer VPN access" done',
    });
    state.refuse.set("PATCH /prerequisites/r1", 500);
    await tick.click();
    await expect(page.getByText("That did not work. Try again.")).toBeVisible();
    await expect(tick).not.toBeChecked();

    state.refuse.delete("PATCH /prerequisites/r1");
    await tick.click();
    const done = page.getByRole("checkbox", {
      name: 'Mark "Customer VPN access" not done',
    });
    await expect(done).toBeChecked();
    expect(state.requests.at(-1)).toMatchObject({
      method: "PATCH",
      path: `/api/project/${PROJECT_ID}/prerequisites/r1`,
      body: { completed: true },
    });
    await page.reload();
    await expect(
      page.getByRole("checkbox", {
        name: 'Mark "Customer VPN access" not done',
      }),
    ).toBeChecked();
  });

  test("stands a stakeholder down only after confirming; a refusal keeps them active", async ({
    page,
  }) => {
    await capabilities(page, true);
    const state = await installProjectOverviewFixture(page, PROJECT_ID, {
      project,
    });
    const standDownPath = `/api/project/${PROJECT_ID}/stakeholders/s1/stand-down`;
    await page.goto("/agent/projects/WLP/team");
    const row = page
      .getByTestId("project-stakeholder-row")
      .filter({ hasText: "Mia Manager" });
    const openConfirm = async () => {
      await row
        .getByRole("button", { name: "Actions for Mia Manager" })
        .click();
      await page.getByRole("menuitem", { name: "Stand down" }).click();
      const confirm = page.getByRole("alertdialog", {
        name: "Stand down Mia Manager?",
      });
      await expect(confirm).toBeVisible();
      await expect(confirm).toContainText("This cannot be undone");
      return confirm;
    };

    const first = await openConfirm();
    await first.getByRole("button", { name: "Cancel" }).click();
    await expect(first).toBeHidden();
    const escaped = await openConfirm();
    await page.keyboard.press("Escape");
    await expect(escaped).toBeHidden();
    expect(state.requests.some((r) => r.path === standDownPath)).toBe(false);
    await expect(row).not.toContainText("Stood down");

    state.refuse.set("POST /stakeholders/s1/stand-down", 403);
    const refused = await openConfirm();
    await refused.getByTestId("project-stakeholder-stand-down-confirm").click();
    await expect(
      page.getByText("You do not have permission to do that."),
    ).toBeVisible();
    await expect(row).not.toContainText("Stood down");

    state.refuse.delete("POST /stakeholders/s1/stand-down");
    const confirm = await openConfirm();
    await confirm.getByTestId("project-stakeholder-stand-down-confirm").click();
    await expect(confirm).toBeHidden();
    await expect(row).toContainText("Stood down");
    await expect(
      row.getByRole("button", { name: "Actions for Mia Manager" }),
    ).toHaveCount(0);
    expect(state.requests.at(-1)).toMatchObject({
      method: "POST",
      path: standDownPath,
    });
    await page.reload();
    await expect(
      page
        .getByTestId("project-stakeholder-row")
        .filter({ hasText: "Mia Manager" }),
    ).toContainText("Stood down");
  });

  test("a viewer gets no write controls on Prerequisites, Team and Documents", async ({
    page,
  }) => {
    await capabilities(page, false);
    await installProjectOverviewFixture(page, PROJECT_ID, { project });
    await page.goto("/agent/projects/WLP/prerequisites");
    await expect(page.getByTestId("project-prerequisite-row")).toContainText(
      "Customer VPN access",
    );
    await expect(
      page.getByRole("button", { name: "Add prerequisite" }),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("project-prerequisites-page").getByRole("checkbox"),
    ).toHaveCount(0);
    await expect(
      page
        .getByTestId("project-prerequisites-page")
        .getByRole("button", { name: /^Actions for / }),
    ).toHaveCount(0);

    await page.goto("/agent/projects/WLP/team");
    await expect(page.getByTestId("project-stakeholder-row")).toContainText(
      "Mia Manager",
    );
    await expect(
      page.getByRole("button", { name: "Add stakeholder" }),
    ).toHaveCount(0);
    await expect(
      page
        .getByTestId("project-team-page")
        .getByRole("button", { name: /^Actions for / }),
    ).toHaveCount(0);

    await page.goto("/agent/projects/WLP/documents");
    await expect(page.getByTestId("project-document-row")).toContainText(
      "Statement of work",
    );
    await expect(
      page.getByRole("button", { name: "Add document link" }),
    ).toHaveCount(0);
    await expect(
      page
        .getByTestId("project-documents-page")
        .getByRole("button", { name: /^Actions for / }),
    ).toHaveCount(0);
  });

  test("without time_entry:read_any the hour bank shows but individual entries do not", async ({
    page,
  }) => {
    await capabilities(page, false);
    await installProjectOverviewFixture(page, PROJECT_ID, {
      project,
      contract: {
        startDate: "2026-01-01",
        endDate: "2099-12-31",
        contractedMinutes: 7200,
        coverage: "9x5",
        kickoffStatus: "completed",
        kickoffDate: "2026-01-05",
      },
      recentEntriesVisible: false,
    });
    await page.goto("/agent/projects/WLP");
    const panel = page.getByTestId("project-contract-panel");
    await expect(panel).toContainText("45 h of 120 h used");
    await expect(panel).not.toContainText("Recent billable time");
    await expect(panel).not.toContainText(
      "No billable time in this period yet.",
    );
  });
});
