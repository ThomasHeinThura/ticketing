import { expect, type Page, type Route, test } from "@playwright/test";

// Issue #716 (PR-9): the engagement controls on project settings General. The API is
// mocked at the network edge, with a stateful project so persistence is observable.

const workspaceId = "workspace-project-settings";
const projectId = "project-managed-service";
const calendarId = "calendar-support";
const now = "2026-10-01T00:00:00.000Z";

type Details = {
  id: string;
  workspaceId: string;
  slug: string;
  icon: string;
  name: string;
  description: string;
  kind: string;
  health: string | null;
  supportLevel: string | null;
  serviceCalendarId: string | null;
  organisationId: string | null;
  defaultCommentVisibility: string;
  createdAt: string;
  archivedAt: null;
  deletedAt: null;
  purgeAfter: null;
  position: number;
  lastTaskNumber: number;
};

type Recorded = { method: string; path: string; body?: unknown };

type Options = {
  canUpdate?: boolean;
  /** Strict project:manage_settings; defaults to canUpdate. */
  canManage?: boolean;
  healthStatus?: number;
  putStatus?: number;
  putMessage?: string;
  seed?: Partial<Details>;
};

const baseDetails = (): Details => ({
  id: projectId,
  workspaceId,
  slug: "SUPPORT",
  icon: "Folder",
  name: "Support engagement",
  description: "Customer support",
  kind: "project",
  health: null,
  supportLevel: null,
  serviceCalendarId: null,
  organisationId: "org-bound-at-creation",
  defaultCommentVisibility: "internal",
  createdAt: now,
  archivedAt: null,
  deletedAt: null,
  purgeAfter: null,
  position: 0,
  lastTaskNumber: 0,
});

const capabilities = (canUpdate: boolean, canManage: boolean) => ({
  manageProjectSettings: canManage,
  manageProjects: canUpdate,
  createProjects: canUpdate,
  updateProjects: canUpdate,
  deleteProjects: false,
  updateTasks: true,
  createTasks: true,
  deleteTasks: true,
  assignTasks: true,
  createLabels: true,
  updateLabels: true,
  deleteLabels: true,
  manageWorkspace: false,
  deleteWorkspace: false,
  inviteUsers: false,
  manageTeam: false,
  removeMembers: false,
  manageServiceCalendars: false,
});

async function mockApi(page: Page, options: Options = {}) {
  const canUpdate = options.canUpdate ?? true;
  const canManage = options.canManage ?? canUpdate;
  const details = { ...baseDetails(), ...options.seed };
  const requests: Recorded[] = [];

  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const body =
      method === "PUT" || method === "PATCH"
        ? request.postDataJSON()
        : undefined;
    requests.push({ method, path, body });
    const json = (value: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(value),
      });

    if (path === "/api/auth/get-session")
      return json({
        session: {
          id: "settings-session",
          userId: "settings-user",
          activeOrganizationId: workspaceId,
          expiresAt: "2027-01-01T00:00:00.000Z",
          createdAt: now,
        },
        user: {
          id: "settings-user",
          name: "Project Admin",
          email: "admin@example.test",
          emailVerified: true,
          createdAt: now,
        },
      });
    if (path === "/api/config")
      return json({
        disableRegistration: false,
        disablePasswordRegistration: false,
        disableEmailOtpSignIn: true,
        disableWorkspaceCreation: false,
        hasSmtp: true,
        hasGithubSignIn: false,
        hasGoogleSignIn: false,
        hasDiscordSignIn: false,
        hasCustomOAuth: false,
        disableLoginForm: false,
        customOAuthAutoLogin: false,
        customOAuthLogoutUrl: null,
      });
    if (path === "/api/workspace")
      return json([
        {
          id: workspaceId,
          name: "Support",
          slug: "support",
          logo: null,
          description: null,
          createdAt: now,
          role: canUpdate ? "admin" : "member",
        },
      ]);
    if (path === `/api/workspace/${workspaceId}`)
      return json({
        id: workspaceId,
        name: "Support",
        slug: "support",
        logo: null,
        description: null,
        createdAt: now,
        members: [
          {
            id: "settings-user",
            role: canUpdate ? "admin" : "member",
          },
        ],
      });
    if (path === `/api/workspace/${workspaceId}/members`)
      return json([
        {
          id: "settings-user",
          name: "Project Admin",
          email: "admin@example.test",
          role: canUpdate ? "admin" : "member",
        },
      ]);
    if (path === "/api/capabilities")
      return json(capabilities(canUpdate, canManage));
    if (path === "/api/service-calendars")
      return json({
        data: [
          {
            id: calendarId,
            workspaceId,
            name: "Support coverage",
            timezone: "UTC",
            windows: {},
            holidays: [],
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
        ],
        page: { previousCursor: null, nextCursor: null, hasMore: false },
        meta: { total: 1 },
      });
    if (path === `/api/task/tasks/${projectId}`)
      return json({
        data: { ...details, columns: [], archivedTasks: [], plannedTasks: [] },
        pagination: { total: 0, page: 1, pageSize: 100, totalPages: 1 },
      });
    if (path === `/api/project/${projectId}` && method === "GET")
      return json(details);
    if (path === `/api/project/${projectId}` && method === "PUT") {
      if (options.putStatus && options.putStatus >= 400)
        return route.fulfill({
          status: options.putStatus,
          contentType: "text/plain",
          body: options.putMessage ?? "error",
        });
      Object.assign(details, body as object);
      return json(details);
    }
    if (path === `/api/project/${projectId}/health` && method === "PATCH") {
      if (options.healthStatus && options.healthStatus >= 400)
        return route.fulfill({
          status: options.healthStatus,
          contentType: "text/plain",
          body: "Insufficient permissions",
        });
      details.health = (body as { health: string | null }).health;
      return json({ health: details.health });
    }
    if (path === "/api/notification") return json([]);
    if (path === "/api/me/csrf-token")
      return json({
        token: "settings-csrf",
        expiresAt: "2027-01-01T00:00:00.000Z",
      });
    return json({}, 404);
  });

  return { requests, details };
}

