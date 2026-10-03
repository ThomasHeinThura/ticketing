import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { createPolicy } from "../../apps/api/src/sla-policy/repository";
import { mockAuthenticatedSession } from "./helpers/auth";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

const windows = {
  mon: [{ from: 540, to: 1020 }],
  tue: [{ from: 540, to: 1020 }],
  wed: [{ from: 540, to: 1020 }],
  thu: [{ from: 540, to: 1020 }],
  fri: [{ from: 540, to: 1020 }],
};
async function prepareCookieSession(userId: string) {
  const now = new Date();
  const token = `sla-policy-${randomUUID()}`;
  const id = `session-${userId}`;
  await db.insert(schema.sessionTable).values({
    id,
    token,
    userId,
    portal: "agent",
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
  });
  return `__Host-tdk_agent_session=${token}`;
}

async function createCalendar(workspaceId: string) {
  const [calendar] = await db
    .insert(schema.serviceCalendarTable)
    .values({
      workspaceId,
      name: "Weekday support",
      timezone: "UTC",
      windows,
      holidays: [],
    })
    .returning();
  if (!calendar)
    throw new Error("SLA policy test calendar insert returned no row");
  return calendar;
}

async function createType(workspaceId: string) {
  const [type] = await db
    .insert(schema.workItemTypeTable)
    .values({
      workspaceId,
      key: `type-${randomUUID()}`,
      name: "Incident",
      category: "service",
    })
    .returning();
  if (!type) throw new Error("SLA policy test type insert returned no row");
  return type;
}

function fullMatrix(workItemTypeId: string) {
  return (["first_response", "resolution"] as const).flatMap((metric) =>
    (["low", "medium", "high", "urgent"] as const).map((priority, index) => ({
      metric,
      workItemTypeId,
      priority,
      targetMinutes: 60 + index * 60,
    })),
  );
}

