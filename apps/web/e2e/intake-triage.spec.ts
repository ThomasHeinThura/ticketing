import { expect, test } from "@playwright/test";

const workspaceId = "workspace-intake-e2e";
const projectId = "project-intake-e2e";
const typeId = "work-item-type-intake-e2e";
const requestTypeId = "request-type-intake-e2e";
const now = "2026-10-04T08:00:00.000Z";
const formSchema = {
  fields: [
    {
      key: "summary",
      type: "text",
      label: "What do you need?",
      required: true,
      mapsTo: { field: "title" },
    },
    {
      key: "impact",
      type: "select",
      label: "Impact",
      required: true,
      options: ["One person", "My team"],
      mapsTo: {
        field: "priority",
        map: { "One person": "low", "My team": "high" },
      },
    },
    {
      key: "details",
      type: "textarea",
      label: "Additional detail",
      showIf: { field_key: "impact", op: "eq", value: "My team" },
    },
    {
      key: "evidence",
      type: "file",
      label: "Evidence",
      multiple: true,
    },
  ],
};

function requestType() {
  return {
    id: requestTypeId,
    key: "request-type-key-e2e",
    workspaceId,
    name: "Equipment request",
    description: "Request equipment from the service desk.",
    icon: null,
    group: "Hardware",
    workItemTypeId: typeId,
    defaultProjectId: projectId,
    defaultAssigneeId: null,
    slaPolicyId: null,
    formSchema,
    autoAccept: false,
    customerVisible: true,
    forcePrivate: false,
    published: true,
    position: 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function submission(ref: string, number: number, state = "new") {
  return {
    id: `submission-${number}`,
    ref,
    state,
    workItemKey: null,
    createdAt: now,
    organisationId: "organisation-intake-e2e",
    requesterId: "person-customer-e2e",
    requestTypeId,
    requestTypeVersionId: "request-type-version-e2e",
    formData: { summary: `Replace device ${number}`, impact: "My team" },
    claimedBy: null,
    claimedAt: null,
    version: 1,
    requestTypeName: "Equipment request",
    customerName: "Avery Customer",
    organisationName: "Northwind",
    summary: `Replace device ${number}`,
    submittedAt: now,
    suggestedDuplicates: [
      {
        key: "SUP-42",
        title: "Replace the same device model",
        state: "open",
        similarity: 0.72,
      },
    ],
    attachments: [
      {
        id: `attachment-${number}`,
        fieldKey: "evidence",
        filename: "device-photo.png",
        mimeType: "image/png",
        size: 1024,
        uploadedBy: "person-customer-e2e",
        createdAt: now,
      },
    ],
    messages: [
      {
        id: `message-${number}`,
        actorType: "customer",
        body: "The device no longer starts.",
        createdAt: now,
      },
    ],
    formSchema,
    suggestedProjectId: projectId,
    suggestedWorkItemTypeId: typeId,
  };
}

async function setupStaffApi(page: import("@playwright/test").Page) {
  const records = new Map([
    ["SUB-1", submission("SUB-1", 1)],
    ["SUB-2", submission("SUB-2", 2)],
  ]);
  const actions: Array<{ path: string; method: string; body: unknown }> = [];
  const requests: Array<{ path: string; method: string }> = [];
  let savedRequestType = requestType();
  let acceptFailure: { status: number; message: string } | null = null;
  let triageIntake = true;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    requests.push({ path, method });
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path.endsWith("/auth/get-session"))
      return json({
        session: {
          id: "session-intake-e2e",
          userId: "user-agent-e2e",
          token: "session-token-e2e",
          expiresAt: "2027-01-01T00:00:00.000Z",
          createdAt: now,
          updatedAt: now,
          activeOrganizationId: workspaceId,
        },
        user: {
          id: "user-agent-e2e",
          name: "Jordan Agent",
          email: "agent@example.test",
          emailVerified: true,
          image: null,
          createdAt: now,
          updatedAt: now,
        },
      });
    if (path === "/api/me/csrf-token")
      return json({
        token: "intake-csrf",
        expiresAt: "2027-01-01T00:00:00.000Z",
      });
    if (path === "/api/workspace" && method === "GET")
      return json([
        {
          id: workspaceId,
          name: "Support workspace",
          slug: "support",
          logo: null,
          description: null,
          createdAt: now,
        },
      ]);
    if (path === `/api/workspace/${workspaceId}/members`)
      return json([
        { id: "user-agent-e2e", role: "admin", name: "Jordan Agent" },
      ]);
    if (path === "/api/capabilities")
      return json({
        manageProjects: false,
        manageProjectSettings: false,
        createProjects: false,
        updateProjects: false,
        deleteProjects: false,
        updateTasks: false,
        transitionTasks: false,
        rankTasks: false,
        createTasks: false,
        deleteTasks: false,
        assignTasks: false,
        createLabels: false,
        updateLabels: false,
        deleteLabels: false,
        manageWorkspace: false,
        deleteWorkspace: false,
        inviteUsers: false,
        manageTeam: false,
        removeMembers: false,
        createPublicComments: false,
        createInternalComments: false,
        manageServiceCalendars: false,
        manageRequestTypes: true,
        triageIntake,
      });
    if (path === "/api/submissions" && method === "GET")
      return json({
        items: [...records.values()],
        nextBefore: null,
      });
    const submissionMatch = path.match(
      /^\/api\/submissions\/(SUB-\d+)(?:\/(accept|duplicate|claim|messages|decline))?$/u,
    );
    if (submissionMatch) {
      const ref = submissionMatch[1];
      const action = submissionMatch[2];
      if (!ref) return json({ message: "Not found" }, 404);
      const current = records.get(ref);
      if (!current) return json({ message: "Not found" }, 404);
      if (!action && method === "GET") return json(current);
      if (action && method === "POST") {
        const body = request.postDataJSON?.() ?? null;
        actions.push({ path, method, body });
        if (action === "duplicate") {
          const workItemKey = (body as { workItemKey: string }).workItemKey;
          current.state = "duplicate";
          current.workItemKey = workItemKey;
          return json({ ref, state: "duplicate", workItemKey, createdAt: now });
        }
        if (action === "accept") {
          if (acceptFailure)
            return json(
              { message: acceptFailure.message },
              acceptFailure.status,
            );
          current.state = "accepted";
          current.workItemKey = ref === "SUB-2" ? "SUP-87" : "SUP-86";
          return json({
            ref,
            state: "accepted",
            workItemKey: current.workItemKey,
            createdAt: now,
          });
        }
        if (action === "decline") {
          current.state = "declined";
          return json({
            ref,
            state: "declined",
            workItemKey: null,
            createdAt: now,
          });
        }
        return json({
          ref,
          state: current.state,
          workItemKey: null,
          createdAt: now,
        });
      }
    }
    if (path === "/api/project" && method === "GET")
      return json([
        {
          id: projectId,
          workspaceId,
          slug: "SUP",
          name: "Support",
          description: null,
          icon: null,
          createdAt: now,
          archivedAt: null,
          deletedAt: null,
          purgeAfter: null,
          position: 0,
          lastTaskNumber: 86,
          statistics: { completionPercentage: 0, totalTasks: 1, dueDate: null },
          archivedTasks: [],
          plannedTasks: [],
          columns: [],
        },
      ]);
    if (path === `/api/workspace/${workspaceId}/work-item-types`)
      return json([{ id: typeId, key: "task", name: "Task" }]);
    if (path === "/api/sla-policies")
      return json({
        data: [],
        page: { previousCursor: null, nextCursor: null, hasMore: false },
        meta: { total: 0 },
      });
    if (path === `/api/projects/${projectId}/assignable`)
      return json([
        {
          personId: "person-agent-e2e",
          name: "Jordan Agent",
          roleName: "agent",
          openWorkCount: 2,
        },
      ]);
    if (
      (path === "/api/request-types" || path === "/api/request-types/") &&
      method === "GET"
    )
      return json({ items: [savedRequestType] });
    if (path === `/api/request-types/${requestTypeId}` && method === "PATCH") {
      savedRequestType = { ...savedRequestType, ...request.postDataJSON() };
      actions.push({ path, method, body: request.postDataJSON() });
      return json(savedRequestType);
    }
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
    return json(
      { message: `Unhandled E2E API request: ${method} ${path}` },
      500,
    );
  });
  return {
    actions,
    requests,
    records,
    setCanTriage: (value: boolean) => {
      triageIntake = value;
    },
    setAcceptFailure: (failure: { status: number; message: string } | null) => {
      acceptFailure = failure;
    },
  };
}

