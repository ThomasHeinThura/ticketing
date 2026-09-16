/**
 * S7 — native role list + write routes (issue #6, retrofit plan §3, S7 row) — the last item
 * on the organization()-retrofit critical path.
 *
 * Positive paths, validation errors, the capability/role boundaries, and the two decisive
 * non-vacuous probes the S7 blueprint (§5) calls out as required: the permission-ceiling
 * escalation chain (Finding F2 / `RL-3`) and the advisory-lock race (issue #118).
 *
 * This file is also this stage's equivalence obligation for
 * `organization-plugin-characterization.test.ts`'s `workspace_role create / update / delete`
 * block, reproduced against the NATIVE routes rather than by repointing that file itself:
 * that file is the frozen S1 characterization oracle for the still-mounted PLUGIN, and
 * repointing its assertions at native routes would defeat its purpose as a byte-identical
 * equivalence baseline. The same invariants it pins -- create inserts with the given
 * permission JSON, update overwrites (never merges), delete removes the row, delete succeeds
 * on an unassigned seeded role and is refused on an assigned one -- are asserted here instead,
 * against `/api/workspace/{id}/roles`.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import {
  inviteAndAcceptAsNewMember,
  signUpUser,
} from "./helpers/organization-http";
import { updateWorkspaceMemberRoleNative } from "./helpers/workspace-membership-write-http";
import {
  createWorkspaceRoleNative,
  deleteWorkspaceRoleNative,
  listWorkspaceRolesNative,
  updateWorkspaceRoleNative,
} from "./helpers/workspace-role-write-http";
import {
  createWorkspaceNative,
  deleteWorkspaceNative,
} from "./helpers/workspace-write-http";

type App = ReturnType<typeof createApp>["app"];

async function createWorkspace(
  app: App,
  cookie: string,
  name: string,
): Promise<string> {
  const created = await createWorkspaceNative(app, cookie, { name });
  if (created.status !== 200) {
    throw new Error(`create failed: ${created.status} ${await created.text()}`);
  }
  return ((await created.json()) as { id: string }).id;
}

async function roleRows(workspaceId: string, role: string) {
  return db
    .select()
    .from(schema.workspaceRoleTable)
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, workspaceId),
        eq(schema.workspaceRoleTable.role, role),
      ),
    );
}

async function setMemberRoleRaw(
  workspaceId: string,
  userId: string,
  role: string,
) {
  await db
    .update(schema.workspaceUserTable)
    .set({ role })
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    );
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("S7 list roles (GET /api/workspace/{id}/roles)", () => {
  it("returns every seeded default role plus a custom one, and never 'owner'", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Roster");
    await createWorkspaceRoleNative(app, owner.cookie, workspaceId, {
      role: "readonly",
      permission: { task: ["read"] },
    });

    const response = await listWorkspaceRolesNative(
      app,
      owner.cookie,
      workspaceId,
    );
    expect(response.status).toBe(200);
    const roles = (await response.json()) as Array<{ role: string }>;
    const names = roles.map((r) => r.role).sort();
    expect(names).toEqual(["admin", "member", "readonly", "viewer"]);
  });

  it("does not leak another workspace's roles (cross-tenant isolation)", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceA = await createWorkspace(app, owner.cookie, "A");
    const workspaceB = await createWorkspace(app, owner.cookie, "B");
    await createWorkspaceRoleNative(app, owner.cookie, workspaceA, {
      role: "only-in-a",
      permission: { task: ["read"] },
    });

    const response = await listWorkspaceRolesNative(
      app,
      owner.cookie,
      workspaceB,
    );
    expect(response.status).toBe(200);
    const roles = (await response.json()) as Array<{ role: string }>;
    expect(roles.map((r) => r.role)).not.toContain("only-in-a");
  });

  it("a plain viewer can list roles (preserves better-auth's ac:read grant to all four legacy roles)", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Viewable");
    const viewer = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "viewer",
    );

    const response = await listWorkspaceRolesNative(
      app,
      viewer.cookie,
      workspaceId,
    );
    expect(response.status).toBe(200);
  });

  it("403s a viewer once their OWN row's permission JSON is edited to remove ac:read -- proves the route reads the DB row, not a compiled fallback", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Narrowed");
    const viewer = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "viewer",
    );

    const [viewerRole] = await roleRows(workspaceId, "viewer");
    if (!viewerRole) throw new Error("expected a seeded viewer role row");
    const narrowed = { ...JSON.parse(viewerRole.permission), ac: [] };
    const rewritten = await updateWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      viewerRole.id,
      { permission: narrowed },
    );
    expect(rewritten.status).toBe(200);

    const response = await listWorkspaceRolesNative(
      app,
      viewer.cookie,
      workspaceId,
    );
    expect(response.status).toBe(403);
  });
});

describe("S7 create role (POST /api/workspace/{id}/roles)", () => {
  it("an owner creates a role with the given permission JSON", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Create");

    const response = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "readonly", permission: { task: ["read"] } },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      role: string;
      permission: Record<string, string[]>;
    };
    expect(body.role).toBe("readonly");
    expect(body.permission).toEqual({ task: ["read"] });

    const rows = await roleRows(workspaceId, "readonly");
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]?.permission ?? "{}")).toEqual({
      task: ["read"],
    });
  });

  it("rejects 'Owner' case-insensitively, and inserts no row", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Reserved");

    const response = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "Owner", permission: { task: ["read"] } },
    );
    expect(response.status).toBe(400);
    expect(await roleRows(workspaceId, "owner")).toHaveLength(0);
    expect(await roleRows(workspaceId, "Owner")).toHaveLength(0);
  });

  it("rejects a whitespace-only name, inserting no row — found adversarially by review", async () => {
    // The controller's own `.trim().toLowerCase()` normalization ran AFTER Zod validation,
    // so a name like "   " passed `z.string().min(1).max(100)` (non-empty before trimming)
    // and then silently normalized to "" before insert -- a nameless row, not a validation
    // error. Fixed by trimming inside the Zod schema itself (`z.string().trim().min(1)`),
    // so length is checked on the SAME string that will actually be stored.
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Whitespace");

    const response = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "   ", permission: { task: ["read"] } },
    );
    expect(response.status).toBe(400);
    expect(await roleRows(workspaceId, "")).toHaveLength(0);
  });

  it("rejects a duplicate name, leaving exactly one row", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Dup");
    await createWorkspaceRoleNative(app, owner.cookie, workspaceId, {
      role: "readonly",
      permission: { task: ["read"] },
    });

    const response = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "readonly", permission: { task: ["read", "create"] } },
    );
    expect(response.status).toBe(409);
    expect(await roleRows(workspaceId, "readonly")).toHaveLength(1);
  });

  it("rejects an unknown permission resource, and inserts no row", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "BadResource");

    const response = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "weird", permission: { fooo: ["bar"] } },
    );
    expect(response.status).toBe(400);
    expect(await roleRows(workspaceId, "weird")).toHaveLength(0);
  });

  it("a plain viewer/member gets 403 (missing ac:create)", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "NoCreate");
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    const response = await createWorkspaceRoleNative(
      app,
      member.cookie,
      workspaceId,
      { role: "escalate", permission: { task: ["read"] } },
    );
    expect(response.status).toBe(403);
    expect(await roleRows(workspaceId, "escalate")).toHaveLength(0);
  });

  it("enforces the 25-role ceiling", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Ceiling25");
    // 3 seeded (viewer/member/admin) + 22 custom = 25 already at the ceiling.
    for (let i = 0; i < 22; i++) {
      const created = await createWorkspaceRoleNative(
        app,
        owner.cookie,
        workspaceId,
        { role: `role-${i}`, permission: { task: ["read"] } },
      );
      expect(created.status).toBe(200);
    }

    const overLimit = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "one-too-many", permission: { task: ["read"] } },
    );
    expect(overLimit.status).toBe(400);
    expect(await roleRows(workspaceId, "one-too-many")).toHaveLength(0);
  }, 30_000);

  it("two concurrent creates of the same role name -- exactly one succeeds (issue #118, the advisory lock)", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Race");

    const [first, second] = await Promise.all([
      createWorkspaceRoleNative(app, owner.cookie, workspaceId, {
        role: "racer",
        permission: { task: ["read"] },
      }),
      createWorkspaceRoleNative(app, owner.cookie, workspaceId, {
        role: "racer",
        permission: { task: ["read"] },
      }),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    // A clean 200/409 split, never two 200s (a silent duplicate) and never a
    // raw, unhandled 500 from the unique-constraint violation.
    expect(statuses).toEqual([200, 409]);
    expect(await roleRows(workspaceId, "racer")).toHaveLength(1);
  });
});

describe("F2 -- cannot grant a capability you do not hold yourself (RL-3, S7 blueprint Finding F2)", () => {
  it("blocks an admin from creating a role that grants organization:delete, and the escalation chain never gets off the ground", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Ceiling");
    const admin = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );

    // Step 1: an admin (organization:["update"] only -- never delete, per
    // legacy-better-auth-access-control.ts's adminAc) tries to create a role
    // that would grant organization:delete.
    const created = await createWorkspaceRoleNative(
      app,
      admin.cookie,
      workspaceId,
      { role: "super", permission: { organization: ["delete"] } },
    );
    expect(created.status).toBe(403);
    // Error bodies are plain text (`errorResponse` documents `text/plain`; Hono's
    // `HTTPException.getResponse()` returns the message as the raw body), not JSON.
    expect(await created.text()).toMatch(/organization:delete/);
    expect(await roleRows(workspaceId, "super")).toHaveLength(0);

    // Step 2: with "super" never created, self-assigning it is impossible --
    // update-workspace-member-role's own ROLE_NOT_FOUND semantics refuse it.
    const selfAssign = await updateWorkspaceMemberRoleNative(
      app,
      admin.cookie,
      workspaceId,
      admin.user.id,
      { role: "super" },
    );
    expect(selfAssign.status).toBe(400);

    // Step 3: the admin's own role never changed, so deleting the workspace
    // still 403s exactly as it always did for a plain admin -- the escalation
    // chain the S7 blueprint describes is severed at its origin, not merely
    // made harder.
    const deleted = await deleteWorkspaceNative(app, admin.cookie, workspaceId);
    expect(deleted.status).toBe(403);
  });

  it("the SAME create succeeds for the owner, who already holds organization:delete -- the check is a ceiling, not a blanket ban", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "OwnerCan");

    const created = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "super", permission: { organization: ["delete"] } },
    );
    expect(created.status).toBe(200);
    expect(await roleRows(workspaceId, "super")).toHaveLength(1);
  });
});

describe("S7 update role (PATCH /api/workspace/{id}/roles/{roleId})", () => {
  it("replaces (never merges) the permission set", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Replace");
    const created = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      {
        role: "editor",
        permission: { organization: ["update"], member: ["create"] },
      },
    );
    const { id: roleId } = (await created.json()) as { id: string };

    const updated = await updateWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      roleId,
      { permission: { organization: ["update"] } },
    );
    expect(updated.status).toBe(200);
    const body = (await updated.json()) as {
      permission: Record<string, string[]>;
    };
    expect(body.permission).toEqual({ organization: ["update"] });

    // Prove the OLD grant was actually dropped, not merely that the new
    // field was accepted: a member holding this role can no longer add
    // members (member:create was removed).
    const holder = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "editor",
    );
    const newcomer = await signUpUser(app);
    const addAttempt = await app.request(
      `/api/workspace/${workspaceId}/members`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: holder.cookie,
        },
        body: JSON.stringify({ userId: newcomer.user.id, role: "viewer" }),
      },
    );
    expect(addAttempt.status).toBe(403);
  });

  it("rejects an unknown permission resource", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "BadUpdate");
    const created = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "editor", permission: { task: ["read"] } },
    );
    const { id: roleId } = (await created.json()) as { id: string };

    const updated = await updateWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      roleId,
      { permission: { fooo: ["bar"] } },
    );
    expect(updated.status).toBe(400);
  });

  it("rejects granting a permission the caller does not themselves hold", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "UpdateCeiling",
    );
    const admin = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );
    const created = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "editor", permission: { task: ["read"] } },
    );
    const { id: roleId } = (await created.json()) as { id: string };

    const updated = await updateWorkspaceRoleNative(
      app,
      admin.cookie,
      workspaceId,
      roleId,
      { permission: { organization: ["delete"] } },
    );
    expect(updated.status).toBe(403);

    const [row] = await roleRows(workspaceId, "editor");
    expect(JSON.parse(row?.permission ?? "{}")).toEqual({ task: ["read"] });
  });

  it("404s on a nonexistent roleId", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Missing");

    const updated = await updateWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      "does-not-exist",
      { permission: { task: ["read"] } },
    );
    expect(updated.status).toBe(404);
  });
});

describe("S7 delete role (DELETE /api/workspace/{id}/roles/{roleId})", () => {
  it("succeeds on an unassigned seeded role ('viewer') and removes the row", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "DeleteViewer",
    );
    const [viewerRole] = await roleRows(workspaceId, "viewer");
    if (!viewerRole) throw new Error("expected a seeded viewer role row");

    const response = await deleteWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      viewerRole.id,
    );
    expect(response.status).toBe(200);
    expect(await roleRows(workspaceId, "viewer")).toHaveLength(0);
  });

  it("refuses a role currently held by a member (the ordinary, single-role case)", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Assigned");
    const created = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "custom", permission: { task: ["read"] } },
    );
    const { id: roleId } = (await created.json()) as { id: string };
    await inviteAndAcceptAsNewMember(app, owner.cookie, workspaceId, "custom");

    const response = await deleteWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      roleId,
    );
    expect(response.status).toBe(400);
    expect(await roleRows(workspaceId, "custom")).toHaveLength(1);
  });

  it("the CHECK constraint from migration 0050 makes a comma-joined role value unreachable via any write path -- confirmed directly, mirroring multi-role-membership-characterization.test.ts's own probe for workspace_member", async () => {
    // This is NOT a gap in coverage: the comma-aware matching logic itself
    // (roleIsReferencedBy, S7 blueprint Ambiguity Q2) is unit-tested directly
    // in tests/api/workspace/delete-workspace-role.test.ts, because this
    // constraint refuses the very state that check exists to handle for any
    // row written after migration 0050 -- confirmed here rather than assumed.
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Unreachable");
    const holder = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "viewer",
    );

    const rejection = await setMemberRoleRaw(
      workspaceId,
      holder.user.id,
      "custom,admin",
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(rejection).not.toBeNull();
    const cause = (rejection as { cause?: { code?: string } })?.cause;
    expect(cause?.code).toBe("23514");
  });

  it("succeeds once the last member holding it is reassigned", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Freed");
    const created = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "custom", permission: { task: ["read"] } },
    );
    const { id: roleId } = (await created.json()) as { id: string };
    const holder = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "custom",
    );

    const blocked = await deleteWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      roleId,
    );
    expect(blocked.status).toBe(400);

    await updateWorkspaceMemberRoleNative(
      app,
      owner.cookie,
      workspaceId,
      holder.user.id,
      { role: "viewer" },
    );

    const freed = await deleteWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      roleId,
    );
    expect(freed.status).toBe(200);
    expect(await roleRows(workspaceId, "custom")).toHaveLength(0);
  });

  it("404s on a nonexistent roleId", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "DeleteMissing",
    );

    const response = await deleteWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      "does-not-exist",
    );
    expect(response.status).toBe(404);
  });
});

describe("instance-admin bypass closure (mirrors S4/S5's own A2-P17 tests)", () => {
  it("an instance admin who is only a viewer member of the workspace cannot create a role", async () => {
    const { app } = createApp();
    // The FIRST user signed up after a reset is auto-promoted to instance
    // admin by the first-run bootstrap (matches workspace-write-authorization
    // .test.ts's A2-P17 pattern) -- sign this one up before the workspace
    // owner so it is genuinely the first user.
    const instanceAdmin = await signUpUser(app);
    const [adminRow] = await db
      .select({ role: schema.userTable.role })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, instanceAdmin.user.id));
    expect(adminRow?.role).toBe("admin");

    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Bypass");
    await db.insert(schema.workspaceUserTable).values({
      workspaceId,
      userId: instanceAdmin.user.id,
      role: "viewer",
      joinedAt: new Date(),
    });

    const response = await createWorkspaceRoleNative(
      app,
      instanceAdmin.cookie,
      workspaceId,
      { role: "shouldnotexist", permission: { task: ["read"] } },
    );
    expect(response.status).toBe(403);
    expect(await roleRows(workspaceId, "shouldnotexist")).toHaveLength(0);
  });

  it("the SAME instance admin succeeds once their workspace role actually is admin", async () => {
    const { app } = createApp();
    const instanceAdmin = await signUpUser(app);
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "BypassOk");
    await db.insert(schema.workspaceUserTable).values({
      workspaceId,
      userId: instanceAdmin.user.id,
      role: "admin",
      joinedAt: new Date(),
    });

    const response = await createWorkspaceRoleNative(
      app,
      instanceAdmin.cookie,
      workspaceId,
      { role: "reallyworks", permission: { task: ["read"] } },
    );
    expect(response.status).toBe(200);
  });
});

describe("session-only and reach (mirrors every other workspace mutation)", () => {
  it("a non-member gets 403 on list", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Private");
    const stranger = await signUpUser(app);

    const response = await listWorkspaceRolesNative(
      app,
      stranger.cookie,
      workspaceId,
    );
    expect(response.status).toBe(403);
  });
});
