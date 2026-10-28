import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";
import { projectKey } from "./helpers/project-key";

const OUTBOX_FAIL_FUNCTION = "td_project_domain_events_outbox_fail";

function hashApiKeyForTest(key: string): string {
  return createHash("sha256")
    .update(key)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createProjectApiKey(userId: string) {
  const rawKey = `taskdesk_test_${randomUUID()}`;
  const now = new Date();
  const [key] = await db
    .insert(schema.apikeyTable)
    .values({
      referenceId: userId,
      userId,
      key: hashApiKeyForTest(rawKey),
      name: "Project domain-event test key",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      permissions: JSON.stringify({ project: ["create"] }),
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.apikeyTable.id });
  if (!key) throw new Error("Project test API key row missing");
  return { id: key.id, name: "Project domain-event test key", rawKey };
}

async function armProjectCreatedOutboxFailure() {
  await db.execute(
    sql.raw(`
      CREATE OR REPLACE FUNCTION ${OUTBOX_FAIL_FUNCTION}() RETURNS trigger AS $$
      BEGIN
        IF NEW.kind = 'project.created' THEN
          RAISE EXCEPTION 'project domain event probe: injected outbox insert failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TRIGGER ${OUTBOX_FAIL_FUNCTION}
      BEFORE INSERT ON "outbox"
      FOR EACH ROW EXECUTE FUNCTION ${OUTBOX_FAIL_FUNCTION}();
    `),
  );
}

async function disarmProjectCreatedOutboxFailure() {
  await db.execute(
    sql.raw(`DROP TRIGGER IF EXISTS ${OUTBOX_FAIL_FUNCTION} ON "outbox"`),
  );
  await db.execute(
    sql.raw(`DROP FUNCTION IF EXISTS ${OUTBOX_FAIL_FUNCTION}()`),
  );
}

async function fixture() {
  const member = await createWorkspaceMember({ role: "admin" });
  const { app } = createApp();
  mockAuthenticatedSession(member.user);
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, member.user.id))
    .limit(1);
  if (!person) throw new Error("Project event actor person missing");
  const [organisation] = await db
    .insert(schema.organisationTable)
    .values({
      key: `project-events-${randomUUID()}`,
      name: "Project event customer",
    })
    .returning();
  if (!organisation) throw new Error("Project event organisation missing");
  return { ...member, app, person, organisation };
}

function createProjectRequest(
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
  slug: string,
  organisationId: string,
  apiKey?: string,
) {
  return app.request("/api/project", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    body: JSON.stringify({
      workspaceId,
      name: "Domain event project",
      icon: "Folder",
      slug,
      organisationId,
    }),
  });
}

async function projectWriteCounts() {
  const [
    projects,
    claims,
    columns,
    states,
    memberships,
    grants,
    audits,
    events,
  ] = await Promise.all([
    db.select().from(schema.projectTable),
    db.select().from(schema.projectSlugClaimTable),
    db.select().from(schema.columnTable),
    db.select().from(schema.stateTable),
    db.select().from(schema.membershipTable),
    db.select().from(schema.membershipGrantTable),
    db.select().from(schema.auditLogTable),
    db.select().from(schema.outboxTable),
  ]);
  return [
    projects.length,
    claims.length,
    columns.length,
    states.length,
    memberships.length,
    grants.length,
    audits.length,
    events.length,
  ];
}