test("staff can triage duplicates and accept into a linked work item", async ({
  page,
}) => {
  const { actions } = await setupStaffApi(page);
  await page.goto("/agent/triage?tab=intake");
  await expect(page.getByText("SUB-1").first()).toBeVisible();
  await page.getByRole("link", { name: "Open" }).first().click();
  await expect(page.getByText("device-photo.png")).toBeVisible();
  await expect(page.getByText("The device no longer starts.")).toBeVisible();
  await page.getByRole("button", { name: "Merge as duplicate" }).click();
  await expect(page.getByRole("link", { name: "SUP-42" })).toBeVisible();
  expect(actions).toContainEqual({
    path: "/api/submissions/SUB-1/duplicate",
    method: "POST",
    body: { workItemKey: "SUP-42" },
  });

  await page.goto("/agent/submissions/SUB-2");
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByRole("link", { name: "SUP-87" })).toBeVisible();
  expect(actions).toContainEqual({
    path: "/api/submissions/SUB-2/accept",
    method: "POST",
    body: { projectId, typeId },
  });
});

test("request type editor saves assignment, field mappings, conditions and previews them", async ({
  page,
}) => {
  const { actions, requests } = await setupStaffApi(page);
  await page.goto(`/agent/settings/request-types/${requestTypeId}`);
  await expect
    .poll(() => requests.some(({ path }) => path === "/api/request-types/"))
    .toBe(true);
  await expect(
    page.getByRole("heading", { name: "Request type", level: 1 }),
  ).toBeVisible();
  await expect(page.getByLabel("Field label").nth(1)).toHaveValue("Impact");
  await expect(page.getByLabel("Additional detail")).toHaveCount(0);
  await page.getByLabel("Impact").click();
  await page.getByRole("option", { name: "My team" }).click();
  await expect(page.getByLabel("Additional detail")).toBeVisible();
  await page.getByLabel("Default assignee").click();
  await page.getByRole("option", { name: "Jordan Agent" }).click();
  await page.getByLabel("Map answer to").nth(1).click();
  await page.getByRole("option", { name: "Custom work-item field" }).click();
  await page.getByLabel("Custom field key").fill("asset_tag");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  const saveAction = actions.find((action) => action.method === "PATCH");
  expect(saveAction?.body).toMatchObject({
    defaultAssigneeId: "person-agent-e2e",
    formSchema: {
      fields: expect.arrayContaining([
        expect.objectContaining({
          key: "impact",
          mapsTo: { field: "cf.asset_tag" },
        }),
      ]),
    },
  });
});

