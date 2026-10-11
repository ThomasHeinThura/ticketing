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

const visualRequestType = {
  id: "visual-request-type",
  key: "visual-access",
  name: "Visual access request",
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
      body = {
        defaultCustomerVisibility: "organisation",
        requestTypes: [
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
      body = { createTasks: true };
    } else if (path.endsWith("/api/projects/visual-project/work-items")) {
      body = {
        data: [workItem],
        page: { hasMore: false, nextCursor: null },
        meta: {},
      };
    } else if (path.endsWith("/api/work-items/HELP-7")) body = workItem;
    else if (path.endsWith("/api/me/security/factors")) {
      body = { enabled: false, required: false, policyMode: "optional" };
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
  await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
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
