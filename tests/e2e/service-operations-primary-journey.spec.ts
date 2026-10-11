import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import type { Client as PgClient } from "pg";
import {
  type MfaCsrfAppFixture,
  withMfaCsrfApp,
} from "./helpers/mfa-csrf-app-fixture";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const webRequire = createRequire(resolve(repoRoot, "apps/web/package.json"));
const apiRequire = createRequire(resolve(repoRoot, "apps/api/package.json"));
const playwright = webRequire(
  "@playwright/test",
) as typeof import("@playwright/test");
const { Client } = apiRequire("pg") as typeof import("pg");
const { expect, test } = playwright;

type JsonRecord = Record<string, unknown>;

async function bodyAt(
  response: APIResponse,
  status: number,
): Promise<JsonRecord> {
  const text = await response.text();
  expect(response.status(), text).toBe(status);
  if (status < 200 || status >= 300 || text.length === 0) return {};
  return JSON.parse(text) as JsonRecord;
}

async function getCsrfToken(context: APIRequestContext, origin: string) {
  const response = await context.get(
    new URL("/api/me/csrf-token", origin).toString(),
    { headers: { Origin: origin } },
  );
  const result = await bodyAt(response, 200);
  expect(result.token).toEqual(expect.any(String));
  return String(result.token);
}

async function mutate(
  context: APIRequestContext,
  origin: string,
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  data?: JsonRecord,
  extraHeaders: Record<string, string> = {},
) {
  const token = await getCsrfToken(context, origin);
  const url = new URL(path, origin).toString();
  const options = {
    headers: {
      Origin: origin,
      "x-taskdesk-csrf": token,
      ...extraHeaders,
    },
    ...(data === undefined ? {} : { data }),
  };
  if (method === "POST") return context.post(url, options);
  if (method === "PATCH") return context.patch(url, options);
  return context.delete(url, options);
}

async function signUp(
  context: APIRequestContext,
  origin: string,
  input: { name: string; email: string; password: string },
) {
  return context.post(new URL("/api/auth/sign-up/email", origin).toString(), {
    data: input,
    headers: { Origin: origin },
  });
}

async function seedProjectReach(
  client: PgClient,
  email: string,
  projectId: string,
  workspaceId: string,
) {
  const { rows: users } = await client.query<{ id: string }>(
    'SELECT id FROM "user" WHERE email = $1',
    [email],
  );
  const user = users[0];
  if (!user) throw new Error("Primary journey signup did not create a user");
  const { rows: people } = await client.query<{ id: string }>(
    "SELECT id FROM person WHERE user_id = $1 AND active = true",
    [user.id],
  );
  const person = people[0];
  if (!person)
    throw new Error(
      "Primary journey signup did not provision an active person",
    );

  const roleId = `s7-primary-project-role-${randomUUID()}`;
  await client.query(
    `INSERT INTO role
      (id, scope, workspace_id, key, name, rank, capabilities, is_system, is_editable)
     VALUES ($1, 'project', $2, $3, 'Primary journey reach', 1, '[]'::jsonb, false, false)`,
    [roleId, workspaceId, roleId],
  );
  await client.query(
    `INSERT INTO membership (id, person_id, scope, scope_id, role_id, sees_all)
     VALUES ($1, $2, 'project', $3, $4, false)`,
    [`s7-primary-membership-${randomUUID()}`, person.id, projectId, roleId],
  );
}

function weekdayWindows() {
  const weekdays = ["mon", "tue", "wed", "thu", "fri"] as const;
  return Object.fromEntries(
    weekdays.map((day) => [day, [{ from: 540, to: 1020 }]]),
  );
}

function completeGoals(workItemTypeId: string) {
  return (["first_response", "resolution"] as const).flatMap((metric) =>
    (["low", "medium", "high", "urgent"] as const).map((priority, index) => ({
      metric,
      workItemTypeId,
      priority,
      targetMinutes: 60 * (index + 1),
    })),
  );
}

