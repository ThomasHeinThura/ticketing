import { expect, test } from "@playwright/test";

async function tabTo(
  page: import("@playwright/test").Page,
  target: import("@playwright/test").Locator,
) {
  for (let tabCount = 0; tabCount < 100; tabCount += 1) {
    if (
      await target.evaluate((element) => element === document.activeElement)
    ) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error("Keyboard traversal did not reach the requested control");
}

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
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<
        PerformanceEntry & { value: number }
      >) {
        shifts.push({ value: entry.value, startTime: entry.startTime });
      }
    });
    observer.observe({ type: "layout-shift", buffered: true });
    Object.assign(window, {
      __taskdeskLayoutShifts: shifts,
      __taskdeskLayoutShiftObserver: observer,
    });
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
    if (path === "/api/me/csrf-token" && request.method() === "GET")
      return json({
        token: "journey-csrf",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
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
        transitionTasks: permissioned,
        createTasks: true,
        deleteTasks: false,
        assignTasks: permissioned,
        rankTasks: permissioned,
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
                stateName: item.stateName,
                stateCategory: item.stateCategory,
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
    if (path === `/api/projects/${projectId}/states`)
      return json([
        {
          id: "state-e2e",
          stateTemplateId: "template-backlog",
          name: "Backlog",
          group: "backlog",
          position: 0,
          isDefault: true,
        },
        {
          id: "state-ready",
          stateTemplateId: "template-ready",
          name: "Ready",
          group: "unstarted",
          position: 1,
          isDefault: false,
        },
      ]);
    if (
      path === "/api/work-items/WLP-1/transitions" &&
      request.method() === "GET"
    ) {
      const toReady = item.stateId === "state-e2e";
      return json([
        {
          transitionId: toReady ? "transition-ready" : "transition-backlog",
          toStateTemplateId: toReady ? "template-ready" : "template-backlog",
          toStateName: toReady ? "Ready" : "Backlog",
          toStateId: toReady ? "state-ready" : "state-e2e",
          notePolicy: "none",
          noteVisibility: "internal",
          requiresApproval: false,
          requiresCab: false,
          isReopen: false,
          available: true,
          blockedBy: [],
        },
      ]);
    }
    if (
      path === "/api/work-items/WLP-1/transition" &&
      request.method() === "POST"
    ) {
      const body = request.postDataJSON() as { toStateTemplateId: string };
      const toReady = body.toStateTemplateId === "template-ready";
      expect(body.toStateTemplateId).toBe(
        toReady ? "template-ready" : "template-backlog",
      );
      item = {
        ...item,
        stateId: toReady ? "state-ready" : "state-e2e",
        stateName: toReady ? "Ready" : "Backlog",
        stateCategory: toReady ? "unstarted" : "backlog",
        version: item.version + 1,
      };
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
      expect(headers["if-match"], JSON.stringify(headers)).toBe(
        `"${item.version}"`,
      );
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
    if (path === "/api/work-items/bulk" && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({
        workspaceId,
        workItemKeys: ["WLP-1"],
        assigneeId,
        operation: "assign",
      });
      assigned = true;
      return json({ succeeded: ["WLP-1"], failed: [] });
    }
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
  await tabTo(page, page.getByTestId("create-work-item-trigger"));
  await page.keyboard.press("Enter");
  await page.getByLabel("Type").click();
  await page.getByRole("option", { name: "Task" }).click();
  await page.getByLabel("Title", { exact: true }).fill("First report");
  await page.getByLabel("Title", { exact: true }).press("Enter");
  await expect(page.getByRole("link", { name: /First report/ })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("p1-work-item-list.png"),
  });
  await page.getByRole("button", { name: "Board" }).click();
  await expect(page).toHaveURL(/layout=board/);
  await expect(page.getByRole("region", { name: "Ready" })).toBeVisible();
  await expect(page.getByTestId("work-item-board-column")).toHaveCount(2);
  await page.getByRole("button", { name: "Change state" }).click();
  const stateSelect = page.getByTestId("work-item-state-select");
  await tabTo(page, stateSelect);
  await page.keyboard.press("Space");
  const offeredState = page.getByRole("option", { name: "Ready" });
  await expect(offeredState).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(stateSelect).toContainText("Ready");
  const moveState = page.getByRole("button", { name: "Move" });
  await tabTo(page, moveState);
  await page.keyboard.press("Enter");
  await expect.poll(() => item.stateId).toBe("state-ready");
  expect(routeCalls).toContain("POST /api/work-items/WLP-1/transition");
  await page.reload();
  await expect(page.getByRole("region", { name: "Ready" })).toBeVisible();
  await page
    .getByTestId("work-item-board-card")
    .dragTo(page.getByRole("region", { name: "Backlog" }));
  await expect.poll(() => item.stateId).toBe("state-e2e");
  await page.getByLabel("Select WLP-1").click();
  await page.getByLabel("Choose a project member").click();
  await page.getByRole("option", { name: /Casey Agent/ }).click();
  await page.getByRole("button", { name: "Assign selected" }).click();
  await expect.poll(() => assigned).toBe(true);
  await expect(page.getByTestId("bulk-assign-toolbar")).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("p1-board-journey.png"),
  });
  await page.getByRole("button", { name: "List" }).click();
  await expect(page).toHaveURL(/layout=list/);
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
  await expect(page.getByTestId("realtime-unavailable")).toBeVisible();
  await expect(page.getByText("Activity", { exact: true })).toBeVisible();
  await expect(page.getByText("Tiptap note", { exact: true })).toBeVisible();
  const detailJourney = page.getByTestId("work-item-journey");
  const journeyBounds = await detailJourney.boundingBox();
  if (!journeyBounds)
    throw new Error("Loaded activity region was not measurable");
  await page.setViewportSize({
    width: 1280,
    height: Math.max(
      720,
      Math.ceil(journeyBounds.y + journeyBounds.height + 24),
    ),
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const detailShift = await page.evaluate(() => {
    const skeleton = performance.getEntriesByName(
      "taskdesk:work-item-detail:skeleton-mounted",
    )[0]?.startTime;
    const content = performance
      .getEntriesByName("taskdesk:work-item-detail:content-mounted")
      .at(-1)?.startTime;
    const measurementWindow = window as Window & {
      __taskdeskLayoutShifts?: Array<{ value: number; startTime: number }>;
      __taskdeskLayoutShiftObserver?: PerformanceObserver;
    };
    const shifts = measurementWindow.__taskdeskLayoutShifts;
    const observer = measurementWindow.__taskdeskLayoutShiftObserver;
    if (!shifts || !observer || skeleton === undefined || content === undefined)
      return null;
    for (const entry of observer.takeRecords() as Array<
      PerformanceEntry & { value: number }
    >) {
      shifts.push({ value: entry.value, startTime: entry.startTime });
    }
    return shifts
      .filter(
        (entry) => entry.startTime >= skeleton && entry.startTime <= content,
      )
      .reduce((total, entry) => total + entry.value, 0);
  });
  if (detailShift === null) {
    throw new Error(
      "Detail skeleton/content marks or layout observer were missing",
    );
  }
  expect(detailShift).toBeLessThanOrEqual(0.1);
  await expect(page).toHaveScreenshot("work-item-detail.png", {
    fullPage: false,
    animations: "disabled",
  });
  await page.screenshot({
    path: test.info().outputPath("p1-work-item-detail.png"),
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  const editButton = page.getByRole("button", { name: "Edit", exact: true });
  await tabTo(page, editButton);
  await page.keyboard.press("Enter");
  const titleInput = page.getByLabel("Title", { exact: true });
  await tabTo(page, titleInput);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("First report edited");
  await expect(titleInput).toHaveValue("First report edited");
  const saveButton = page.getByRole("button", { name: "Save changes" }).first();
  await tabTo(page, saveButton);
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("First report edited", { exact: true }),
  ).toBeVisible();
  const assignee = page.getByLabel("Assignee");
  await tabTo(page, assignee);
  await page.keyboard.press("Space");
  const caseyOption = page.getByRole("option", { name: /Casey Agent/ });
  await expect(caseyOption).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const assignButton = page.getByRole("button", {
    name: "Assign",
    exact: true,
  });
  await tabTo(page, assignButton);
  await page.keyboard.press("Space");
  await expect(page.getByText("Confirm reassignment")).toBeVisible();
  const confirmAssignment = page.getByRole("button", {
    name: "Confirm assignment",
  });
  await tabTo(page, confirmAssignment);
  await page.keyboard.press("Enter");
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
  const loadOlder = page.getByRole("button", { name: "Load older activity" });
  await tabTo(page, loadOlder);
  await page.keyboard.press("Enter");
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
  await tabTo(page, commentEditor);
  await page.keyboard.type("Customer-safe update");
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
  await tabTo(page, sendComment);
  await page.keyboard.press("Enter");
  await expect.poll(() => postedComment).toBe(true);
  await expect(
    page.getByText("Customer-safe update", { exact: true }),
  ).toBeVisible();

  const commentsOnly = page.getByRole("button", { name: "Comments only" });
  await tabTo(page, commentsOnly);
  await page.keyboard.press("Space");
  await expect(page).toHaveURL(/activity=comments/);
  await expect(
    page.getByText("assignee: person-existing → person-e2e"),
  ).toHaveCount(0);
  await expect(
    page.getByText("Customer-safe update", { exact: true }),
  ).toBeVisible();
  const publicOnly = page.getByRole("button", { name: "Public only" });
  await tabTo(page, publicOnly);
  await page.keyboard.press("Space");
  await expect(page).toHaveURL(/activity=public/);
  await expect(
    page.getByText("assignee: person-existing → person-e2e"),
  ).toHaveCount(0);
  await expect(
    page.getByText("Customer-safe update", { exact: true }),
  ).toBeVisible();
  const everything = page.getByRole("button", { name: "Everything" });
  await tabTo(page, everything);
  await page.keyboard.press("Space");
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
  const unassign = page.getByRole("button", { name: "Unassign" });
  await tabTo(page, unassign);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("work-item-detail-not-found")).toBeVisible();
  await expect(page.getByTestId("work-item-journey")).toHaveCount(0);
  await expect(page.getByText("Tiptap note", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Older note", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Customer-safe update", { exact: true }),
  ).toHaveCount(0);
});
