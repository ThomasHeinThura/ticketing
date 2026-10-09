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

const visualCalendar = {
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
  holidays: [],
  version: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const visualGoals = [
  ...(["first_response", "resolution"] as const).flatMap((metric) =>
    (["low", "medium", "high", "urgent"] as const).map((priority) => ({
      metric,
      workItemTypeId: "visual-type",
      priority,
      targetMinutes: metric === "first_response" ? 120 : 480,
    })),
  ),
];

const visualSlaPolicy = {
  id: "visual-sla-policy",
  workspaceId: workspace.id,
  name: "Priority support",
  description: "Response and resolution targets for support incidents.",
  version: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  activeVersion: {
    id: "visual-sla-version",
    number: 1,
    calendarId: visualCalendar.id,
    atRiskThresholdPct: 80,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    goals: visualGoals,
  },
  draftVersion: null,
};

const visualInstanceUser = {
  id: "visual-instance-user",
  name: "Taylor Staff",
  email: "taylor@example.test",
  emailVerified: true,
  createdAt: "2026-10-01T12:00:00.000Z",
  locale: "en-GB",
  isInstanceAdmin: false,
  isSuspended: false,
  suspensionExpiresAt: null,
  twoFactorEnabled: true,
  person: {
    id: "visual-person",
    side: "staff" as const,
    organisationId: null,
    organisationName: null,
    active: true,
    isPlaceholder: false,
  },
};

const visualPendingAction = {
  id: "visual-pending-deactivation",
  action: "delete",
  origin: "web",
  targetType: "user",
  targetIds: [visualInstanceUser.id],
  summary: {
    personId: visualInstanceUser.person.id,
    userId: visualInstanceUser.id,
    email: visualInstanceUser.email,
  },
  confirmation: "typed_name_step_up",
  state: "pending",
  createdAt: "2026-10-05T10:00:00.000Z",
  expiresAt: "2026-10-05T10:15:00.000Z",
  invalidationReason: null,
};

const visualSavedView = {
  id: "visual-saved-view",
  workspaceId: workspace.id,
  createdBy: "visual-user",
  name: "Escalations",
  scope: "workspace",
  scopeId: workspace.id,
  visibility: "team",
  sharedWithTeamId: "visual-team",
  layout: "list",
  query: {
    entity: "work_item",
    filter: { field: "priority", op: "eq", value: "high" },
    sort: [{ field: "key", direction: "asc" }],
  },
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
  isPinned: true,
};

async function installAuthenticatedFixture(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/api/me/csrf-token")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "set-cookie":
            "tdk_csrf_dev=visual-csrf-token; Path=/; SameSite=Strict; HttpOnly",
        },
        body: JSON.stringify({
          token: "visual-csrf-token",
          expiresAt: "2030-01-01T00:00:00.000Z",
        }),
      });
      return;
    }
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
    else if (path.endsWith("/api/views/visual-saved-view/run")) {
      body = {
        data: [workItem],
        page: { hasMore: false, nextCursor: null },
        meta: { total: 1 },
      };
    } else if (path.endsWith("/api/views/visual-saved-view/count")) {
      body = { count: 1 };
    } else if (path.endsWith("/api/views/visual-saved-view")) {
      body = visualSavedView;
    } else if (path.endsWith("/api/views")) body = [visualSavedView];
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
      body = { createTasks: true };
    } else if (path.endsWith("/api/me/approvals")) {
      body = {
        approvals: [
          {
            id: "visual-approval",
            workItemKey: "OPS-12",
            workItemTitle: "Review firewall change",
            kind: "cab",
            state: "pending",
            requester: { id: "visual-requester", displayName: "Riley" },
            approver: { id: "visual-approver", displayName: "Ada Example" },
            createdAt: "2026-10-01T00:00:00.000Z",
            expiresAt: "2026-10-08T00:00:00.000Z",
            decidedAt: null,
            decisionNote: null,
            approverReachLost: false,
            canWithdraw: false,
          },
        ],
      };
    } else if (path.endsWith("/api/service-calendars")) {
      body = {
        data: [visualCalendar],
        page: { previousCursor: null, nextCursor: null, hasMore: false },
        meta: { total: 1 },
      };
    } else if (path.endsWith("/api/service-calendars/visual-calendar/usage")) {
      body = {
        calendarId: visualCalendar.id,
        counts: {
          projects: 0,
          slaPolicyVersions: 1,
          currentSlaPolicies: 1,
          workItems: 0,
        },
      };
    } else if (
      path.endsWith("/api/service-calendars/visual-calendar/preview")
    ) {
      body = {
        calendarId: visualCalendar.id,
        year: 2026,
        weeklyCoverMinutes: 2400,
        annualCoverMinutes: 104160,
        hasCover: true,
      };
    } else if (path.endsWith("/api/service-calendars/visual-calendar")) {
      body = visualCalendar;
    } else if (path.endsWith("/api/sla-policies/visual-sla-policy")) {
      body = visualSlaPolicy;
    } else if (path.endsWith("/api/sla-policies")) {
      body = {
        data: [
          {
            id: visualSlaPolicy.id,
            workspaceId: workspace.id,
            name: visualSlaPolicy.name,
            description: visualSlaPolicy.description,
            version: visualSlaPolicy.version,
            createdAt: visualSlaPolicy.createdAt,
            updatedAt: visualSlaPolicy.updatedAt,
            activeVersion: {
              id: visualSlaPolicy.activeVersion.id,
              number: visualSlaPolicy.activeVersion.number,
              calendarId: visualCalendar.id,
              atRiskThresholdPct: 80,
              effectiveFrom: visualSlaPolicy.activeVersion.effectiveFrom,
              goalCount: visualGoals.length,
            },
            hasDraft: false,
          },
        ],
        page: { previousCursor: null, nextCursor: null, hasMore: false },
        meta: { total: 1 },
      };
    } else if (
      path.endsWith("/api/workspace/visual-workspace/work-item-types")
    ) {
      body = [
        {
          id: "visual-type",
          key: "incident",
          name: "Incident",
          category: "service",
        },
      ];
    } else if (path.endsWith("/api/projects/visual-project/work-items")) {
      body = {
        data: [workItem],
        page: { hasMore: false, nextCursor: null },
        meta: {},
      };
    } else if (path.endsWith("/api/work-items/HELP-7/approvals")) {
      body = { approvals: [] };
    } else if (path.endsWith("/api/work-items/HELP-7/activity")) {
      body = { data: [], page: { nextCursor: null, hasMore: false } };
    } else if (path.endsWith("/api/work-items/HELP-7")) body = workItem;
    else if (path.endsWith("/api/me/security/factors")) {
      body = { enabled: false, required: false, policyMode: "optional" };
    } else if (path.endsWith("/api/instance/users")) {
      body = {
        data: [visualInstanceUser],
        page: { nextCursor: null, hasMore: false },
      };
    } else if (path.endsWith(`/api/instance/users/${visualInstanceUser.id}`)) {
      body = visualInstanceUser;
    } else if (path.endsWith("/api/me/pending-actions")) {
      body = {
        data: [visualPendingAction],
        page: { nextCursor: null, hasMore: false },
      };
    } else if (
      path.endsWith(`/api/me/pending-actions/${visualPendingAction.id}`)
    ) {
      body = visualPendingAction;
    } else if (path.endsWith("/api/instance/observability")) {
      body = {
        version: 1,
        logLevels: {
          default: "info",
          modules: {
            http: "info",
            auth: "warn",
            database: "error",
            jobs: "info",
            audit: "info",
            plugins: "info",
            realtime: "info",
          },
        },
        metricsTokenConfigured: false,
        metricsTokenRotatedAt: null,
      };
    } else if (path.endsWith("/api/instance/local-factor-policy")) {
      body = { policy: { mode: "optional", requiredRoleId: null } };
    }

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