async function runJourney(fixture: MfaCsrfAppFixture) {
  const { origin, email, password } = fixture;
  const admin = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const strangerEmail = `service-operations-stranger-${randomUUID()}@example.test`;
  const stranger = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const client = new Client({ connectionString: fixture.databaseUrl });
  await client.connect();

  try {
    const signup = await signUp(admin, origin, {
      name: "Service operations administrator",
      email,
      password,
    });
    await bodyAt(signup, 200);

    const strangerSignup = await signUp(stranger, origin, {
      name: "Unrelated service operations user",
      email: strangerEmail,
      password: `${password}-stranger`,
    });
    await bodyAt(strangerSignup, 200);

    const workspaceResponse = await mutate(
      admin,
      origin,
      "POST",
      "/api/workspace",
      { name: `Service Operations ${randomUUID().slice(0, 8)}` },
    );
    const workspace = await bodyAt(workspaceResponse, 200);
    const workspaceId = String(workspace.id);
    expect(workspaceId).not.toBe("undefined");

    const projectResponse = await mutate(
      admin,
      origin,
      "POST",
      "/api/project",
      {
        name: "Service Operations Queue",
        workspaceId,
        icon: "Folder",
        slug: `service-ops-${randomUUID().slice(0, 8)}`,
      },
    );
    const project = await bodyAt(projectResponse, 200);
    const projectId = String(project.id);
    await seedProjectReach(client, email, projectId, workspaceId);

    const typesResponse = await admin.get(
      new URL(
        `/api/workspace/${encodeURIComponent(workspaceId)}/work-item-types`,
        origin,
      ).toString(),
      { headers: { Origin: origin } },
    );
    const typesText = await typesResponse.text();
    expect(typesResponse.status(), typesText).toBe(200);
    const types = JSON.parse(typesText) as Array<{ id: string }>;
    const workItemType = types[0];
    expect(workItemType?.id).toBeTruthy();

    const workItemResponse = await mutate(
      admin,
      origin,
      "POST",
      `/api/projects/${encodeURIComponent(projectId)}/work-items`,
      {
        typeId: workItemType?.id,
        title: "Validate published service targets",
        priority: "high",
      },
    );
    const workItem = await bodyAt(workItemResponse, 200);
    const workItemId = String(workItem.id);
    const workItemKey = String(workItem.key);

    const calendarBody = {
      workspaceId,
      name: "Weekday service coverage",
      timezone: "UTC",
      windows: weekdayWindows(),
      holidays: [],
    };
    const csrfDenied = await admin.post(
      new URL("/api/service-calendars", origin).toString(),
      { data: calendarBody, headers: { Origin: origin } },
    );
    await bodyAt(csrfDenied, 403);

    const calendarResponse = await mutate(
      admin,
      origin,
      "POST",
      "/api/service-calendars",
      calendarBody,
    );
    const calendar = await bodyAt(calendarResponse, 200);
    const calendarId = String(calendar.id);
    expect(calendar.version).toBe(1);

    const previewResponse = await admin.get(
      new URL(
        `/api/service-calendars/${encodeURIComponent(calendarId)}/preview?year=2026`,
        origin,
      ).toString(),
      { headers: { Origin: origin } },
    );
    const preview = await bodyAt(previewResponse, 200);
    expect(preview.calendarId).toBe(calendarId);
    expect(Number(preview.annualCoverMinutes)).toBeGreaterThan(0);

    const calendarUpdate = await mutate(
      admin,
      origin,
      "PATCH",
      `/api/service-calendars/${encodeURIComponent(calendarId)}`,
      { timezone: "Europe/London" },
      { "If-Match": '"1"' },
    );
    const updatedCalendar = await bodyAt(calendarUpdate, 200);
    expect(updatedCalendar).toMatchObject({
      timezone: "Europe/London",
      version: 2,
    });

    const strangerCalendar = await stranger.get(
      new URL(
        `/api/service-calendars/${encodeURIComponent(calendarId)}`,
        origin,
      ).toString(),
      { headers: { Origin: origin } },
    );
    await bodyAt(strangerCalendar, 404);

    const policyResponse = await mutate(
      admin,
      origin,
      "POST",
      `/api/sla-policies?workspaceId=${encodeURIComponent(workspaceId)}`,
      {
        name: "Service operations response targets",
        calendarId,
        atRiskThresholdPct: 75,
        goals: completeGoals(String(workItemType?.id)),
      },
    );
    const policy = await bodyAt(policyResponse, 200);
    const policyId = String(policy.id);
    const publishResponse = await mutate(
      admin,
      origin,
      "POST",
      `/api/sla-policies/${encodeURIComponent(policyId)}/publish`,
      {},
    );
    const published = await bodyAt(publishResponse, 200);
    expect(published.activeVersion).toMatchObject({ number: 1, calendarId });

    const slaResponse = await admin.get(
      new URL(
        `/api/work-items/${encodeURIComponent(workItemKey)}/sla`,
        origin,
      ).toString(),
      { headers: { Origin: origin } },
    );
    const sla = await bodyAt(slaResponse, 200);
    expect(sla.key).toBe(workItemKey);
    expect(
      (sla.metrics as Array<{ state: string }>).map(({ state }) => state),
    ).toEqual(["none", "none"]);

    const searchResponse = await mutate(
      admin,
      origin,
      "POST",
      "/api/work-items/search",
      {
        workspaceId,
        query: {
          entity: "work_item",
          filter: { field: "priority", op: "eq", value: "high" },
        },
        limit: 20,
      },
    );
    const search = await bodyAt(searchResponse, 200);
    expect(search.meta).toMatchObject({ total: 1 });
    expect(
      (search.data as Array<{ id: string }>).map(({ id }) => id),
    ).toContain(workItemId);

    const viewQuery = {
      entity: "work_item",
      filter: { field: "priority", op: "eq", value: "high" },
    };
    const viewResponse = await mutate(admin, origin, "POST", "/api/views", {
      workspaceId,
      name: "High priority service queue",
      scope: "project",
      scopeId: projectId,
      visibility: "private",
      layout: "list",
      query: viewQuery,
    });
    const view = await bodyAt(viewResponse, 200);
    const viewId = String(view.id);

    const unrelatedViewResponse = await mutate(
      admin,
      origin,
      "POST",
      "/api/views",
      {
        workspaceId,
        name: "Unrelated service queue",
        scope: "project",
        scopeId: projectId,
        visibility: "private",
        layout: "list",
        query: { entity: "work_item" },
      },
    );
    const unrelatedView = await bodyAt(unrelatedViewResponse, 200);
    const unrelatedViewId = String(unrelatedView.id);

    const runView = await admin.post(
      new URL(
        `/api/views/${encodeURIComponent(viewId)}/run?limit=20`,
        origin,
      ).toString(),
      { headers: { Origin: origin } },
    );
    const run = await bodyAt(runView, 200);
    expect((run.data as Array<{ id: string }>).map(({ id }) => id)).toContain(
      workItemId,
    );
    const countView = await admin.get(
      new URL(
        `/api/views/${encodeURIComponent(viewId)}/count`,
        origin,
      ).toString(),
      { headers: { Origin: origin } },
    );
    expect(await bodyAt(countView, 200)).toMatchObject({ count: 1 });

    const strangerView = await stranger.get(
      new URL(`/api/views/${encodeURIComponent(viewId)}`, origin).toString(),
      { headers: { Origin: origin } },
    );
    await bodyAt(strangerView, 404);

    const deleteRequest = await mutate(
      admin,
      origin,
      "DELETE",
      `/api/views/${encodeURIComponent(viewId)}`,
    );
    const deletion = await bodyAt(deleteRequest, 202);
    const pendingActionId = String(deletion.pendingActionId);
    const beforeApproval = await admin.get(
      new URL(`/api/views/${encodeURIComponent(viewId)}`, origin).toString(),
      { headers: { Origin: origin } },
    );
    await bodyAt(beforeApproval, 200);

    const ownPending = await admin.get(
      new URL(
        `/api/me/pending-actions/${encodeURIComponent(pendingActionId)}`,
        origin,
      ).toString(),
      { headers: { Origin: origin } },
    );
    expect(await bodyAt(ownPending, 200)).toMatchObject({
      state: "pending",
      approvalSupported: true,
      targetType: "saved_view",
      confirmation: "click",
    });

    const strangerPending = await stranger.get(
      new URL(
        `/api/me/pending-actions/${encodeURIComponent(pendingActionId)}`,
        origin,
      ).toString(),
      { headers: { Origin: origin } },
    );
    await bodyAt(strangerPending, 404);
    const strangerApproval = await mutate(
      stranger,
      origin,
      "POST",
      `/api/me/pending-actions/${encodeURIComponent(pendingActionId)}/approve`,
      { typedName: "" },
    );
    await bodyAt(strangerApproval, 404);

    const approved = await mutate(
      admin,
      origin,
      "POST",
      `/api/me/pending-actions/${encodeURIComponent(pendingActionId)}/approve`,
      { typedName: "" },
    );
    expect(await bodyAt(approved, 200)).toEqual({
      id: pendingActionId,
      state: "executed",
    });

    const deletedView = await admin.get(
      new URL(`/api/views/${encodeURIComponent(viewId)}`, origin).toString(),
      { headers: { Origin: origin } },
    );
    await bodyAt(deletedView, 404);
    const preservedView = await admin.get(
      new URL(
        `/api/views/${encodeURIComponent(unrelatedViewId)}`,
        origin,
      ).toString(),
      { headers: { Origin: origin } },
    );
    await bodyAt(preservedView, 200);

    const calendarAudit = await client.query<{ action: string }>(
      "SELECT action FROM audit_log WHERE entity_id = $1",
      [calendarId],
    );
    expect(calendarAudit.rows.map(({ action }) => action)).toEqual(
      expect.arrayContaining([
        "service_calendar.created",
        "service_calendar.updated",
      ]),
    );
    const policyAudit = await client.query<{ action: string }>(
      "SELECT action FROM audit_log WHERE entity_id = $1",
      [policyId],
    );
    expect(policyAudit.rows.map(({ action }) => action)).toEqual(
      expect.arrayContaining(["sla_policy.created", "sla_policy.published"]),
    );
    const deletionAudit = await client.query<{
      action: string;
      entity_id: string;
    }>(
      `SELECT action, entity_id FROM audit_log
        WHERE entity_id IN ($1, $2)
        ORDER BY action, entity_id`,
      [pendingActionId, viewId],
    );
    expect(deletionAudit.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "pending_action.decided",
          entity_id: pendingActionId,
        }),
        expect.objectContaining({
          action: "pending_action.executed",
          entity_id: pendingActionId,
        }),
        expect.objectContaining({
          action: "saved_view.deleted",
          entity_id: viewId,
        }),
      ]),
    );
    const outbox = await client.query<{ kind: string }>(
      "SELECT kind FROM outbox WHERE kind = ANY($1::text[])",
      [
        [
          "service_calendar.created",
          "service_calendar.updated",
          "sla_policy.created",
          "sla_policy.published",
          "work_item.created",
          "saved_view.deleted",
          "pending_action.decided",
          "pending_action.executed",
        ],
      ],
    );
    expect(outbox.rows.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([
        "service_calendar.created",
        "service_calendar.updated",
        "sla_policy.created",
        "sla_policy.published",
        "work_item.created",
        "saved_view.deleted",
        "pending_action.decided",
        "pending_action.executed",
      ]),
    );
  } finally {
    await Promise.allSettled([
      admin.dispose(),
      stranger.dispose(),
      client.end(),
    ]);
  }
}

test("service operations work through the production API and preserve authorization and deletion lifecycle", async () => {
  await withMfaCsrfApp((fixture) => runJourney(fixture));
});
