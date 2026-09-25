/**
 * `PATCH /api/work-items/{key}` (`docs/03-features/work-items.md`, `WI-7`/`WI-8`) --
 * #23's second slice. `WI-6` (activity logging) was out of scope for that slice; it is
 * wired in by #23's third slice and covered separately by
 * `work-item-activity-wiring.test.ts`, not by this file.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import updateWorkItem from "../../apps/api/src/work-item/controllers/update-work-item";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// F-A's negative case needs a caller who holds `work_item:update` but NOT
// `work_item:set_priority` -- every seeded `BUILT_IN_ROLES` entry that has the first
// also has the second (`packages/permissions/src/roles.ts`: owner/admin/manager/lead/
// member all bundle both), and there is no live mechanism yet for assigning a genuinely
// custom, per-workspace role's own capability set to `workspace_member.role`
// (`require-workspace-capability.ts`'s own doc comment -- the `role.capabilities` column
// exists on `role`/`roleTable` but nothing wires it into `builtInRoleHasCapability` yet).
// So this test adds one extra, test-only entry to the real `BUILT_IN_ROLES` data --
// everything else from the actual module is passed through unchanged -- and assigns its
// key directly to a `workspace_member.role` row the same way `addWorkspaceMember` below
// always has (that column is plain, unconstrained `text`).
vi.mock("@taskdesk/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@taskdesk/permissions")>();
  return {
    ...actual,
    BUILT_IN_ROLES: {
      ...actual.BUILT_IN_ROLES,
      test_updater_no_set_priority: {
        key: "test_updater_no_set_priority",
        scope: "workspace",
        rank: 40,
        intent:
          "Test-only role (F-A regression): work_item:update without work_item:set_priority",
        isEditable: true,
        capabilities: ["work_item:update"],
      },
    },
  };
});

async function makeWorkItemType(workspaceId: string) {
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
  if (!type) throw new Error("makeWorkItemType: insert returned no row");
  return type;
}

async function makeDefaultState(workspaceId: string, projectId: string) {
  const now = new Date();
  const [stateTemplate] = await db
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
  if (!stateTemplate) {
    throw new Error("makeDefaultState: state_template insert returned no row");
  }

  const [state] = await db
    .insert(schema.stateTable)
    .values({
      projectId,
      stateTemplateId: stateTemplate.id,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!state) throw new Error("makeDefaultState: state insert returned no row");
  return state;
}

async function addWorkspaceMember(workspaceId: string, role: string) {
  const userId = `user-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id: userId,
      email: `${userId}@example.com`,
      emailVerified: true,
      name: "Integration Test User",
    })
    .returning();
  if (!user) throw new Error("addWorkspaceMember: user insert returned no row");

  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });

  // Issue #318 (security): `require-workspace-capability.ts` now grants a `BUILT_IN_ROLES`
  // name's capabilities only to a GENUINE seeded `workspace_role` row (`is_system = true`)
  // -- `"owner"` is the one exception, since it never gets a row at all (retrofit plan R5).
  // Every other role this helper assigns (including the mocked
  // `test_updater_no_set_priority` key above) needs one, or it would read as a custom row
  // that merely shares the name and lose its capabilities.
  if (role !== "owner") {
    const now = new Date();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId,
      role,
      permission: JSON.stringify({}),
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  return user;
}

async function setupProjectWithDefaultState(
  role: "member" | "admin" | "viewer" = "member",
) {
  const creator = await createWorkspaceMember({ role });
  const { project } = await createProjectFixture({
    workspaceId: creator.workspace.id,
  });
  const type = await makeWorkItemType(creator.workspace.id);
  const state = await makeDefaultState(creator.workspace.id, project.id);
  return { creator, project, type, state };
}

function createWorkItemRequest(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function updateWorkItemRequest(
  app: ReturnType<typeof createApp>["app"],
  key: string,
  body: Record<string, unknown>,
  ifMatch: string | number,
) {
  return app.request(`/api/work-items/${key}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "if-match": `"${ifMatch}"`,
    },
    body: JSON.stringify(body),
  });
}

describe("API integration: work item update (#23 second slice)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("WI-8: updates title/description/priority/dates and increments version by exactly 1", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Original title",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };
    expect(createdBody.version).toBe(1);

    const response = await updateWorkItemRequest(
      app,
      createdBody.key,
      {
        title: "Updated title",
        description: { type: "doc", content: [] },
        priority: "high",
        startDate: "2026-01-01T00:00:00.000Z",
        dueDate: "2026-02-01T00:00:00.000Z",
      },
      1,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.title).toBe("Updated title");
    expect(body.priority).toBe("high");
    expect(body.version).toBe(2);
    expect(body.description).toEqual({ type: "doc", content: [] });

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, createdBody.key));
    expect(row?.version).toBe(2);
    expect(row?.title).toBe("Updated title");
  });

  it("WI-8: a partial update changes only the supplied fields", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Keep this title",
      priority: "low",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };

    const response = await updateWorkItemRequest(
      app,
      createdBody.key,
      { priority: "urgent" },
      createdBody.version,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.title).toBe("Keep this title");
    expect(body.priority).toBe("urgent");
    expect(body.version).toBe(2);
  });

  it("rejects a body with no fields supplied", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Empty patch",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };

    const response = await updateWorkItemRequest(
      app,
      createdBody.key,
      {},
      createdBody.version,
    );
    expect(response.status).toBe(400);
  });

  it("rejects a request with no If-Match header", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "No If-Match",
    });
    const createdBody = (await created.json()) as { key: string };

    const response = await app.request(`/api/work-items/${createdBody.key}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Should be rejected" }),
    });
    expect(response.status).toBe(400);
  });

  it("F-B: an If-Match version above the Postgres integer max is a 400, not a 500", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Overflowing If-Match",
    });
    const createdBody = (await created.json()) as { key: string };

    const response = await updateWorkItemRequest(
      app,
      createdBody.key,
      { title: "Should be rejected before it reaches Postgres" },
      "99999999999999999999",
    );
    expect(response.status).toBe(400);
  });

  it("S1 (independent Opus security review of PR #271, BLOCKING): PATCH 404s once its project is soft-deleted, and the row is unchanged", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Frozen by project deletion",
      priority: "low",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };

    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date(), purgeAfter: new Date() })
      .where(eq(schema.projectTable.id, project.id));

    const response = await updateWorkItemRequest(
      app,
      createdBody.key,
      { title: "Should not be written", priority: "urgent" },
      createdBody.version,
    );
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toBe("Work item not found");

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, createdBody.key));
    expect(row?.title).toBe("Frozen by project deletion");
    expect(row?.priority).toBe("low");
    expect(row?.version).toBe(1);
  });

  it("S1: a project soft-deleted AFTER the reach check passes still blocks the CAS write and the version re-read, not just the middleware", async () => {
    // Closes the reach-check-to-UPDATE race the review flagged: even if
    // `requireWorkItemReach` somehow let a request through (e.g. a delete landing in the
    // gap between that middleware and the transaction), the CAS itself and its
    // zero-row-result re-read both re-check `project.deleted_at IS NULL` independently.
    // This test soft-deletes the project between two updates made with the SAME
    // `updateWorkItem` call graph as the route (through the real HTTP route, since that
    // is the only externally observable behaviour) to prove the second write is refused
    // once the project is gone, not merely raced.
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "First edit allowed",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };

    const first = await updateWorkItemRequest(
      app,
      createdBody.key,
      { title: "Edited while project was alive" },
      createdBody.version,
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { version: number };

    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date(), purgeAfter: new Date() })
      .where(eq(schema.projectTable.id, project.id));

    const second = await updateWorkItemRequest(
      app,
      createdBody.key,
      { title: "Should not land" },
      firstBody.version,
    );
    expect(second.status).toBe(404);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, createdBody.key));
    expect(row?.title).toBe("Edited while project was alive");
  });

  it("T3 (independent Opus security review of PR #271, delta round): updateWorkItem itself refuses a soft-deleted project's row, not only requireWorkItemReach", async () => {
    // The S1 tests above both go through the real HTTP route, so `requireWorkItemReach`
    // (which independently checks `project.deleted_at IS NULL`) answers 404 before the
    // transaction ever runs -- neither one exercises `update-work-item.ts`'s own
    // `projectNotDeleted` EXISTS guard on the CAS `WHERE` clause. This test calls
    // `updateWorkItem` directly, the same probe the Opus delta round used, skipping the
    // reach middleware entirely (as a genuine race between the middleware's check and the
    // transaction would). Removing `projectNotDeleted` from `update-work-item.ts`'s CAS
    // `WHERE` makes this test fail while every HTTP-level S1 test still passes -- proven
    // by mutation testing, reported in this PR's body, not left as an assertion here.
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "CAS-guarded directly",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };

    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date(), purgeAfter: new Date() })
      .where(eq(schema.projectTable.id, project.id));

    // Current asserted version: the CAS's own EXISTS guard must refuse this, not the
    // version comparison (which would otherwise match and let the write through).
    let currentVersionError: unknown;
    try {
      await updateWorkItem(
        createdBody.key,
        creator.workspace.id,
        createdBody.version,
        creator.user.id,
        "person",
        { title: "Should not land (current version)" },
      );
    } catch (error) {
      currentVersionError = error;
    }
    expect(currentVersionError).toBeInstanceOf(HTTPException);
    expect((currentVersionError as HTTPException).status).toBe(404);

    // Stale asserted version: pins the zero-row re-read's own `isNull(projectTable.
    // deletedAt)` condition too -- it must also answer 404 (the project is gone), never a
    // confusing 409 (which would imply the row is merely at a different version).
    let staleVersionError: unknown;
    try {
      await updateWorkItem(
        createdBody.key,
        creator.workspace.id,
        createdBody.version + 1,
        creator.user.id,
        "person",
        { title: "Should not land (stale version)" },
      );
    } catch (error) {
      staleVersionError = error;
    }
    expect(staleVersionError).toBeInstanceOf(HTTPException);
    expect((staleVersionError as HTTPException).status).toBe(404);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, createdBody.key));
    expect(row?.title).toBe("CAS-guarded directly");
    expect(row?.version).toBe(1);
  });

  it("S3 (independent Opus security review of PR #271): out-of-range startDate/dueDate are a 400, not a 500, and true/0 are not silently accepted as epoch", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Date-guarded item",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };

    const badDates: unknown[] = [
      "+010000-01-01T00:00:00.000Z", // year > 9999
      "-010000-01-01T00:00:00.000Z", // extended negative year
      8640000000000000, // Date.MAX (ms), a number, not a string
      -8640000000000000, // Date.MIN (ms)
      true,
      0,
    ];

    for (const startDate of badDates) {
      const response = await updateWorkItemRequest(
        app,
        createdBody.key,
        { startDate },
        createdBody.version,
      );
      expect(response.status).toBe(400);
    }

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, createdBody.key));
    expect(row?.startDate).toBeNull();
    expect(row?.version).toBe(1);
  });

  it("S3: a valid ISO date-time string still updates startDate/dueDate", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Valid date",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };

    const response = await updateWorkItemRequest(
      app,
      createdBody.key,
      { startDate: "2026-03-01T00:00:00.000Z" },
      createdBody.version,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { startDate: string };
    expect(new Date(body.startDate).toISOString()).toBe(
      "2026-03-01T00:00:00.000Z",
    );
  });

  it("T1 (independent Opus security review of PR #271, delta round): year-0000/offset-boundary dates are a 400, not a 500", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "T1-guarded item",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };

    const badDates = [
      "0000-01-01T00:00:00Z", // no year 0 in Postgres
      "0001-01-01T00:00:00+14:00", // UTC instant lands in year 0
      "9999-12-31T23:59:59-14:00", // UTC instant lands in year 10000
      "9999-12-31T23:59:59.999-23:59", // same, largest legal offset
      "1899-12-31T23:59:59Z", // just below the new 1900 floor
      "2026-02-31T00:00:00Z", // impossible calendar date -- must not roll over to March 3
    ];

    for (const startDate of badDates) {
      const response = await updateWorkItemRequest(
        app,
        createdBody.key,
        { startDate },
        createdBody.version,
      );
      expect(response.status, `expected 400 for ${startDate}`).toBe(400);
    }

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, createdBody.key));
    expect(row?.startDate).toBeNull();
    expect(row?.version).toBe(1);
  });

  it("T2 (independent Opus security review of PR #271, delta round): the 1900/9999 UTC boundaries are accepted and read back identically", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Boundary dates",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };

    const response = await updateWorkItemRequest(
      app,
      createdBody.key,
      {
        startDate: "1900-01-01T00:00:00Z",
        dueDate: "9999-12-31T23:59:59Z",
      },
      createdBody.version,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      startDate: string;
      dueDate: string;
    };
    expect(new Date(body.startDate).toISOString()).toBe(
      "1900-01-01T00:00:00.000Z",
    );
    expect(new Date(body.dueDate).toISOString()).toBe(
      "9999-12-31T23:59:59.000Z",
    );

    // Read back on a LATER GET -- not just the PATCH's own response -- to prove the
    // two-digit-year read quirk (T2) genuinely cannot bite once the floor is 1900: the
    // read path isn't touched by this fix, only the input boundary is.
    const getResponse = await app.request(`/api/work-items/${createdBody.key}`);
    expect(getResponse.status).toBe(200);
    const getBody = (await getResponse.json()) as {
      startDate: string;
      dueDate: string;
    };
    expect(new Date(getBody.startDate).toISOString()).toBe(
      "1900-01-01T00:00:00.000Z",
    );
    expect(new Date(getBody.dueDate).toISOString()).toBe(
      "9999-12-31T23:59:59.000Z",
    );
  });

  it("S4 (independent Opus security review of PR #271, partial): a NUL byte in title or description is a 400, not a 500", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "NUL-guarded item",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };

    const titleWithNul = await updateWorkItemRequest(
      app,
      createdBody.key,
      { title: "a\u0000b" },
      createdBody.version,
    );
    expect(titleWithNul.status).toBe(400);

    const descriptionValueWithNul = await updateWorkItemRequest(
      app,
      createdBody.key,
      { description: { t: "a\u0000b" } },
      createdBody.version,
    );
    expect(descriptionValueWithNul.status).toBe(400);

    const descriptionKeyWithNul = await updateWorkItemRequest(
      app,
      createdBody.key,
      { description: { "a\u0000": 1 } },
      createdBody.version,
    );
    expect(descriptionKeyWithNul.status).toBe(400);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, createdBody.key));
    expect(row?.title).toBe("NUL-guarded item");
    expect(row?.version).toBe(1);
  });

  it("WI-7: a stale If-Match returns 409 with both the asserted and current versions", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Will be edited",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };

    // A real update, moving the row to version 2.
    const first = await updateWorkItemRequest(
      app,
      createdBody.key,
      { title: "First edit" },
      createdBody.version,
    );
    expect(first.status).toBe(200);

    // Same asserted version (1) again -- now stale.
    const stale = await updateWorkItemRequest(
      app,
      createdBody.key,
      { title: "Stale edit" },
      createdBody.version,
    );
    expect(stale.status).toBe(409);
    const staleBody = (await stale.json()) as {
      assertedVersion: number;
      currentVersion: number;
    };
    expect(staleBody.assertedVersion).toBe(1);
    expect(staleBody.currentVersion).toBe(2);

    // The stale write did not apply.
    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, createdBody.key));
    expect(row?.title).toBe("First edit");
    expect(row?.version).toBe(2);
  });

  it("cross-workspace 404: a key that exists but belongs to a workspace the caller isn't a member of", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Not yours",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };

    const stranger = await createWorkspaceMember({ role: "member" });
    mockAuthenticatedSession(stranger.user);

    const response = await updateWorkItemRequest(
      app,
      createdBody.key,
      { title: "Should not reach this" },
      createdBody.version,
    );
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toBe("Work item not found");
  });

  it("404s on a nonexistent key", async () => {
    const { creator, project } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const response = await updateWorkItemRequest(
      app,
      `${project.slug}-999999`,
      { title: "Nope" },
      1,
    );
    expect(response.status).toBe(404);
  });

  it("permissions: a caller without work_item:update on the project is refused (403)", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Viewer should not edit this",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };

    const viewer = await addWorkspaceMember(creator.workspace.id, "viewer");
    mockAuthenticatedSession(viewer);

    const response = await updateWorkItemRequest(
      app,
      createdBody.key,
      { title: "Should be refused" },
      createdBody.version,
    );
    expect(response.status).toBe(403);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, createdBody.key));
    expect(row?.title).toBe("Viewer should not edit this");
  });

  it("permissions (F-A): work_item:update alone is not enough to change priority -- 403, and nothing is written, but the same caller can still update title", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Priority is guarded",
      priority: "low",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };
    expect(createdBody.version).toBe(1);

    const updaterOnly = await addWorkspaceMember(
      creator.workspace.id,
      "test_updater_no_set_priority",
    );
    mockAuthenticatedSession(updaterOnly);

    // A body that ALSO includes a field genuinely covered by work_item:update: the whole
    // request is refused, not just the priority field -- no partial write of title either.
    const mixedAttempt = await updateWorkItemRequest(
      app,
      createdBody.key,
      { title: "Should not be written", priority: "urgent" },
      createdBody.version,
    );
    expect(mixedAttempt.status).toBe(403);

    // priority-only, same refusal.
    const priorityOnlyAttempt = await updateWorkItemRequest(
      app,
      createdBody.key,
      { priority: "urgent" },
      createdBody.version,
    );
    expect(priorityOnlyAttempt.status).toBe(403);

    const [afterRefusals] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, createdBody.key));
    expect(afterRefusals?.title).toBe("Priority is guarded");
    expect(afterRefusals?.priority).toBe("low");
    expect(afterRefusals?.version).toBe(1);

    // The SAME caller, same role, succeeds on a field work_item:update alone does cover.
    const titleOnly = await updateWorkItemRequest(
      app,
      createdBody.key,
      { title: "Renamed by updater-only role" },
      createdBody.version,
    );
    expect(titleOnly.status).toBe(200);
    const titleOnlyBody = (await titleOnly.json()) as {
      title: string;
      version: number;
    };
    expect(titleOnlyBody.title).toBe("Renamed by updater-only role");
    expect(titleOnlyBody.version).toBe(2);
  });

  it("permissions (F-A): a role holding work_item:set_priority can change priority (200)", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Lead may reprioritise",
      priority: "low",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };

    // `lead` explicitly lists `work_item:set_priority`
    // (`packages/permissions/src/roles.ts`).
    const lead = await addWorkspaceMember(creator.workspace.id, "lead");
    mockAuthenticatedSession(lead);

    const response = await updateWorkItemRequest(
      app,
      createdBody.key,
      { priority: "urgent" },
      createdBody.version,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { priority: string };
    expect(body.priority).toBe("urgent");
  });

  it("WI-7: a concurrent-update race asserting the same starting version resolves to exactly one 200 and one 409, never both or neither", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Race target",
    });
    const createdBody = (await created.json()) as {
      key: string;
      version: number;
    };
    expect(createdBody.version).toBe(1);

    const [responseA, responseB] = await Promise.all([
      updateWorkItemRequest(app, createdBody.key, { title: "Writer A" }, 1),
      updateWorkItemRequest(app, createdBody.key, { title: "Writer B" }, 1),
    ]);

    const statuses = [responseA.status, responseB.status].sort();
    expect(statuses).toEqual([200, 409]);

    // The row itself ends up at version 2, with exactly one writer's title -- the CAS
    // genuinely serialised the two concurrent writers rather than both applying (which
    // would silently double-increment or corrupt the row) or both being rejected.
    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, createdBody.key));
    expect(row?.version).toBe(2);
    expect(["Writer A", "Writer B"]).toContain(row?.title);

    const winner = responseA.status === 200 ? responseA : responseB;
    const loser = responseA.status === 409 ? responseA : responseB;
    const winnerBody = (await winner.json()) as { title: string };
    expect(winnerBody.title).toBe(row?.title);
    const loserBody = (await loser.json()) as {
      assertedVersion: number;
      currentVersion: number;
    };
    expect(loserBody.assertedVersion).toBe(1);
    expect(loserBody.currentVersion).toBe(2);
  });
});
