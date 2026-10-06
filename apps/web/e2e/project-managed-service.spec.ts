import { expect, test } from "@playwright/test";

const workspaceId = "workspace-project-settings";
const projectId = "project-managed-service";
const calendarId = "calendar-support";

const details = {
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
  createdAt: "2026-10-01T12:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  purgeAfter: null,
  position: 0,
  lastTaskNumber: 0,
};

test("project settings load, save, and display managed-service configuration and RAG health", async ({
  page,
}, testInfo) => {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
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
          createdAt: "2026-10-01T00:00:00.000Z",
        },
        user: {
          id: "settings-user",
          name: "Project Admin",
          email: "admin@example.test",
          role: "admin",
          emailVerified: true,
          createdAt: "2026-10-01T00:00:00.000Z",
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
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ]);
    if (path === `/api/workspace/${workspaceId}/members`)
      return json([
        {
          id: "settings-user",
          name: "Project Admin",
          email: "admin@example.test",
          role: "admin",
        },
      ]);
    if (path === "/api/capabilities")
      return json({
        manageProjects: true,
        createProjects: true,
        updateProjects: true,
        deleteProjects: true,
        updateTasks: true,
        createTasks: true,
        deleteTasks: true,
        assignTasks: true,
        createLabels: true,
        updateLabels: true,
        deleteLabels: true,
        manageWorkspace: true,
        deleteWorkspace: true,
        inviteUsers: true,
        manageTeam: true,
        removeMembers: true,
        manageServiceCalendars: true,
      });
    if (path === "/api/project" && method === "GET")
      return json([
        {
          ...details,
          statistics: { completionPercentage: 0, totalTasks: 0, dueDate: null },
          columns: [],
          archivedTasks: [],
          plannedTasks: [],
        },
      ]);
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
            createdAt: "2026-10-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:00.000Z",
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
    if (path === `/api/project/${projectId}` && method === "PUT")
      return json({ ...details, ...(body as object) });
    if (path === `/api/project/${projectId}/health` && method === "GET")
      return json({ health: details.health });
    if (path === `/api/project/${projectId}/health` && method === "PATCH") {
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

  await page.goto(`/dashboard/settings/projects/${projectId}/general`);
  await expect(
    page.getByRole("heading", { name: "Engagement and service" }),
  ).toBeVisible();
  await expect(page.getByRole("combobox").nth(1)).toContainText("Project");
  await page.screenshot({
    path: testInfo.outputPath("project-general-engagement.png"),
  });

  await page.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: "Managed service" }).click();
  await page.getByRole("combobox").nth(3).click();
  await page.getByRole("option", { name: "L2" }).click();
  await page.getByRole("combobox").nth(4).click();
  await page.getByRole("option", { name: "Support coverage" }).click();
  await page.getByRole("button", { name: "Save engagement settings" }).click();
  await expect(page.getByText("Engagement settings saved.")).toBeVisible();
  expect(
    requests.find(
      (request) =>
        request.method === "PUT" &&
        request.path === `/api/project/${projectId}`,
    )?.body,
  ).toMatchObject({
    kind: "managed_service",
    supportLevel: "L2",
    serviceCalendarId: calendarId,
  });

  await page.getByRole("combobox").nth(2).click();
  await page.getByRole("option", { name: "Amber" }).click();
  await expect
    .poll(() =>
      requests.some(
        (request) =>
          request.method === "PATCH" &&
          request.path.endsWith("/health") &&
          (request.body as { health?: string } | undefined)?.health === "amber",
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("project-general-managed-service.png"),
  });
});
