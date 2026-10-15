/**
 * CA-2: `PUT /api/project/{id}` accepts `defaultCommentVisibility`.
 *
 * The route's declared baseline is the legacy `project:update` middleware; the new field
 * additionally needs the STRICT canonical `project:manage_settings` capability, checked in
 * the handler after body validation (#708: the legacy better-auth map grants more than
 * rbac.md's matrix). These tests pin both halves and the cases where they disagree:
 *
 * - a role whose stored legacy map holds `project:update` but whose canonical role does not
 *   hold `project:manage_settings` (member, lead) passes the middleware yet gets 403 when it
 *   sends the field, and nothing is written;
 * - the same caller omitting the field keeps today's update behaviour;
 * - an API key must carry the `project:manage_settings` scope as well.
 */
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectManageAccess,
  grantProjectRole,
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
  projectCapabilities?: readonly string[] | null,
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
  // `undefined` preserves the helper's broad default; an array installs a precise project
  // override; `null` deliberately leaves no project membership (for the real customer case).
  if (projectCapabilities === undefined) {
    await grantProjectManageAccess(actor.user.id, project.id);
  } else if (projectCapabilities !== null) {
    await grantProjectRole(actor.user.id, project.id, projectCapabilities);
  }
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
const NARROW_PROJECT_UPDATE = ["project:read", "project:update"] as const;

