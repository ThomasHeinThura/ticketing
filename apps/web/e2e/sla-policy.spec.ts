import { expect, test } from "@playwright/test";

const workspaceId = "workspace-sla-e2e";
const calendarId = "calendar-sla-e2e";
const typeId = "type-sla-e2e";
const policyId = "policy-sla-e2e";
const session = {
  session: {
    id: "session-sla-e2e",
    userId: "user-sla-e2e",
    token: "session-token-sla-e2e",
    expiresAt: "2027-01-01T00:00:00.000Z",
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
    portal: "agent",
    activeOrganizationId: workspaceId,
  },
  user: {
    id: "user-sla-e2e",
    name: "SLA Policy Admin",
    email: "sla-admin@example.test",
    emailVerified: true,
    image: null,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  },
};

test("SLA policy editor saves an incomplete draft and publishes a complete snapshot", async ({
  page,
}) => {
  const now = "2026-10-03T00:00:00.000Z";
  const calendar = {
    id: calendarId,
    workspaceId,
    name: "Support coverage",
    timezone: "UTC",
    windows: { mon: [{ from: 540, to: 1020 }] },
    holidays: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  let policy: {
    id: string;
    workspaceId: string;
    name: string;
    description: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
    activeVersion: null | Record<string, unknown>;
    draftVersion: null | {
      id: string;
      number: number;
      calendarId: string;
      atRiskThresholdPct: number;
      effectiveFrom: null;
      goals: Array<{
        metric: "first_response" | "resolution";
        workItemTypeId: string;
        priority: "low" | "medium" | "high" | "urgent";
        targetMinutes: number;
      }>;
    };
  } | null = null;
  let createPayload: Record<string, unknown> | undefined;
  let updatePayload: Record<string, unknown> | undefined;
  let publishCount = 0;

  await page.route("**/api/auth/get-session**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(session),
    }),
  );
  await page.route("**/api/workspace", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: workspaceId,
          name: "Support workspace",
          slug: "support",
          logo: null,
          description: null,
          createdAt: now,
          role: "owner",
        },
      ]),
    }),
  );
  await page.route("**/api/workspace/*/members", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: session.user.id, role: "admin" }]),
    }),
  );
  await page.route("**/api/capabilities**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        manageProjects: false,
        createProjects: false,
        updateProjects: false,
        deleteProjects: false,
        updateTasks: false,
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
        manageServiceCalendars: true,
      }),
    }),
  );
  await page.route(`**/api/workspace/${workspaceId}/work-item-types`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: typeId, key: "incident", name: "Incident", category: "service" },
      ]),
    }),
  );
  await page.route("**/api/service-calendars**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [calendar],
        page: { previousCursor: null, nextCursor: null, hasMore: false },
        meta: { total: 1 },
      }),
    }),
  );
  await page.route("**/api/me/csrf-token", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "set-cookie":
          "tdk_csrf_dev=e2e-csrf-token; Path=/; SameSite=Strict; HttpOnly",
      },
      body: JSON.stringify({
        token: "e2e-csrf-token",
        expiresAt: "2027-01-01T00:00:00.000Z",
      }),
    }),
  );
  await page.route("**/api/sla-policies**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === "/api/sla-policies") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [],
          page: { previousCursor: null, nextCursor: null, hasMore: false },
          meta: { total: 0 },
        }),
      });
      return;
    }
    if (
      request.method() === "GET" &&
      path === `/api/sla-policies/${policyId}`
    ) {
      await route.fulfill({
        status: policy ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(policy ?? { message: "SLA policy not found" }),
      });
      return;
    }
    if (request.method() === "POST" && path === "/api/sla-policies") {
      createPayload = request.postDataJSON() as Record<string, unknown>;
      const body = createPayload as {
        name: string;
        description: string | null;
        calendarId: string;
        atRiskThresholdPct: number;
        goals: NonNullable<typeof policy>["draftVersion"] extends infer D
          ? D extends { goals: infer G }
            ? G
            : never
          : never;
      };
      policy = {
        id: policyId,
        workspaceId,
        name: body.name,
        description: body.description,
        version: 1,
        createdAt: now,
        updatedAt: now,
        activeVersion: null,
        draftVersion: {
          id: "version-sla-draft-1",
          number: 1,
          calendarId: body.calendarId,
          atRiskThresholdPct: body.atRiskThresholdPct,
          effectiveFrom: null,
          goals: body.goals,
        },
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(policy),
      });
      return;
    }
    if (
      request.method() === "PATCH" &&
      path === `/api/sla-policies/${policyId}` &&
      policy?.draftVersion
    ) {
      updatePayload = request.postDataJSON() as Record<string, unknown>;
      const body = updatePayload as {
        name?: string;
        description?: string | null;
        calendarId?: string;
        atRiskThresholdPct?: number;
        goals?: typeof policy.draftVersion.goals;
      };
      policy = {
        ...policy,
        name: body.name ?? policy.name,
        description:
          body.description === undefined
            ? policy.description
            : body.description,
        version: policy.version + 1,
        updatedAt: now,
        draftVersion: {
          ...policy.draftVersion,
          calendarId: body.calendarId ?? policy.draftVersion.calendarId,
          atRiskThresholdPct:
            body.atRiskThresholdPct ?? policy.draftVersion.atRiskThresholdPct,
          goals: body.goals ?? policy.draftVersion.goals,
        },
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(policy),
      });
      return;
    }
    if (
      request.method() === "POST" &&
      path === `/api/sla-policies/${policyId}/publish` &&
      policy?.draftVersion
    ) {
      publishCount += 1;
      policy = {
        ...policy,
        version: policy.version + 1,
        updatedAt: now,
        activeVersion: { ...policy.draftVersion, effectiveFrom: now },
        draftVersion: null,
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(policy),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      body: "Not found in SLA policy browser fixture",
    });
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/agent/settings/sla-policies/new");
  await expect(
    page.getByRole("heading", { name: "New SLA policy" }),
  ).toBeVisible();
  await page.getByLabel("Policy name").fill("Support response goals");
  await page.getByRole("combobox", { name: "Service calendar" }).click();
  await page.getByRole("option", { name: "Support coverage · UTC" }).click();
  await page.getByRole("checkbox", { name: "Incident" }).click();
  await page.locator(`#sla-goal-${typeId}-first_response-low`).fill("120");
  await page.getByRole("button", { name: "Save draft" }).click();

  await expect(page).toHaveURL(
    new RegExp(`/agent/settings/sla-policies/${policyId}$`),
  );
  await expect(
    page.getByRole("button", { name: "Publish version" }),
  ).toBeDisabled();
  expect(createPayload?.goals).toHaveLength(1);
  await expect(
    page.locator(`#sla-goal-${typeId}-first_response-low`),
  ).toHaveValue("120");

  const matrix = ["first_response", "resolution"] as const;
  const priorities = ["low", "medium", "high", "urgent"] as const;
  for (const metric of matrix) {
    for (const priority of priorities) {
      const input = page.locator(`#sla-goal-${typeId}-${metric}-${priority}`);
      if (metric === "first_response" && priority === "low") continue;
      await input.fill("240");
    }
  }
  await page.getByLabel("At-risk threshold (%)").fill("80");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(
    page.getByRole("button", { name: "Publish version" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Publish version" }).click();
  await expect(page.getByText("Active version 1")).toBeVisible();
  expect(updatePayload?.goals).toHaveLength(8);
  expect(publishCount).toBe(1);
});
