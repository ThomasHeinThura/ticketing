import { expect, test } from "@playwright/test";

test("staff can create, list, edit, assign, and read work-item activity", async ({
  page,
}) => {
  const workspaceId = "ws-e2e";
  const projectId = "project-e2e";
  const typeId = "type-e2e";
  const assigneeId = "person-e2e";
  let item = {
    id: "item-e2e",
    projectId,
    workspaceId,
    typeId,
    number: 1,
    key: "WLP-1",
    title: "First report",
    description: "Initial notes",
    stateId: "state-e2e",
    stateName: "Backlog",
    stateCategory: "backlog",
    priority: null,
    assigneeId: null as string | null,
    assigneeName: null as string | null,
    requesterId: null,
    parentId: null,
    position: "1.0000000000",
    customerVisibility: "private",
    startDate: null,
    dueDate: null,
    archivedAt: null,
    deletedAt: null,
    version: 1,
    createdAt: "2026-09-29T09:00:00.000Z",
    updatedAt: "2026-09-29T09:00:00.000Z",
  };
  let created = false;
  let assigned = false;
  const activity: Array<Record<string, unknown>> = [];
  const routeCalls: string[] = [];
  const session = {
    session: {
      id: "session-e2e",
      userId: "user-e2e",
      token: "e2e",
      expiresAt: "2026-10-01T00:00:00.000Z",
      createdAt: "2026-09-29T00:00:00.000Z",
      updatedAt: "2026-09-29T00:00:00.000Z",
      activeOrganizationId: workspaceId,
    },
    user: {
      id: "user-e2e",
      name: "Agent",
      email: "agent@example.test",
      emailVerified: true,
      createdAt: "2026-09-29T00:00:00.000Z",
      updatedAt: "2026-09-29T00:00:00.000Z",
    },
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/\/$/, "");
    routeCalls.push(`${request.method()} ${path}${url.search}`);
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path.endsWith("/auth/get-session")) return json(session);
    if (path === "/api/workspace" && request.method() === "GET")
      return json([
        {
          id: workspaceId,
          name: "Support",
          slug: "support",
          logo: null,
          description: null,
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ]);
    if (path === `/api/workspace/${workspaceId}/members`)
      return json([
        {
          id: "user-e2e",
          name: "Agent",
          email: "agent@example.test",
          image: null,
          role: "member",
        },
      ]);
    if (path === "/api/config")
      return json({
        disableRegistration: false,
        disablePasswordRegistration: false,
        disableEmailOtpSignIn: true,
        disableWorkspaceCreation: false,
        hasSmtp: false,
        hasGithubSignIn: false,
        hasGoogleSignIn: false,
        hasDiscordSignIn: false,
        hasCustomOAuth: false,
        disableLoginForm: false,
        customOAuthAutoLogin: false,
        customOAuthLogoutUrl: null,
      });
    if (path === "/api/project")
      return json([
        {
          id: projectId,
          workspaceId,
          slug: "WLP",
          name: "Worklist",
          description: null,
          icon: null,
          createdAt: "2026-09-01T00:00:00.000Z",
          archivedAt: null,
          deletedAt: null,
          purgeAfter: null,
          position: 1,
          lastTaskNumber: created ? 1 : 0,
          statistics: {
            completionPercentage: 0,
            totalTasks: created ? 1 : 0,
            dueDate: null,
          },
          archivedTasks: [],
          plannedTasks: [],
          columns: [],
        },
      ]);
    if (path === "/api/capabilities")
      return json({
        manageProjects: false,
        createProjects: false,
        updateProjects: false,
        deleteProjects: false,
        updateTasks: true,
        createTasks: true,
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
      });
    if (path === `/api/workspace/${workspaceId}/work-item-types`)
      return json([{ id: typeId, key: "task", name: "Task" }]);
    if (
      path === `/api/projects/${projectId}/work-items` &&
      request.method() === "GET"
    )
      return json({
        data: created
          ? [
              {
                ...item,
                stateName: "Backlog",
                stateCategory: "backlog",
                assigneeName: item.assigneeName,
              },
            ]
          : [],
        page: { hasMore: false, nextCursor: null },
        meta: {},
      });
    if (
      path === `/api/projects/${projectId}/work-items` &&
      request.method() === "POST"
    ) {
      created = true;
      return json(item);
    }
    if (path === "/api/work-items/WLP-1" && request.method() === "GET")
      return json({
        ...item,
        assigneeId: "person-existing",
        assigneeName: "Existing colleague",
      });
    if (path === "/api/work-items/WLP-1" && request.method() === "PATCH") {
      const headers = await request.allHeaders();
      expect(headers["if-match"], JSON.stringify(headers)).toBe('"1"');
      const body = request.postDataJSON() as Record<string, unknown>;
      expect(body.description).toBe("Initial notes");
      item = {
        ...item,
        ...body,
        version: item.version + 1,
        updatedAt: "2026-09-29T10:00:00.000Z",
      };
      activity.unshift({
        id: "activity-edit",
        workItemId: item.id,
        actorId: "person-agent",
        actorType: "person",
        verb: "updated",
        field: "title",
        oldValue: "First report",
        newValue: item.title,
        payload: null,
        visibility: "public",
        workflowVersionId: null,
        createdAt: item.updatedAt,
        kind: "activity",
      });
      return json(item);
    }
    if (path === `/api/projects/${projectId}/assignable`)
      return json([
        {
          personId: "person-existing",
          name: "Existing colleague",
          roleName: "Member",
          openWorkCount: 1,
        },
        {
          personId: assigneeId,
          name: "Casey Agent",
          roleName: "Member",
          openWorkCount: 0,
        },
      ]);
    if (
      path === "/api/work-items/WLP-1/assign" &&
      request.method() === "POST"
    ) {
      expect(request.postDataJSON()).toEqual({
        assigneeId,
        expectedCurrentAssigneeId: "person-existing",
      });
      assigned = true;
      item = {
        ...item,
        assigneeId,
        assigneeName: "Casey Agent",
        version: item.version + 1,
      };
      activity.unshift({
        id: "activity-assign",
        workItemId: item.id,
        actorId: "person-agent",
        actorType: "person",
        verb: "assigned",
        field: "assignee",
        oldValue: "person-existing",
        newValue: assigneeId,
        payload: null,
        visibility: "internal",
        workflowVersionId: null,
        createdAt: "2026-09-29T10:01:00.000Z",
        kind: "activity",
      });
      return json({
        key: item.key,
        assigneeId,
        previousAssigneeId: "person-existing",
        version: item.version,
      });
    }
    if (path === "/api/work-items/WLP-1/activity")
      return json({
        data: activity,
        page: { hasMore: false, nextCursor: null },
      });
    return json({}, 404);
  });

  await page.goto("/agent/projects/WLP/work");
  await expect(
    page.getByTestId("create-work-item-trigger"),
    JSON.stringify(routeCalls),
  ).toBeVisible({ timeout: 5000 });
  await page.getByTestId("create-work-item-trigger").click();
  await page.getByLabel("Type").click();
  await page.getByRole("option", { name: "Task" }).click();
  await page.getByLabel("Title", { exact: true }).fill("First report");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("link", { name: /First report/ })).toBeVisible();
  await page.getByRole("link", { name: /First report/ }).click();
  await expect(page.getByTestId("work-item-detail")).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("First report edited");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText("First report edited", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Assignee").click();
  await page.getByRole("option", { name: /Casey Agent/ }).click();
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.getByText("Confirm reassignment")).toBeVisible();
  await page.getByRole("button", { name: "Confirm assignment" }).click();
  await expect.poll(() => assigned).toBe(true);
  await expect(page.getByText("Activity", { exact: true })).toBeVisible();
  await expect(
    page.getByText("assignee: person-existing → person-e2e"),
  ).toBeVisible();
  await expect(page.getByText("Internal", { exact: true })).toBeVisible();
});
