import { expect, test } from "@playwright/test";

test("staff can create, list, edit, assign, and read work-item activity", async ({
  page,
}) => {
  // This journey performs several full navigations/reloads to verify persisted
  // preferences, comment drafts, capability changes, and stale-content removal.
  // Keep its timeout large enough for the real browser flow instead of letting
  // the final capability-gated assignment control be cut off mid-load.
  test.setTimeout(60_000);

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
  let permissioned = true;
  let settingsPermissioned = true;
  let accessDenied = false;
  let postedComment = false;
  let projectDefaultCommentVisibility: "public" | "internal" = "internal";
  const activity: Array<Record<string, unknown>> = [];
  const richComment = {
    id: "comment-rich",
    workItemId: "item-e2e",
    actorId: "person-agent",
    actorType: "person",
    verb: "commented",
    field: null,
    oldValue: null,
    newValue: null,
    payload: null,
    visibility: "internal",
    workflowVersionId: null,
    createdAt: "2026-09-29T10:02:00.000Z",
    kind: "comment",
    body: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Tiptap note", marks: [{ type: "bold" }] },
          ],
        },
      ],
    },
  };
  const olderComment = {
    ...richComment,
    id: "comment-older",
    createdAt: "2026-09-29T09:00:00.000Z",
    body: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Older note" }] },
      ],
    },
  };
  const routeCalls: string[] = [];
  await page.addInitScript(() => {
    const shifts: Array<{ value: number; startTime: number }> = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<
        PerformanceEntry & { value: number }
      >) {
        shifts.push({ value: entry.value, startTime: entry.startTime });
      }
    }).observe({ type: "layout-shift", buffered: true });
    Object.assign(window, { __taskdeskLayoutShifts: shifts });
  });
  page.on("pageerror", (error) => console.error("Browser page error:", error));
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
          defaultCommentVisibility: projectDefaultCommentVisibility,
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
    if (path === `/api/project/${projectId}` && request.method() === "GET")
      return json({
        id: projectId,
        workspaceId,
        slug: "WLP",
        name: "Worklist",
        description: null,
        icon: null,
        defaultCommentVisibility: projectDefaultCommentVisibility,
        createdAt: "2026-09-01T00:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        purgeAfter: null,
        position: 1,
        lastTaskNumber: created ? 1 : 0,
      });
    if (path === "/api/capabilities")
      return json({
        manageProjects: true,
        manageProjectSettings: settingsPermissioned,
        createProjects: false,
        updateProjects: true,
        deleteProjects: false,
        updateTasks: permissioned,
        createTasks: true,
        deleteTasks: false,
        assignTasks: permissioned,
        createLabels: false,
        updateLabels: false,
        deleteLabels: false,
        manageWorkspace: false,
        deleteWorkspace: false,
        inviteUsers: false,
        manageTeam: false,
        removeMembers: false,
        createPublicComments: permissioned,
        createInternalComments: permissioned,
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
    if (path === `/api/task/tasks/${projectId}` && request.method() === "GET")
      return json({
        data: {
          id: projectId,
          workspaceId,
          slug: "WLP",
          name: "Worklist",
          icon: null,
          description: "",
          columns: [],
          archivedTasks: [],
          plannedTasks: [],
        },
        pagination: {
          total: 0,
          page: 1,
          pageSize: 50,
          totalPages: 0,
        },
      });
    if (path === `/api/project/${projectId}` && request.method() === "PUT") {
      const body = request.postDataJSON() as {
        defaultCommentVisibility: "public" | "internal";
      };
      projectDefaultCommentVisibility = body.defaultCommentVisibility;
      return json({
        id: projectId,
        workspaceId,
        slug: "WLP",
        name: "Worklist",
        description: "",
        icon: null,
        defaultCommentVisibility: projectDefaultCommentVisibility,
        createdAt: "2026-09-01T00:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        purgeAfter: null,
        position: 1,
        lastTaskNumber: created ? 1 : 0,
      });
    }
    if (path === "/api/work-items/WLP-1" && request.method() === "GET") {
      if (accessDenied) return json({ message: "Work item not found" }, 404);
      return json({
        ...item,
        assigneeId: "person-existing",
        assigneeName: "Existing colleague",
      });
    }
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
      path === "/api/work-items/WLP-1/comments" &&
      request.method() === "POST"
    ) {
      const body = request.postDataJSON() as {
        body: Record<string, unknown>;
        visibility: string;
      };
      expect(body.visibility).toBe("public");
      expect(JSON.stringify(body.body)).toContain("Customer-safe update");
      postedComment = true;
      const comment = {
        id: "comment-posted",
        workItemId: item.id,
        actorId: "person-agent",
        actorType: "person",
        verb: "commented",
        visibility: body.visibility,
        body: body.body,
        createdAt: "2026-09-29T10:03:00.000Z",
        kind: "comment",
      };
      activity.unshift(comment);
      return json(comment);
    }
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
    if (
      path === "/api/work-items/WLP-1/assign" &&
      request.method() === "DELETE"
    ) {
      item = { ...item, assigneeId: null, assigneeName: null };
      return json({
        key: item.key,
        assigneeId: null,
        previousAssigneeId: "person-e2e",
        version: item.version + 1,
      });
    }
    if (path === "/api/work-items/WLP-1/activity") {
      if (url.searchParams.has("cursor"))
        return json({
          data: [olderComment],
          page: { hasMore: false, nextCursor: null },
        });
      const rows = [...activity, richComment].sort(
        (left, right) =>
          Date.parse(String(right.createdAt)) -
          Date.parse(String(left.createdAt)),
      );
      return json({
        data: rows,
        page: { hasMore: true, nextCursor: "older-page" },
      });
    }
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
  await page.goto("/dashboard/settings/projects/project-e2e/general");
  await expect(
    page.getByRole("heading", { name: "General Settings" }),
  ).toBeVisible();
  await page.getByLabel("Default comment visibility").click();
  await page.getByRole("option", { name: "Public" }).click();
  await expect.poll(() => projectDefaultCommentVisibility).toBe("public");
  settingsPermissioned = false;
  await page.reload();
  await expect(page.getByLabel("Default comment visibility")).toBeDisabled();
  settingsPermissioned = true;
  await page.reload();
  await expect(page.getByLabel("Default comment visibility")).toBeEnabled();
  await page.goto("/agent/work-items/WLP-1");
  await expect(page.getByTestId("work-item-detail")).toBeVisible();
  const detailShift = await page.evaluate(() => {
    const skeleton = performance.getEntriesByName(
      "taskdesk:work-item-detail:skeleton-mounted",
    )[0]?.startTime;
    const content = performance
      .getEntriesByName("taskdesk:work-item-detail:content-mounted")
      .at(-1)?.startTime;
    const shifts = (
      window as Window & {
        __taskdeskLayoutShifts?: Array<{
          value: number;
          startTime: number;
        }>;
      }
    ).__taskdeskLayoutShifts;
    if (skeleton === undefined || content === undefined || !shifts) return null;
    return shifts
      .filter(
        (entry) => entry.startTime >= skeleton && entry.startTime <= content,
      )
      .reduce((total, entry) => total + entry.value, 0);
  });
  expect(detailShift).not.toBeNull();
  expect(detailShift).toBeLessThanOrEqual(0.1);
  await expect(page).toHaveScreenshot("work-item-detail.png", {
    fullPage: true,
    animations: "disabled",
  });
  const editButton = page.getByRole("button", { name: "Edit", exact: true });
  await editButton.focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Title", { exact: true }).fill("First report edited");
  const saveButton = page.getByRole("button", { name: "Save changes" });
  await saveButton.focus();
  await page.keyboard.press("Enter");
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
  await expect(page.getByText("Internal", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Tiptap note", { exact: true })).toBeVisible();
  await expect(page.getByText("Tiptap note", { exact: true })).toHaveJSProperty(
    "tagName",
    "STRONG",
  );
  await page.getByRole("button", { name: "Load older activity" }).click();
  await expect(page.getByText("Older note", { exact: true })).toBeVisible();
  const displayedActivity = page
    .getByTestId("work-item-journey")
    .getByRole("listitem");
  await expect(displayedActivity.first()).toContainText("Older note");
  await expect(displayedActivity.last()).toContainText("Tiptap note");

  await expect(page.getByLabel("Comment visibility")).toContainText("public");
  const commentEditor = page.locator(
    '[contenteditable="true"][aria-label="Write a comment"]',
  );
  await commentEditor.fill("Customer-safe update");
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem(
          "taskdesk:work-item-comment-draft:v1:user-e2e:WLP-1",
        ),
      ),
    )
    .toContain("Customer-safe update");
  await page.reload();
  await expect(page.getByTestId("work-item-detail")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem(
          "taskdesk:work-item-comment-draft:v1:user-e2e:WLP-1",
        ),
      ),
    )
    .toContain("Customer-safe update");
  await expect(page.getByLabel("Comment visibility")).toContainText("public");
  await expect(
    page.locator('[contenteditable="true"][aria-label="Write a comment"]'),
  ).toHaveText("Customer-safe update");
  const sendComment = page.getByRole("button", { name: "Send comment" });
  await sendComment.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => postedComment).toBe(true);
  await expect(
    page.getByText("Customer-safe update", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Comments only" }).click();
  await expect(page).toHaveURL(/activity=comments/);
  await expect(
    page.getByText("assignee: person-existing → person-e2e"),
  ).toHaveCount(0);
  await expect(
    page.getByText("Customer-safe update", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Public only" }).click();
  await expect(page).toHaveURL(/activity=public/);
  await expect(
    page.getByText("assignee: person-existing → person-e2e"),
  ).toHaveCount(0);
  await expect(
    page.getByText("Customer-safe update", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Everything" }).click();
  await expect(page).not.toHaveURL(/activity=/);

  permissioned = false;
  await page.reload();
  await expect(page.getByTestId("work-item-detail")).toBeVisible();
  const journey = page.getByTestId("work-item-journey");
  await expect(
    journey.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
  await expect(
    journey.getByRole("heading", { name: "Assignment" }),
  ).toHaveCount(0);

  permissioned = true;
  await page.reload();
  await expect(page.getByTestId("work-item-journey")).toBeVisible();
  await expect(page.getByRole("button", { name: "Unassign" })).toBeVisible();
  // The detail/activity were fetched successfully in this page session. Make the
  // authoritative detail refetch return the same 404 used for an out-of-reach key.
  accessDenied = true;
  await page.getByRole("button", { name: "Unassign" }).click();
  await expect(page.getByTestId("work-item-detail-not-found")).toBeVisible();
  await expect(page.getByTestId("work-item-journey")).toHaveCount(0);
  await expect(page.getByText("Tiptap note", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Older note", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Customer-safe update", { exact: true }),
  ).toHaveCount(0);
});