describe("API integration: PUT /api/project/{id} defaultCommentVisibility (CA-2)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("seeds internal and the project response exposes the current default", async () => {
    const { actor, project } = await actorWithLegacyMap("admin", LEGACY_UPDATE);
    await grantProjectRole(actor.user.id, project.id, ["project:read"]);
    mockAuthenticatedSession(actor.user);
    const { app } = createApp();

    const response = await app.request(`/api/project/${project.id}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      defaultCommentVisibility: string;
    };
    expect(body.defaultCommentVisibility).toBe("internal");
  });

  it.each([
    ["owner", "public"],
    ["admin", "public"],
    // A manager whose stored legacy map holds project:update: strict and legacy agree.
    ["manager", "public"],
  ] as const)(
    "lets the %s role set the default to %s and persists it",
    async (role, value) => {
      const { actor, project } = await actorWithLegacyMap(role, LEGACY_UPDATE);
      mockAuthenticatedSession(actor.user);
      const { app } = createApp();

      const response = await putProject(
        app,
        project.id,
        fullBody(project, { defaultCommentVisibility: value }),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        defaultCommentVisibility: string;
      };
      expect(body.defaultCommentVisibility).toBe(value);
      expect((await readProject(project.id)).defaultCommentVisibility).toBe(
        value,
      );
    },
  );

  it("can switch back from public to internal", async () => {
    const { actor, project } = await actorWithLegacyMap("admin", LEGACY_UPDATE);
    await db
      .update(schema.projectTable)
      .set({ defaultCommentVisibility: "public" })
      .where(eq(schema.projectTable.id, project.id));
    mockAuthenticatedSession(actor.user);
    const { app } = createApp();

    const response = await putProject(
      app,
      project.id,
      fullBody(project, { defaultCommentVisibility: "internal" }),
    );
    expect(response.status).toBe(200);
    expect((await readProject(project.id)).defaultCommentVisibility).toBe(
      "internal",
    );
  });

  it("leaves the default untouched when the field is omitted", async () => {
    const { actor, project } = await actorWithLegacyMap("admin", LEGACY_UPDATE);
    await db
      .update(schema.projectTable)
      .set({ defaultCommentVisibility: "public" })
      .where(eq(schema.projectTable.id, project.id));
    mockAuthenticatedSession(actor.user);
    const { app } = createApp();

    const response = await putProject(app, project.id, {
      ...fullBody(project),
      name: "Renamed without touching visibility",
    });
    expect(response.status).toBe(200);
    const row = await readProject(project.id);
    expect(row.name).toBe("Renamed without touching visibility");
    expect(row.defaultCommentVisibility).toBe("public");
  });

  it.each(["private", "PUBLIC", "", null, 1, true])(
    "rejects the invalid value %j and changes nothing",
    async (value) => {
      const { actor, project } = await actorWithLegacyMap(
        "admin",
        LEGACY_UPDATE,
      );
      mockAuthenticatedSession(actor.user);
      const { app } = createApp();

      const response = await putProject(
        app,
        project.id,
        fullBody(project, {
          name: "Should not be written",
          defaultCommentVisibility: value,
        }),
      );

      // The shared request-validation hook answers every malformed body with 400
      // (apps/api/src/openapi.ts); this route's 422 is reserved for PR-9 / calendar rules.
      expect(response.status).toBe(400);
      const row = await readProject(project.id);
      expect(row.defaultCommentVisibility).toBe("internal");
      expect(row.name).toBe(project.name);
    },
  );

  // The legacy statement map says yes (project:update is stored for the role), the strict
  // canonical role says no: the exact #708 divergence class.
  it.each(["member", "lead"])(
    "refuses %s (legacy project:update, no strict project:manage_settings) with 403 and writes nothing",
    async (role) => {
      const { actor, project } = await actorWithLegacyMap(
        role,
        LEGACY_UPDATE,
        NARROW_PROJECT_UPDATE,
      );
      mockAuthenticatedSession(actor.user);
      const { app } = createApp();

      const denied = await putProject(
        app,
        project.id,
        fullBody(project, {
          name: "Bundled rename must not land",
          defaultCommentVisibility: "public",
        }),
      );

      expect(denied.status).toBe(403);
      const row = await readProject(project.id);
      expect(row.defaultCommentVisibility).toBe("internal");
      expect(row.name).toBe(project.name);

      // Omitting the field keeps today's update behaviour for the same caller.
      const plain = await putProject(app, project.id, {
        ...fullBody(project),
        name: "Plain rename still works",
      });
      expect(plain.status).toBe(200);
      const after = await readProject(project.id);
      expect(after.name).toBe("Plain rename still works");
      expect(after.defaultCommentVisibility).toBe("internal");
    },
  );

  it("refuses a member whose legacy map lacks project:update at the route baseline", async () => {
    const { actor, project } = await actorWithLegacyMap("member", {
      project: ["create", "read"],
    });
    mockAuthenticatedSession(actor.user);
    const { app } = createApp();

    const response = await putProject(
      app,
      project.id,
      fullBody(project, { defaultCommentVisibility: "public" }),
    );
    expect(response.status).toBe(403);
    expect((await readProject(project.id)).defaultCommentVisibility).toBe(
      "internal",
    );
  });

  it("refuses a customer-side role that stored a legacy project:update claim", async () => {
    const { actor, project } = await actorWithLegacyMap(
      "customer",
      LEGACY_UPDATE,
      null,
    );
    const organisation = await db
      .insert(schema.organisationTable)
      .values({
        key: `comment-visibility-customer-${randomUUID()}`,
        name: "Comment visibility customer",
        isInternal: false,
        portalAccess: true,
      })
      .returning()
      .then(([row]) => row);
    if (!organisation) throw new Error("customer organisation missing");
    const customerRole = await db
      .insert(schema.roleTable)
      .values({
        scope: "organisation",
        key: `comment-visibility-customer-${randomUUID()}`,
        name: "Comment visibility customer",
        rank: 0,
        capabilities: [],
      })
      .returning()
      .then(([row]) => row);
    if (!customerRole) throw new Error("customer role missing");
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, actor.user.id))
      .limit(1);
    if (!person) throw new Error("customer person missing");
    await db
      .update(schema.personTable)
      .set({ side: "customer", organisationId: organisation.id })
      .where(eq(schema.personTable.id, person.id));
    await db.insert(schema.membershipTable).values({
      personId: person.id,
      scope: "organisation",
      scopeId: organisation.id,
      roleId: customerRole.id,
      seesAll: false,
    });
    await db
      .update(schema.projectTable)
      .set({ organisationId: organisation.id })
      .where(eq(schema.projectTable.id, project.id));
    mockAuthenticatedSession(actor.user);
    const { app } = createApp();

    const response = await putProject(
      app,
      project.id,
      fullBody(project, { defaultCommentVisibility: "public" }),
    );
    expect(response.status).toBe(403);
    expect((await readProject(project.id)).defaultCommentVisibility).toBe(
      "internal",
    );
  });

  describe("API keys", () => {
    it("denies a key scoped to project:update only, but still lets it update without the field", async () => {
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
        fullBody(project, { defaultCommentVisibility: "public" }),
        { "x-api-key": rawKey },
      );
      expect(denied.status).toBe(403);
      expect(await denied.text()).toContain("Insufficient API key scope");
      expect((await readProject(project.id)).defaultCommentVisibility).toBe(
        "internal",
      );

      const plain = await putProject(
        app,
        project.id,
        { ...fullBody(project), name: "Key rename" },
        { "x-api-key": rawKey },
      );
      expect(plain.status).toBe(200);
      expect((await readProject(project.id)).name).toBe("Key rename");
    });

    it("allows a key that also carries the project:manage_settings scope", async () => {
      const { actor, project } = await actorWithLegacyMap(
        "admin",
        LEGACY_UPDATE,
      );
      mockAuthenticatedSession(actor.user);
      const { app } = createApp();
      const rawKey = await createApiKeyFor(actor.user.id, {
        project: ["read", "update", "manage_settings"],
      });

      const allowed = await putProject(
        app,
        project.id,
        fullBody(project, { defaultCommentVisibility: "public" }),
        { "x-api-key": rawKey },
      );
      expect(allowed.status).toBe(200);
      expect((await readProject(project.id)).defaultCommentVisibility).toBe(
        "public",
      );
    });

    it("never lets a key's manage_settings scope widen a member owner past the role check", async () => {
      const { actor, project } = await actorWithLegacyMap(
        "member",
        LEGACY_UPDATE,
        NARROW_PROJECT_UPDATE,
      );
      mockAuthenticatedSession(actor.user);
      const { app } = createApp();
      const rawKey = await createApiKeyFor(actor.user.id, {
        project: ["read", "update", "manage_settings"],
      });

      const denied = await putProject(
        app,
        project.id,
        fullBody(project, { defaultCommentVisibility: "public" }),
        { "x-api-key": rawKey },
      );
      expect(denied.status).toBe(403);
      expect((await readProject(project.id)).defaultCommentVisibility).toBe(
        "internal",
      );
    });
  });

  describe("composer default", () => {
    async function seedWorkItem(
      workspaceId: string,
      projectId: string,
      userId: string,
    ) {
      const now = new Date();
      const [type] = await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId,
          key: `type-${randomUUID()}`,
          name: "Task",
          category: "delivery",
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const [template] = await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId,
          key: `state-${randomUUID()}`,
          name: "Backlog",
          group: "backlog",
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!type || !template) throw new Error("seed failed");
      await db.insert(schema.stateTable).values({
        projectId,
        stateTemplateId: template.id,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      });
      await grantProjectRole(userId, projectId, [
        "project:read",
        "work_item:read",
        "work_item:create",
      ]);
      return type;
    }

    it("serves the updated default on the work-item read the composer starts from", async () => {
      const { actor, project } = await actorWithLegacyMap(
        "admin",
        LEGACY_UPDATE,
      );
      const type = await seedWorkItem(
        actor.workspace.id,
        project.id,
        actor.user.id,
      );
      mockAuthenticatedSession(actor.user);
      const { app } = createApp();

      const created = await app.request(
        `/api/projects/${project.id}/work-items`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ typeId: type.id, title: "Composer default" }),
        },
      );
      expect(created.status).toBe(200);
      const { key } = (await created.json()) as { key: string };

      const before = await app.request(`/api/work-items/${key}`);
      expect(
        ((await before.json()) as { defaultCommentVisibility: string })
          .defaultCommentVisibility,
      ).toBe("internal");

      const updated = await putProject(
        app,
        project.id,
        fullBody(project, { defaultCommentVisibility: "public" }),
      );
      expect(updated.status).toBe(200);

      const after = await app.request(`/api/work-items/${key}`);
      expect(after.status).toBe(200);
      expect(
        ((await after.json()) as { defaultCommentVisibility: string })
          .defaultCommentVisibility,
      ).toBe("public");
    });
  });
});