test("portal disabled notice @visual", async ({ page }) => {
  await page.goto("http://127.0.0.1:4179/");
  await expect(
    page.getByText("Customer portal unavailable", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("portal-disabled.png", {
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
  await expect(page.getByTestId("realtime-unavailable")).toBeVisible();
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

test("my approvals inbox screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/my-work");
  await expect(
    page.getByRole("heading", { name: "Waiting on my approval" }),
  ).toBeVisible();
  await expect(page.getByText("Review firewall change")).toBeVisible();
  await expect(
    page.getByText("OPS-12 · Requested by Riley", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
  await expect(page).toHaveScreenshot("my-work-approvals.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("Saved views index screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/views");
  await expect(
    page.getByRole("heading", { name: "Saved views", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Escalations", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Pinned · 1 matching work items", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Request deletion" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("saved-views-index.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("Saved view detail screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/views/visual-saved-view");
  await expect(
    page.getByRole("heading", { name: "Escalations", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Customer cannot reset their password", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Unpin" })).toBeVisible();
  await expect(page).toHaveScreenshot("saved-view-detail.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("account security enrollment-ready screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/dashboard/settings/account/security");
  await expect(
    page.getByText("Set up an authenticator factor", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#factor-password")).toBeVisible();
  await page.locator("#factor-password").fill("visual-enrollment-password");
  await expect(
    page.getByRole("button", { name: "Set up authenticator" }),
  ).toBeEnabled();
  await expect(page).toHaveScreenshot("account-security-setup.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("two-factor authenticator challenge screen @visual", async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: path.endsWith("/api/auth/get-session")
        ? "null"
        : JSON.stringify({ disableRegistration: true, hasSmtp: false }),
    });
  });
  await page.goto("/auth/two-factor");
  await expect(page.getByLabel("Authenticator code")).toBeVisible();
  await expect(page).toHaveScreenshot("two-factor-authenticator.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("observability settings screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/god-mode/observability");
  await expect(
    page.getByRole("heading", { name: "Observability", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Local factor policy", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Structured log levels", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No token is configured.")).toBeVisible();
  await expect(page).toHaveScreenshot("observability-settings.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("God Mode users directory screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/god-mode/users");
  await expect(
    page.getByRole("heading", { name: "Instance users", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("taylor@example.test", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("instance-users-directory.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("profile pending actions screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/settings/profile/pending-actions");
  await expect(
    page.getByRole("heading", { name: "My pending actions", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Deactivate person · taylor@example.test"),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("profile-pending-actions.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("profile pending action detail screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto(
    "/agent/settings/profile/pending-actions/visual-pending-deactivation",
  );
  await expect(
    page.getByRole("heading", { name: "Approve person deactivation" }),
  ).toBeVisible();
  await expect(page.getByLabel("Type the exact current email")).toBeVisible();
  await expect(page).toHaveScreenshot("profile-pending-action-detail.png", {
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
  await expect(
    page.getByText(
      "0 projects; 1 current policies across 1 versions; 0 work items.",
    ),
  ).toBeVisible();
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

test("SLA policy list screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/settings/sla-policies");
  await expect(
    page.getByRole("heading", { name: "SLA policies" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Priority support" }),
  ).toBeVisible();
  await expect(page.getByText("Active version 1")).toBeVisible();
  await expect(page).toHaveScreenshot("sla-policy-list.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("SLA policy editor screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/settings/sla-policies/visual-sla-policy");
  await expect(
    page.getByRole("heading", { name: "Priority support" }),
  ).toBeVisible();
  await expect(page.getByText("Active version 1")).toBeVisible();
  await expect(page.getByText("First response", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("sla-policy-editor.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});
