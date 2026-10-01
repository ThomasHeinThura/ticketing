import { expect, type Page, test } from "@playwright/test";

const session = {
  session: {
    id: "visual-session",
    userId: "visual-user",
    activeOrganizationId: "visual-workspace",
    expiresAt: "2030-01-01T00:00:00.000Z",
    token: "visual-token",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  user: {
    id: "visual-user",
    name: "Ada Example",
    email: "ada@example.test",
    emailVerified: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    image: null,
  },
};

const workspace = {
  id: "visual-workspace",
  name: "Northstar Support",
  slug: "northstar-support",
  logo: null,
  description: "Visual regression fixture",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const project = {
  id: "visual-project",
  workspaceId: workspace.id,
  slug: "help",
  icon: null,
  name: "Help Desk",
  description: "Customer support work",
  createdAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  purgeAfter: null,
  position: 0,
  lastTaskNumber: 7,
  statistics: { completionPercentage: 25, totalTasks: 4, dueDate: null },
  archivedTasks: [],
  plannedTasks: [],
  columns: [],
};

const workItem = {
  id: "visual-item",
  projectId: project.id,
  workspaceId: workspace.id,
  typeId: "visual-type",
  number: 7,
  key: "HELP-7",
  title: "Customer cannot reset their password",
  description: "We sent a reset link, but it has expired.",
  stateId: "visual-state",
  stateName: "In progress",
  stateCategory: "started",
  priority: "high",
  assigneeId: null,
  assigneeName: null,
  requesterId: "visual-requester",
  parentId: null,
  position: "1.0000000000",
  customerVisibility: "private",
  startDate: "2026-09-01T00:00:00.000Z",
  dueDate: "2026-10-02T00:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  version: 1,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-15T00:00:00.000Z",
};

const serviceCalendar = {
  id: "visual-calendar",
  workspaceId: workspace.id,
  name: "Support coverage",
  timezone: "Europe/London",
  windows: {
    mon: [{ from: 540, to: 1020 }],
    tue: [{ from: 540, to: 1020 }],
    wed: [{ from: 540, to: 1020 }],
    thu: [{ from: 540, to: 1020 }],
    fri: [{ from: 540, to: 1020 }],
    sat: [],
    sun: [],
  },
  holidays: [{ date: "2026-12-25", name: "Winter closure" }],
};

async function installAuthenticatedFixture(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    // Authenticated shells mount several optional picker queries globally (labels,
    // work item types, members). Empty collections are their deterministic baseline.
    let body: unknown = [];

    if (path.endsWith("/api/auth/get-session")) body = session;
    else if (path.endsWith("/api/config")) {
      body = {
        disableRegistration: true,
        disablePasswordRegistration: false,
        disableEmailOtpSignIn: true,
        disableWorkspaceCreation: true,
        hasSmtp: false,
        hasGithubSignIn: false,
        hasGoogleSignIn: false,
        hasDiscordSignIn: false,
        hasCustomOAuth: false,
        disableLoginForm: false,
        customOAuthAutoLogin: false,
        customOAuthLogoutUrl: null,
      };
    } else if (path.endsWith("/api/workspace")) body = [workspace];
    else if (path.endsWith("/api/project")) body = [project];
    else if (path.endsWith("/api/workspace/visual-workspace/members")) {
      body = [
        {
          id: "visual-user",
          name: "Ada Example",
          email: "ada@example.test",
          image: null,
          role: "owner",
        },
      ];
    } else if (path.endsWith("/api/capabilities")) {
      body = { createTasks: true, manageServiceCalendars: true };
    } else if (
      path.endsWith("/api/service-calendars/visual-calendar/preview")
    ) {
      body = {
        calendarId: serviceCalendar.id,
        year: 2026,
        weeklyCoverMinutes: 2400,
        annualCoverMinutes: 104160,
        hasCover: true,
      };
    } else if (path.endsWith("/api/service-calendars/visual-calendar")) {
      body = serviceCalendar;
    } else if (path.endsWith("/api/service-calendars")) {
      body = [serviceCalendar];
    } else if (path.endsWith("/api/projects/visual-project/work-items")) {
      body = {
        data: [workItem],
        page: { hasMore: false, nextCursor: null },
        meta: {},
      };
    } else if (path.endsWith("/api/work-items/HELP-7")) body = workItem;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

test("sign-in screen @visual", async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: path.endsWith("/api/auth/get-session")
        ? "null"
        : JSON.stringify({
            disableRegistration: true,
            disablePasswordRegistration: false,
            disableEmailOtpSignIn: true,
            disableWorkspaceCreation: true,
            hasSmtp: false,
            hasGithubSignIn: false,
            hasGoogleSignIn: false,
            hasDiscordSignIn: false,
            hasCustomOAuth: false,
            disableLoginForm: false,
            customOAuthAutoLogin: false,
            customOAuthLogoutUrl: null,
          }),
    });
  });

  await page.goto("/auth/sign-in");
  await expect(page.getByText("Welcome back", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("sign-in.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("work-item list screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/projects/help/work?layout=list");
  await expect(
    page.getByText("Customer cannot reset their password"),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("work-item-list.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("work-item detail screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/work-items/HELP-7");
  await expect(
    page.getByText("Customer cannot reset their password", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("work-item-detail.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("service calendar list screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/settings/calendars");
  await expect(
    page.getByRole("heading", { name: "Service calendars" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Support coverage" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("service-calendar-list.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("service calendar editor screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/settings/calendars/visual-calendar");
  await expect(
    page.getByRole("heading", { name: "Support coverage" }),
  ).toBeVisible();
  await expect(page.getByText("40 hours of cover per week")).toBeVisible();
  await expect(page).toHaveScreenshot("service-calendar-editor.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});
