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
    role: "admin",
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

const visualIdentityConnection = {
  id: "visual-connection",
  providerType: "entra",
  portalScope: "agent",
  organisationId: null,
  defaultWorkspaceId: "visual-workspace",
  displayName: "Staff Entra",
  issuer: "https://login.example.test/tenant/v2.0",
  tenantId: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222",
  clientSecretConfigured: true,
  redirectUri: "https://desk.example.test/api/auth/callback/visual-connection",
  scopes: ["openid", "profile", "email"],
  claimMapping: { version: 1, displayName: "name" },
  claimMappingState: "valid",
  domainBindings: ["example.test"],
  jitPolicy: {
    enabled: false,
    default_role_id: null,
    required_entra_app_role: "TaskDesk.User",
  },
  maxRoleRank: 10,
  mfaUpstreamMode: "off",
  enabled: false,
  configVersion: 7,
  healthState: "healthy",
  healthCheckedAt: null,
};

const visualRequestType = {
  id: "visual-request-type",
  key: "visual-access",
  name: "Access request",
  description: "Request access to a support workspace.",
  group: "Access",
  workItemTypeId: "visual-work-item-type",
  defaultProjectId: "visual-project",
  formSchema: {
    fields: [
      {
        key: "title",
        label: "Summary",
        type: "text",
        required: true,
        mapsTo: { field: "title" },
      },
    ],
  },
  published: true,
  version: 3,
  autoAccept: false,
  customerVisible: true,
  forcePrivate: false,
  position: 0,
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

async function installAuthenticatedFixture(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    // Authenticated shells mount several optional picker queries globally (labels,
    // work item types, members). Empty collections are their deterministic baseline.
    let body: unknown = [];

    if (path.endsWith("/api/auth/get-session")) body = session;
    else if (path.endsWith("/api/submissions/SUB-7")) {
      body = {
        submission: {
          state: "new",
          formData: { title: "Request access to the support workspace" },
          requesterId: "visual-requester",
          organisationId: "visual-workspace",
          workItemId: null,
        },
        requestType: { name: "Access request" },
        version: {
          defaultProjectId: project.id,
          workItemTypeId: "visual-work-item-type",
          formSchema: { fields: visualRequestType.formSchema.fields },
        },
        messages: [],
      };
    } else if (path.endsWith("/api/submissions")) {
      body = {
        submissions: [
          {
            ref: "SUB-7",
            summary: "Request access to the support workspace",
            submission: { state: "new", createdAt: "2026-09-15T00:00:00.000Z" },
            requestType: { name: "Access request" },
            requester: { displayName: "Ada Example" },
            organisation: { name: "Northstar Support" },
          },
        ],
        page: { hasMore: false, nextCursor: null },
      };
    } else if (path.endsWith("/api/request-types/visual-request-type")) {
      body = visualRequestType;
    } else if (path.endsWith("/api/request-types")) {
      body = { requestTypes: [visualRequestType] };
    } else if (path.endsWith("/api/portal/catalogue/access")) {
      body = {
        key: "access",
        name: "Access request",
        description: "Request access to a support workspace.",
        formSchema: {
          fields: [
            { key: "title", label: "Summary", type: "text", required: true },
          ],
        },
        version: 3,
      };
    } else if (path.endsWith("/api/portal/catalogue")) {
      const hasNoCatalogueMatches = url.search === "?q=no-match";
      body = {
        defaultCustomerVisibility: "organisation",
        requestTypes: hasNoCatalogueMatches
          ? []
          : [
              {
                key: "access",
                name: "Access request",
                description: "Request access to a support workspace.",
                icon: null,
                group: "Access",
                position: 0,
                forcePrivate: false,
                formSchema: {
                  fields: [
                    {
                      key: "title",
                      label: "Summary",
                      type: "text",
                      required: true,
                    },
                  ],
                },
                version: 3,
              },
            ],
      };
    } else if (path.endsWith("/api/portal/submissions/SUB-7")) {
      body = {
        submission: {
          state: "new",
          formData: { title: "Request access to the support workspace" },
          workItemId: null,
        },
        canWithdraw: true,
        workItem: null,
        requestType: { name: "Access request" },
        version: {
          formSchema: {
            fields: [
              { key: "title", label: "Summary", type: "text" },
              { key: "evidence", label: "Evidence", type: "file" },
            ],
          },
        },
        messages: [],
      };
    } else if (path.endsWith("/api/portal/submissions/SUB-7/attachments")) {
      body = [];
    } else if (path.endsWith("/api/submissions/SUB-7/attachments")) {
      body = [];
    } else if (path.endsWith("/api/submissions/SUB-7/duplicates")) {
      body = { suggestions: [] };
    } else if (path.endsWith("/api/config")) {
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
    } else if (path.endsWith("/api/service-calendars")) {
      body = {
        data: [visualCalendar],
        page: { previousCursor: null, nextCursor: null, hasMore: false },
        meta: { total: 1 },
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
    } else if (path.endsWith("/api/work-items/HELP-7/activity")) {
      // The native activity timeline reads a paged envelope; the generic `[]`
      // default has no `data` array and crashes the detail route.
      body = { data: [], page: { nextCursor: null, hasMore: false } };
    } else if (path.endsWith("/api/work-items/HELP-7")) body = workItem;
    else if (path.endsWith("/api/me/security/factors")) {
      body = { enabled: false, required: false, policyMode: "optional" };
    } else if (path.endsWith("/api/me/pending-actions")) {
      body = {
        data: [
          {
            id: "visual-pending-action",
            action: "delete",
            origin: "api",
            targetType: "user",
            targetIds: ["visual-target-user"],
            summary: { email: "casey.staff@example.test" },
            confirmation: "typed_name_step_up",
            approvalSupported: true,
            state: "pending",
            createdAt: "2026-10-01T12:00:00.000Z",
            expiresAt: "2026-10-01T12:15:00.000Z",
          },
        ],
        page: { nextCursor: null, hasMore: false },
        meta: { total: 1 },
      };
    } else if (path.endsWith("/api/me/pending-actions/visual-pending-action")) {
      body = {
        id: "visual-pending-action",
        action: "delete",
        origin: "api",
        targetType: "user",
        targetIds: ["visual-target-user"],
        summary: { email: "casey.staff@example.test" },
        confirmation: "typed_name_step_up",
        approvalSupported: true,
        state: "pending",
        createdAt: "2026-10-01T12:00:00.000Z",
        expiresAt: "2026-10-01T12:15:00.000Z",
        invalidationReason: null,
      };
    } else if (path.endsWith("/api/instance/users/visual-target-user")) {
      body = {
        id: "visual-target-user",
        name: "Casey Staff",
        email: "casey.staff@example.test",
        emailVerified: true,
        createdAt: "2026-09-01T12:00:00.000Z",
        locale: "en-GB",
        isInstanceAdmin: false,
        isSuspended: false,
        suspensionExpiresAt: null,
        twoFactorEnabled: false,
        person: {
          id: "visual-target-person",
          side: "staff",
          organisationId: null,
          organisationName: null,
          active: true,
          isPlaceholder: false,
        },
      };
    } else if (path === "/api/instance/identity-connections") {
      body = { data: [visualIdentityConnection] };
    } else if (
      path === "/api/instance/identity-connections/visual-connection/scim"
    ) {
      body = { data: {}, configVersion: 7 };
    } else if (path === "/api/instance/users") {
      body = {
        data: [
          {
            id: "visual-directory-user",
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
              id: "visual-directory-person",
              side: "staff",
              organisationId: null,
              organisationName: null,
              active: true,
              isPlaceholder: false,
            },
          },
        ],
        page: { nextCursor: null, hasMore: false },
      };
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

test("intake triage queue @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/triage?state=new&ref=SUB-7");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("SUB-7", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Submission SUB-7" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("intake-queue.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("request type catalogue editor @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto(
    "/agent/settings/request-types?requestTypeId=visual-request-type",
  );
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Edit Access request", level: 2 }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New request type" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("request-types.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("portal catalogue selected form @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("http://127.0.0.1:4179/catalogue?q=no-match&key=access");
  await expect(
    page.getByRole("heading", { name: "Access request", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Summary" })).toBeVisible();
  await expect(page).toHaveScreenshot("portal-catalogue-selected-form.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("portal submission detail @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("http://127.0.0.1:4179/submissions/SUB-7");
  await expect(
    page.getByRole("heading", { name: "Request SUB-7", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your answers" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("portal-submission-detail.png", {
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

test("portal sign-in email stage @visual", async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: path.endsWith("/api/auth/get-session") ? "null" : "{}",
    });
  });
  await page.goto("http://127.0.0.1:4179/sign-in");
  await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page).toHaveScreenshot("portal-sign-in-email.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("instance users directory screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/god-mode/users");
  await expect(
    page.getByRole("heading", { name: "Instance users", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Taylor Staff", { exact: true })).toBeVisible();
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

test("authentication providers list screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/god-mode/authentication");
  await expect(
    page.getByRole("heading", {
      name: "Authentication providers",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Staff Entra", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("authentication-providers-list.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("authentication provider editor screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/god-mode/authentication/visual-connection");
  await expect(
    page.getByRole("heading", {
      name: "Connection configuration",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Connection name")).toBeVisible();
  await expect(page).toHaveScreenshot("authentication-provider-editor.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("pending actions list screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto("/agent/settings/profile/pending-actions");
  await expect(
    page.getByRole("heading", { name: "My pending actions", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Deactivate person · casey.staff@example.test", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("pending-actions-list.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    maxDiffPixels: 0,
    threshold: 0,
    includeAA: true,
  });
});

test("pending action detail screen @visual", async ({ page }) => {
  await installAuthenticatedFixture(page);
  await page.goto(
    "/agent/settings/profile/pending-actions/visual-pending-action",
  );
  await expect(
    page.getByRole("heading", {
      name: "Approve person deactivation",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Type the exact current email")).toBeVisible();
  await expect(page.getByLabel("Account password")).toBeVisible();
  await expect(page).toHaveScreenshot("pending-action-detail.png", {
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