test("triage shows an actionable conflict when another agent resolves acceptance first", async ({
  page,
}) => {
  const { setAcceptFailure } = await setupStaffApi(page);
  setAcceptFailure({
    status: 409,
    message: "This submission changed. Refresh it and review the latest state.",
  });
  await page.goto("/agent/triage?tab=intake");
  await page.getByRole("link", { name: "Open" }).nth(1).click();
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(
    page.getByText(
      "This submission changed. Refresh it and review the latest state.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept" })).toBeEnabled();
  await expect(page.getByRole("link", { name: "SUP-87" })).toHaveCount(0);
});

test("triage shows validation feedback and keeps the request actionable", async ({
  page,
}) => {
  const { setAcceptFailure } = await setupStaffApi(page);
  setAcceptFailure({
    status: 422,
    message: "Choose a project before accepting.",
  });
  await page.goto("/agent/submissions/SUB-2");
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(
    page.getByText("Choose a project before accepting.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept" })).toBeEnabled();
});

test("triage declines with a reason and keeps the terminal decision closed", async ({
  page,
}) => {
  const { actions } = await setupStaffApi(page);
  await page.goto("/agent/submissions/SUB-2");
  await page
    .locator("#decline-reason")
    .fill("Outside the supported service scope.");
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(
    page.getByText("Equipment request · Declined", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Reopen" })).toHaveCount(0);
  expect(actions).toContainEqual({
    path: "/api/submissions/SUB-2/decline",
    method: "POST",
    body: { reason: "Outside the supported service scope." },
  });
});

test("triage permission denial hides request actions", async ({ page }) => {
  const { setCanTriage } = await setupStaffApi(page);
  setCanTriage(false);
  await page.goto("/agent/submissions/SUB-2");
  await expect(
    page.getByText("Submissions could not be loaded.").first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Decline" })).toHaveCount(0);
});