const open = async (page: Page) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/dashboard/settings/projects/${projectId}/general`);
  await expect(
    page.getByRole("heading", { name: "Engagement and service" }),
  ).toBeVisible();
};

const kind = (page: Page) =>
  page.getByRole("combobox", { name: "Project kind" });
const supportLevel = (page: Page) =>
  page.getByRole("combobox", { name: "Support level" });
const calendar = (page: Page) =>
  page.getByRole("combobox", { name: "Service calendar" });
const health = (page: Page) =>
  page.getByRole("combobox", { name: "Health", exact: true });
const saveButton = (page: Page) =>
  page.getByRole("button", { name: "Save engagement settings" });

async function choose(
  page: Page,
  trigger: ReturnType<typeof kind>,
  option: string,
) {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test.describe("project engagement controls (PR-9)", () => {
  test("shows the saved values and persists each field across a reload", async ({
    page,
  }) => {
    const { requests } = await mockApi(page);
    await open(page);
    await expect(kind(page)).toContainText("Project");
    await expect(health(page)).toContainText("Not set");
    await expect(saveButton(page)).toBeDisabled();

    // Complete managed-service configuration saves with all three fields.
    await choose(page, kind(page), "Managed service");
    await choose(page, supportLevel(page), "L2");
    await choose(page, calendar(page), "Support coverage");
    await saveButton(page).click();
    await expect(page.getByText("Engagement settings saved.")).toBeVisible();
    const put = requests.find(
      (r) => r.method === "PUT" && r.path === `/api/project/${projectId}`,
    );
    expect(put?.body).toMatchObject({
      name: "Support engagement",
      slug: "SUPPORT",
      kind: "managed_service",
      supportLevel: "L2",
      serviceCalendarId: calendarId,
    });
    // The customer organisation binding is never part of the update.
    expect(put?.body).not.toHaveProperty("organisationId");

    // Health goes through its own route.
    await choose(page, health(page), "Amber");
    await expect
      .poll(() =>
        requests.some(
          (r) =>
            r.method === "PATCH" &&
            r.path === `/api/project/${projectId}/health` &&
            (r.body as { health?: string } | undefined)?.health === "amber",
        ),
      )
      .toBe(true);

    // Reload: every field comes back from the (mock) server.
    await page.reload();
    await expect(kind(page)).toContainText("Managed service");
    await expect(supportLevel(page)).toContainText("L2");
    await expect(calendar(page)).toContainText("Support coverage");
    await expect(health(page)).toContainText("Amber");
  });

  test("clears health and support level with explicit nulls", async ({
    page,
  }) => {
    const { requests } = await mockApi(page, {
      seed: {
        kind: "managed_service",
        supportLevel: "L1",
        serviceCalendarId: calendarId,
        health: "green",
      },
    });
    await open(page);
    await expect(health(page)).toContainText("Green");

    await choose(page, health(page), "Not set");
    await expect
      .poll(() =>
        requests.some(
          (r) =>
            r.method === "PATCH" &&
            (r.body as { health?: unknown } | undefined)?.health === null,
        ),
      )
      .toBe(true);

    await choose(page, kind(page), "Project");
    await choose(page, supportLevel(page), "None");
    await saveButton(page).click();
    await expect(page.getByText("Engagement settings saved.")).toBeVisible();
    expect(requests.find((r) => r.method === "PUT")?.body).toMatchObject({
      kind: "project",
      supportLevel: null,
    });
  });

  test("PR-9: a managed service without support level and calendar is refused client-side", async ({
    page,
  }) => {
    const { requests } = await mockApi(page);
    await open(page);

    await choose(page, kind(page), "Managed service");
    await saveButton(page).click();
    await expect(
      page.getByText("A managed service needs a support level."),
    ).toBeVisible();
    await expect(
      page.getByText("A managed service needs a service calendar."),
    ).toBeVisible();
    expect(requests.some((r) => r.method === "PUT")).toBe(false);

    // Fixing one field leaves only the other named.
    await choose(page, supportLevel(page), "L3");
    await saveButton(page).click();
    await expect(
      page.getByText("A managed service needs a support level."),
    ).toHaveCount(0);
    await expect(
      page.getByText("A managed service needs a service calendar."),
    ).toBeVisible();
    expect(requests.some((r) => r.method === "PUT")).toBe(false);
  });

  test("PR-9: a server 422 is shown as a translated message", async ({
    page,
  }) => {
    await mockApi(page, {
      putStatus: 422,
      putMessage:
        "PR-9: managed services require a support level and service calendar",
    });
    await open(page);
    await choose(page, kind(page), "Managed service");
    await choose(page, supportLevel(page), "L1");
    await choose(page, calendar(page), "Support coverage");
    await saveButton(page).click();
    await expect(
      page.getByText(
        "A managed service needs both a support level and a service calendar.",
      ),
    ).toBeVisible();
  });

  test("without project:update the controls are read-only and nothing is sent", async ({
    page,
  }) => {
    const { requests } = await mockApi(page, {
      canUpdate: false,
      seed: {
        kind: "managed_service",
        supportLevel: "L2",
        serviceCalendarId: calendarId,
        health: "red",
      },
    });
    await open(page);
    await expect(page.getByTestId("project-engagement-readonly")).toBeVisible();
    await expect(kind(page)).toBeDisabled();
    await expect(supportLevel(page)).toBeDisabled();
    await expect(calendar(page)).toBeDisabled();
    await expect(health(page)).toBeDisabled();
    await expect(saveButton(page)).toHaveCount(0);
    await expect(health(page)).toContainText("Red");
    expect(
      requests.some((r) => r.method === "PUT" || r.method === "PATCH"),
    ).toBe(false);
  });

  test("with project:update but not manage_settings: engagement is read-only with a notice, health still saves", async ({
    page,
  }) => {
    const { requests } = await mockApi(page, {
      canUpdate: true,
      canManage: false,
      seed: {
        kind: "managed_service",
        supportLevel: "L2",
        serviceCalendarId: calendarId,
      },
    });
    await open(page);
    await expect(
      page.getByTestId("project-engagement-settings-readonly"),
    ).toBeVisible();
    await expect(page.getByTestId("project-engagement-readonly")).toHaveCount(
      0,
    );
    await expect(kind(page)).toBeDisabled();
    await expect(supportLevel(page)).toBeDisabled();
    await expect(calendar(page)).toBeDisabled();
    await expect(saveButton(page)).toHaveCount(0);
    await expect(health(page)).toBeEnabled();
    await choose(page, health(page), "Green");
    await expect
      .poll(() => requests.find((r) => r.method === "PATCH")?.body)
      .toEqual({ health: "green" });
    expect(requests.some((r) => r.method === "PUT")).toBe(false);
  });

  test("a server 403 on the engagement save reverts the edit and refreshes capabilities", async ({
    page,
  }) => {
    const { requests } = await mockApi(page, {
      putStatus: 403,
      putMessage: "Insufficient permissions",
    });
    await open(page);
    await choose(page, supportLevel(page), "L2");
    await saveButton(page).click();
    await expect(
      page.getByText("You do not have permission to change this."),
    ).toBeVisible();
    await expect(supportLevel(page)).toContainText("None");
    await expect(saveButton(page)).toBeDisabled();
    expect(
      requests.filter((r) => r.path === "/api/capabilities").length,
    ).toBeGreaterThan(1);
  });

  test("a server 403 on health is handled: message shown and the value reverts", async ({
    page,
  }) => {
    await mockApi(page, { healthStatus: 403 });
    await open(page);
    await choose(page, health(page), "Red");
    await expect(
      page.getByTestId("project-engagement-health-error"),
    ).toContainText("You do not have permission to change this.");
    await expect(health(page)).toContainText("Not set");
  });

  test("keyboard: the controls are reachable by Tab in order", async ({
    page,
  }) => {
    await mockApi(page);
    await open(page);
    await kind(page).focus();
    await expect(kind(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(health(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(supportLevel(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(calendar(page)).toBeFocused();
  });
});
