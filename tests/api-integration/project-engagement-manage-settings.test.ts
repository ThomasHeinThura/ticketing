/**
 * #766: `PUT /api/project/{id}` engagement fields (`kind`, `supportLevel`,
 * `serviceCalendarId`) need the STRICT canonical `project:manage_settings` capability
 * (rbac.md: "SLA and calendar assignment"), on top of the route's legacy `project:update`
 * baseline, exactly like CA-2's `defaultCommentVisibility`. A lead-like caller (legacy
 * `project:update`, canonical role without `manage_settings`) is refused with nothing
 * written; the same caller updating only non-engagement fields still succeeds; an API key
 * must carry the scope and can never widen a role that lacks it. Health is unaffected.
 */
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { createCalendar } from "../../apps/api/src/service-calendar/repository";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectManageAccess,
} from "./helpers/fixtures";

type App = ReturnType<typeof createApp>["app"];

function putProject(
  app: App,
  projectId: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return app.request(`/api/project/${projectId}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function fullBody(
  project: typeof schema.projectTable.$inferSelect,
  extra: Record<string, unknown> = {},
) {
  return {
    name: project.name,
    icon: project.icon ?? "Folder",
    slug: project.slug,
    description: project.description ?? "",
    ...extra,
  };
}

async function readProject(projectId: string) {
  const [row] = await db
    .select()
    .from(schema.projectTable)
    .where(eq(schema.projectTable.id, projectId));
  if (!row) throw new Error("project row missing");
  return row;
}

/**
 * A member of `role` whose stored legacy `workspace_role.permission` map is replaced with
 * `legacy`, so the route's `project:update` middleware can be made to pass independently of
 * what the canonical role holds.
 */
async function actorWithLegacyMap(
  role: string,
  legacy: Record<string, string[]>,
) {
  const actor = await createWorkspaceMember({ role });
  const now = new Date();
  const existing = await db
    .select({ id: schema.workspaceRoleTable.id })
    .from(schema.workspaceRoleTable)
    .where(eq(schema.workspaceRoleTable.workspaceId, actor.workspace.id));
  if (existing.length > 0) {
    await db
      .update(schema.workspaceRoleTable)
      .set({ permission: JSON.stringify(legacy) })
      .where(eq(schema.workspaceRoleTable.workspaceId, actor.workspace.id));
  } else {
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: actor.workspace.id,
      role,
      permission: JSON.stringify(legacy),
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  const { project } = await createProjectFixture({
    workspaceId: actor.workspace.id,
  });
  await grantProjectManageAccess(actor.user.id, project.id);
  return { actor, project };
}

function hashApiKeyForTest(key: string) {
  return createHash("sha256")
    .update(key)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createApiKeyFor(
  userId: string,
  permissions: Record<string, string[]>,
) {
  const rawKey = `taskdesk_test_${randomUUID()}`;
  const now = new Date();
  await db.insert(schema.apikeyTable).values({
    referenceId: userId,
    userId,
    key: hashApiKeyForTest(rawKey),
    name: "default comment visibility scope test key",
    start: rawKey.slice(0, 12),
    prefix: "taskdesk",
    permissions: JSON.stringify(permissions),
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  return rawKey;
}

const LEGACY_UPDATE = { project: ["read", "update"] };

const windows = { mon: [{ from: 540, to: 1020 }] };

async function makeCalendar(workspaceId: string, actorId: string) {
  return createCalendar({
    workspaceId,
    name: "Support coverage",
    timezone: "UTC",
    windows,
    holidays: [],
    actor: { actorId, actorType: "person", apiKeyId: null },
  });
}

async function expectEngagementUnchanged(projectId: string) {
  const row = await readProject(projectId);
  expect(row.kind).toBe("project");
  expect(row.supportLevel).toBeNull();
  expect(row.serviceCalendarId).toBeNull();
  return row;
}

describe("API integration: PUT /api/project/{id} engagement fields need project:manage_settings (#766)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  // Each field alone, on a project that is currently `project` kind with no calendar.
  // The 403 is decided before PR-9 validation, so the single-field bodies are enough.
  const fieldBodies = (calendarId: string) =>
    [
      ["kind", { kind: "managed_service" }],
      ["supportLevel", { supportLevel: "L2" }],
      ["serviceCalendarId", { serviceCalendarId: calendarId }],
    ] as const;

  it.each(["member", "lead"])(
    "refuses %s (legacy project:update, no strict manage_settings) for each engagement field and writes nothing",
    async (role) => {
      const { actor, project } = await actorWithLegacyMap(role, LEGACY_UPDATE);
      const calendar = await makeCalendar(actor.workspace.id, actor.user.id);
      mockAuthenticatedSession(actor.user);
      const { app } = createApp();

      for (const [field, extra] of fieldBodies(calendar.id)) {
        const denied = await putProject(
          app,
          project.id,
          fullBody(project, { name: `Bundled ${field}`, ...extra }),
        );
        expect(denied.status, field).toBe(403);
        const row = await expectEngagementUnchanged(project.id);
        expect(row.name).toBe(project.name);
      }

      // Explicit null is still "sent" (it would clear the calendar / level).
      for (const nulled of [
        { serviceCalendarId: null },
        { supportLevel: null },
      ]) {
        const denyNull = await putProject(
          app,
          project.id,
          fullBody(project, nulled),
        );
        expect(denyNull.status, JSON.stringify(nulled)).toBe(403);
        await expectEngagementUnchanged(project.id);
      }

      // The same caller updating only name keeps today's behaviour.
      const plain = await putProject(app, project.id, {
        ...fullBody(project),
        name: "Plain rename still works",
      });
      expect(plain.status).toBe(200);
      const after = await readProject(project.id);
      expect(after.name).toBe("Plain rename still works");
      expect(after.kind).toBe("project");
    },
  );

  it.each(["owner", "admin", "manager"])(
    "lets the %s role set the engagement configuration",
    async (role) => {
      const { actor, project } = await actorWithLegacyMap(role, LEGACY_UPDATE);
      const calendar = await makeCalendar(actor.workspace.id, actor.user.id);
      mockAuthenticatedSession(actor.user);
      const { app } = createApp();

      const response = await putProject(
        app,
        project.id,
        fullBody(project, {
          kind: "managed_service",
          supportLevel: "L2",
          serviceCalendarId: calendar.id,
        }),
      );
      expect(response.status).toBe(200);
      const row = await readProject(project.id);
      expect(row.kind).toBe("managed_service");
      expect(row.supportLevel).toBe("L2");
      expect(row.serviceCalendarId).toBe(calendar.id);
    },
  );

  it("keeps health on project:update for a lead-like caller", async () => {
    const { actor, project } = await actorWithLegacyMap("lead", LEGACY_UPDATE);
    mockAuthenticatedSession(actor.user);
    const { app } = createApp();

    const response = await app.request(`/api/project/${project.id}/health`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ health: "amber" }),
    });
    expect(response.status).toBe(200);
  });

  describe("API keys", () => {
    it("denies a key scoped to project:update only for engagement fields, but allows a plain update", async () => {
      const { actor, project } = await actorWithLegacyMap(
        "admin",
        LEGACY_UPDATE,
      );
      mockAuthenticatedSession(actor.user);
      const { app } = createApp();
      const rawKey = await createApiKeyFor(actor.user.id, {
        project: ["read", "update"],
      });

      const denied = await putProject(
        app,
        project.id,
        fullBody(project, { supportLevel: "L1" }),
        { "x-api-key": rawKey },
      );
      expect(denied.status).toBe(403);
      expect(await denied.text()).toContain("Insufficient API key scope");
      await expectEngagementUnchanged(project.id);

      const plain = await putProject(
        app,
        project.id,
        { ...fullBody(project), name: "Key rename" },
        { "x-api-key": rawKey },
      );
      expect(plain.status).toBe(200);
    });

    it("allows a key that also carries the project:manage_settings scope", async () => {
      const { actor, project } = await actorWithLegacyMap(
        "admin",
        LEGACY_UPDATE,
      );
      const calendar = await makeCalendar(actor.workspace.id, actor.user.id);
      mockAuthenticatedSession(actor.user);
      const { app } = createApp();
      const rawKey = await createApiKeyFor(actor.user.id, {
        project: ["read", "update", "manage_settings"],
      });

      const allowed = await putProject(
        app,
        project.id,
        fullBody(project, {
          kind: "managed_service",
          supportLevel: "L3",
          serviceCalendarId: calendar.id,
        }),
        { "x-api-key": rawKey },
      );
      expect(allowed.status).toBe(200);
      const row = await readProject(project.id);
      expect(row.kind).toBe("managed_service");
      expect(row.supportLevel).toBe("L3");
    });

    it("never lets a key's manage_settings scope widen a lead-like role", async () => {
      const { actor, project } = await actorWithLegacyMap(
        "lead",
        LEGACY_UPDATE,
      );
      mockAuthenticatedSession(actor.user);
      const { app } = createApp();
      const rawKey = await createApiKeyFor(actor.user.id, {
        project: ["read", "update", "manage_settings"],
      });

      const denied = await putProject(
        app,
        project.id,
        fullBody(project, { kind: "managed_service" }),
        { "x-api-key": rawKey },
      );
      expect(denied.status).toBe(403);
      await expectEngagementUnchanged(project.id);
    });
  });
});

describe("plain updates never write engagement columns (#767 security review, finding 2)", () => {
  beforeEach(async () => resetTestDatabase());

  it("a project:update rename issues an UPDATE that leaves kind, support level and calendar alone", async () => {
    const { actor, project } = await actorWithLegacyMap("lead", LEGACY_UPDATE);
    mockAuthenticatedSession(actor.user);
    const { app } = createApp();

    const statements: string[] = [];
    const originalQuery = Client.prototype.query;
    const spy = vi
      .spyOn(Client.prototype, "query")
      .mockImplementation(function (this: Client, ...args: unknown[]) {
        const [query] = args;
        const text =
          typeof query === "string"
            ? query
            : query && typeof query === "object" && "text" in query
              ? String((query as { text: unknown }).text)
              : "";
        if (/^\s*update\s+"project"\s/i.test(text)) statements.push(text);
        return (originalQuery as (...a: unknown[]) => unknown).apply(
          this,
          args,
        );
      } as unknown as typeof Client.prototype.query);
    try {
      const renamed = await putProject(app, project.id, {
        ...fullBody(project),
        name: "Renamed without engagement fields",
      });
      expect(renamed.status).toBe(200);
    } finally {
      spy.mockRestore();
    }

    expect(statements.length).toBeGreaterThan(0);
    for (const text of statements) {
      // Only the SET clause: RETURNING lists every column.
      const setClause = text.split(/\swhere\s/i)[0] ?? text;
      expect(setClause).not.toMatch(
        /"kind"|"support_level"|"service_calendar_id"/,
      );
    }
  });
});