describe("API integration: SLA policy authoring contract", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(async () => {
    await db.execute(
      sql`DROP TRIGGER IF EXISTS sla_policy_audit_probe ON audit_log`,
    );
    await db.execute(
      sql`DROP FUNCTION IF EXISTS sla_policy_audit_probe_function()`,
    );
  });

  it("creates incomplete drafts, rejects incomplete publish, and keeps scope in the URL", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(owner.user);
    const sessionCookie = await prepareCookieSession(owner.user.id);
    const { app } = createApp();
    const calendar = await createCalendar(owner.workspace.id);
    const type = await createType(owner.workspace.id);
    const foreignWorkspace = await createWorkspaceMember({ role: "admin" });
    const foreignCalendar = await createCalendar(foreignWorkspace.workspace.id);
    const create = (workspaceId: string, body: Record<string, unknown>) =>
      csrfRequest(
        app,
        `/api/sla-policies?workspaceId=${workspaceId}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: sessionCookie,
          },
          body: JSON.stringify(body),
        },
        sessionCookie,
      );

    const crossWorkspace = await create(owner.workspace.id, {
      name: "Invalid scope",
      calendarId: foreignCalendar.id,
      atRiskThresholdPct: 75,
      goals: [],
    });
    expect(crossWorkspace.status).toBe(422);
    const bodyOverride = await create(owner.workspace.id, {
      name: "Invalid body scope",
      calendarId: calendar.id,
      atRiskThresholdPct: 75,
      goals: [],
      workspaceId: foreignWorkspace.workspace.id,
    });
    expect(bodyOverride.status).toBe(400);
    const duplicatedTuple = {
      metric: "first_response",
      workItemTypeId: type.id,
      priority: "high",
      targetMinutes: 120,
    };
    const invalidGoals = await create(owner.workspace.id, {
      name: "Invalid goals",
      calendarId: calendar.id,
      atRiskThresholdPct: 75,
      goals: [duplicatedTuple, duplicatedTuple],
    });
    expect(invalidGoals.status).toBe(422);
    const invalidTarget = await create(owner.workspace.id, {
      name: "Invalid target",
      calendarId: calendar.id,
      atRiskThresholdPct: 75,
      goals: [{ ...duplicatedTuple, targetMinutes: 0 }],
    });
    expect(invalidTarget.status).toBe(422);
    const invalidMetric = await create(owner.workspace.id, {
      name: "Invalid metric",
      calendarId: calendar.id,
      atRiskThresholdPct: 75,
      goals: [{ ...duplicatedTuple, metric: "unknown_metric" }],
    });
    expect(invalidMetric.status).toBe(422);

    const created = await create(owner.workspace.id, {
      name: "Support response",
      calendarId: calendar.id,
      atRiskThresholdPct: 75,
      goals: [
        {
          metric: "first_response",
          workItemTypeId: type.id,
          priority: "high",
          targetMinutes: 120,
        },
      ],
    });
    expect(created.status).toBe(200);
    const policy = (await created.json()) as {
      id: string;
      version: number;
      activeVersion: unknown;
      draftVersion: { calendarId: string; goals: unknown[] };
    };
    expect(policy.version).toBe(1);
    expect(policy.activeVersion).toBeNull();
    expect(policy.draftVersion.calendarId).toBe(calendar.id);
    expect(policy.draftVersion.goals).toHaveLength(1);

    const publish = await csrfRequest(
      app,
      `/api/sla-policies/${policy.id}/publish`,
      { method: "POST", headers: { cookie: sessionCookie } },
      sessionCookie,
    );
    expect(publish.status).toBe(422);
    const detail = await app.request(`/api/sla-policies/${policy.id}`);
    expect(detail.status).toBe(200);
    expect(
      ((await detail.json()) as typeof policy).draftVersion.goals,
    ).toHaveLength(1);

    const list = await app.request(
      `/api/sla-policies?workspaceId=${owner.workspace.id}&limit=1`,
    );
    expect(list.status).toBe(200);
    expect(((await list.json()) as { data: unknown[] }).data).toHaveLength(1);
  });

  it("publishes snapshots, enforces If-Match, and clones an immutable active version for edits", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(owner.user);
    const sessionCookie = await prepareCookieSession(owner.user.id);
    const { app } = createApp();
    const calendar = await createCalendar(owner.workspace.id);
    const type = await createType(owner.workspace.id);
    const createResponse = await csrfRequest(
      app,
      `/api/sla-policies?workspaceId=${owner.workspace.id}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sessionCookie },
        body: JSON.stringify({
          name: "Response policy",
          calendarId: calendar.id,
          atRiskThresholdPct: 75,
          goals: fullMatrix(type.id),
        }),
      },
      sessionCookie,
    );
    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as {
      id: string;
      version: number;
    };

    const stalePublish = await csrfRequest(
      app,
      `/api/sla-policies/${created.id}/publish`,
      {
        method: "POST",
        headers: { cookie: sessionCookie, "if-match": '"2"' },
      },
      sessionCookie,
    );
    expect(stalePublish.status).toBe(409);
    const publish = await csrfRequest(
      app,
      `/api/sla-policies/${created.id}/publish`,
      {
        method: "POST",
        headers: { cookie: sessionCookie, "if-match": '"1"' },
      },
      sessionCookie,
    );
    expect(publish.status).toBe(200);
    const published = (await publish.json()) as {
      version: number;
      activeVersion: {
        id: string;
        number: number;
        calendarId: string;
        goals: unknown[];
      };
      draftVersion: null;
    };
    expect(published.version).toBe(2);
    expect(published.activeVersion.number).toBe(1);
    expect(published.activeVersion.calendarId).toBe(calendar.id);
    expect(published.activeVersion.goals).toHaveLength(8);
    expect(published.draftVersion).toBeNull();

    const edit = await csrfRequest(
      app,
      `/api/sla-policies/${created.id}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
          "if-match": '"2"',
        },
        body: JSON.stringify({ atRiskThresholdPct: 80 }),
      },
      sessionCookie,
    );
    expect(edit.status).toBe(200);
    const edited = (await edit.json()) as {
      version: number;
      activeVersion: {
        id: string;
        atRiskThresholdPct: number;
        goals: unknown[];
      };
      draftVersion: {
        id: string;
        number: number;
        atRiskThresholdPct: number;
        goals: unknown[];
      };
    };
    expect(edited.version).toBe(3);
    expect(edited.activeVersion.id).toBe(published.activeVersion.id);
    expect(edited.activeVersion.atRiskThresholdPct).toBe(75);
    expect(edited.activeVersion.goals).toHaveLength(8);
    expect(edited.draftVersion.number).toBe(2);
    expect(edited.draftVersion.atRiskThresholdPct).toBe(80);
    expect(edited.draftVersion.goals).toHaveLength(8);
    const auditRows = await db
      .select({
        action: schema.auditLogTable.action,
        after: schema.auditLogTable.after,
      })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, created.id));
    expect(auditRows.map((row) => row.action)).toEqual([
      "sla_policy.created",
      "sla_policy.published",
      "sla_policy.updated",
    ]);
    expect(auditRows[0]?.after).toEqual({
      policyId: created.id,
      versionId: expect.any(String),
    });
    expect(auditRows[2]?.after).toMatchObject({
      policyId: created.id,
      changedFields: ["atRiskThresholdPct"],
      atRiskThresholdPct: 80,
    });
    expect(auditRows[2]?.after).not.toHaveProperty("calendarId");
  });

  it("commits a policy when a real audit INSERT trigger fails inside its savepoint", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const calendar = await createCalendar(owner.workspace.id);
    await db.execute(
      sql.raw(`
      CREATE FUNCTION sla_policy_audit_probe_function() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'SLA policy audit probe';
      END;
      $$ LANGUAGE plpgsql;
    `),
    );
    await db.execute(
      sql.raw(
        "CREATE TRIGGER sla_policy_audit_probe BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION sla_policy_audit_probe_function()",
      ),
    );

    const result = await createPolicy(
      {
        workspaceId: owner.workspace.id,
        name: "Audit fault policy",
        calendarId: calendar.id,
        atRiskThresholdPct: 75,
        goals: [],
      },
      {
        actorId: owner.user.id,
        actorType: "person",
        apiKeyId: null,
      },
    );

    expect(result?.name).toBe("Audit fault policy");
    const persisted = await db
      .select({ id: schema.slaPolicyTable.id })
      .from(schema.slaPolicyTable)
      .where(
        and(
          eq(schema.slaPolicyTable.workspaceId, owner.workspace.id),
          eq(schema.slaPolicyTable.name, "Audit fault policy"),
        ),
      );
    expect(persisted).toHaveLength(1);
    expect(result?.draftVersion?.goals).toEqual([]);
    await db.execute(
      sql.raw("DROP TRIGGER IF EXISTS sla_policy_audit_probe ON audit_log"),
    );
    await db.execute(
      sql.raw("DROP FUNCTION IF EXISTS sla_policy_audit_probe_function()"),
    );
  });
});