describe("project domain event envelopes", () => {
  beforeEach(async () => resetTestDatabase());
  afterEach(async () => disarmProjectCreatedOutboxFailure());

  it("writes exactly one registered project.created envelope in the create transaction", async () => {
    const f = await fixture();
    const slug = projectKey();
    const response = await createProjectRequest(
      f.app,
      f.workspace.id,
      slug,
      f.organisation.id,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const project =
      (await response.json()) as typeof schema.projectTable.$inferSelect;

    const events = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "project.created"));
    expect(events).toHaveLength(1);
    const event = events[0];
    if (!event) throw new Error("project.created event missing");
    expect(event.eventId).toBe((event.payload as { id: string }).id);
    expect(event).toMatchObject({
      workspaceId: f.workspace.id,
      organisationId: f.organisation.id,
      state: "pending",
    });
    expect(event.payload).toMatchObject({
      id: event.eventId,
      kind: "project.created",
      actor: { type: "person", id: f.person.id, name: f.user.name },
      scope: {
        workspaceId: f.workspace.id,
        organisationId: f.organisation.id,
        projectId: project.id,
      },
      payload: {
        key: project.slug,
        url: `/agent/projects/${encodeURIComponent(project.slug)}`,
        kind: project.kind,
      },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    });
  });

  it("attributes an API-key project creation to the authenticated key without exposing its secret", async () => {
    const f = await fixture();
    const key = await createProjectApiKey(f.user.id);
    mockAnonymousSession();
    const response = await createProjectRequest(
      f.app,
      f.workspace.id,
      projectKey(),
      f.organisation.id,
      key.rawKey,
    );
    expect(response.status, await response.clone().text()).toBe(200);

    const events = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "project.created"));
    expect(events).toHaveLength(1);
    const event = events[0];
    if (!event) throw new Error("project.created event missing");
    expect(event.payload).toMatchObject({
      actor: { type: "api_key", id: key.id, name: key.name },
    });
    expect(JSON.stringify(event.payload)).not.toContain(key.rawKey);
  });

  it("keeps the existing owner check for malformed API keys and emits no project event", async () => {
    const f = await fixture();
    const key = await createProjectApiKey(f.user.id);
    await db
      .update(schema.apikeyTable)
      .set({ referenceId: `missing-owner-${randomUUID()}` })
      .where(eq(schema.apikeyTable.id, key.id));
    mockAnonymousSession();

    const response = await createProjectRequest(
      f.app,
      f.workspace.id,
      projectKey(),
      f.organisation.id,
      key.rawKey,
    );
    expect(response.status).toBe(401);
    expect(
      await db
        .select()
        .from(schema.projectTable)
        .where(eq(schema.projectTable.workspaceId, f.workspace.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.kind, "project.created")),
    ).toHaveLength(0);
  });

  it("writes project.archived only for the first actual archive transition", async () => {
    const f = await fixture();
    const created = await createProjectRequest(
      f.app,
      f.workspace.id,
      projectKey(),
      f.organisation.id,
    );
    expect(created.status, await created.clone().text()).toBe(200);
    const project =
      (await created.json()) as typeof schema.projectTable.$inferSelect;

    const archive = () =>
      f.app.request(`/api/project/${project.id}/archive`, { method: "PUT" });
    const first = await archive();
    expect(first.status, await first.clone().text()).toBe(200);
    const firstResult = (await first.json()) as {
      archivedAt: string | null;
    };
    expect(firstResult.archivedAt).not.toBeNull();

    const second = await archive();
    expect(second.status, await second.clone().text()).toBe(200);
    const secondResult = (await second.json()) as {
      archivedAt: string | null;
    };
    expect(secondResult.archivedAt).toEqual(firstResult.archivedAt);

    const events = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "project.archived"));
    expect(events).toHaveLength(1);
    const event = events[0];
    if (!event) throw new Error("project.archived event missing");
    expect(event.eventId).toBe((event.payload as { id: string }).id);
    expect(event).toMatchObject({
      workspaceId: f.workspace.id,
      organisationId: f.organisation.id,
      state: "pending",
    });
    expect(event.payload).toMatchObject({
      kind: "project.archived",
      actor: { type: "person", id: f.person.id, name: f.user.name },
      scope: {
        workspaceId: f.workspace.id,
        organisationId: f.organisation.id,
        projectId: project.id,
      },
      payload: {
        key: project.slug,
        url: `/agent/projects/${encodeURIComponent(project.slug)}`,
      },
    });
  });

  it("leaves no project defaults, grants, or event when slug uniqueness rejects creation", async () => {
    const f = await fixture();
    const slug = projectKey();
    const first = await createProjectRequest(
      f.app,
      f.workspace.id,
      slug,
      f.organisation.id,
    );
    expect(first.status, await first.clone().text()).toBe(200);
    const before = await projectWriteCounts();

    const duplicate = await createProjectRequest(
      f.app,
      f.workspace.id,
      slug,
      f.organisation.id,
    );
    expect(duplicate.status, await duplicate.clone().text()).toBe(409);
    expect(await projectWriteCounts()).toEqual(before);
  });

  it("rolls project, defaults, creator membership, and event back when the outbox insert fails", async () => {
    const f = await fixture();
    const before = await projectWriteCounts();
    await armProjectCreatedOutboxFailure();

    const response = await createProjectRequest(
      f.app,
      f.workspace.id,
      projectKey(),
      f.organisation.id,
    );
    expect(response.status, await response.clone().text()).toBe(500);
    await disarmProjectCreatedOutboxFailure();
    expect(await projectWriteCounts()).toEqual(before);

    expect(
      await db
        .select()
        .from(schema.projectTable)
        .where(eq(schema.projectTable.workspaceId, f.workspace.id)),
    ).toHaveLength(0);
  });
});
