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
import { BUILT_IN_ROLE_KEYS } from "@taskdesk/permissions";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CAPABILITY_CHECKS } from "../../apps/api/src/capabilities/capability-checks";
import db, { getDatabasePool, schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { legacyStatementsFromCapabilities } from "../../apps/api/src/permissions/legacy-statements";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { signUpInstanceAdmin, signUpUser } from "./helpers/organization-http";
import { mintStepUpToken } from "./helpers/step-up";
import {
  acceptInvitationNative,
  inviteAndAcceptAsNewMemberNative,
  inviteWorkspaceMemberNative,
} from "./helpers/workspace-invitation-write-http";
import {
  addWorkspaceMemberNative,
  updateWorkspaceMemberRoleNative,
} from "./helpers/workspace-membership-write-http";
import {
  approveWorkspaceRoleDeletion,
  createWorkspaceRoleNative,
  deleteWorkspaceRoleNative,
  listWorkspaceRolesNative,
  requestWorkspaceRoleDeletion,
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

/**
 * The canonical workspace-scope `role` rows for a key (owner decision, 23 Oct: custom-role
 * capabilities live in `role`). `permission` is the derived legacy statement view as JSON text,
 * kept so the original assertions read unchanged.
 */
async function roleRows(workspaceId: string, role: string) {
  const rows = await db
    .select()
    .from(schema.roleTable)
    .where(
      and(
        eq(schema.roleTable.scope, "workspace"),
        eq(schema.roleTable.workspaceId, workspaceId),
        eq(schema.roleTable.key, role),
      ),
    );
  return rows.map((row) => ({
    ...row,
    role: row.key,
    permission: JSON.stringify(
      legacyStatementsFromCapabilities(
        Array.isArray(row.capabilities) ? (row.capabilities as string[]) : [],
      ),
    ),
  }));
}

async function memberRole(workspaceId: string, userId: string) {
  const [row] = await db
    .select({ role: schema.workspaceUserTable.role })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    );
  return row?.role;
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function holdWorkspaceRoleLock(workspaceId: string) {
  const acquired = deferred();
  const release = deferred();
  const transaction = db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(4_003, hashtext(${workspaceId}))`,
    );
    acquired.resolve();
    await release.promise;
  });
  await acquired.promise;
  return { release: release.resolve, transaction };
}

async function waitForAdvisoryWait(namespace: number) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await getDatabasePool().query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_locks
         WHERE locktype = 'advisory' AND classid = $1::oid AND NOT granted
       ) AS waiting`,
      [namespace],
    );
    if (result.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for advisory lock namespace ${namespace}`);
}

/**
 * A SECOND actor is queued behind the first one's role-assignment locks. Member-role changes
 * and pending-action requests/approvals also hold the global pending-action lifecycle gate
 * (taken before 4_002), so the second actor may be parked on either 4_002 or that gate.
 */
async function waitForQueuedBehindFirstActor() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await getDatabasePool().query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_locks
         WHERE locktype = 'advisory' AND NOT granted
           AND classid::bigint IN (
             4002,
             (hashtext('taskdesk:pending-action-lifecycle')::bigint & 4294967295)
           )
       ) AS waiting`,
    );
    if (result.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for a queued role-lock actor");
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("S7 list roles (GET /api/workspace/{id}/roles)", () => {
  it("returns the six built-in roles plus a custom one, with owner flagged non-editable", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Roster");
    await createWorkspaceRoleNative(app, owner.cookie, workspaceId, {
      role: "readonly",
      permission: { work_item: ["read"] },
    });

    const response = await listWorkspaceRolesNative(
      app,
      owner.cookie,
      workspaceId,
    );
    expect(response.status).toBe(200);
    const roles = (await response.json()) as Array<{
      role: string;
      isEditable: boolean;
      isSystem: boolean;
    }>;
    const names = roles.map((r) => r.role).sort();
    expect(names).toEqual([
      "admin",
      "lead",
      "manager",
      "member",
      "owner",
      "readonly",
      "viewer",
    ]);
    const ownerRole = roles.find((r) => r.role === "owner");
    expect(ownerRole).toMatchObject({ isSystem: true, isEditable: false });
    expect(roles.find((r) => r.role === "readonly")).toMatchObject({
      isSystem: false,
      isEditable: true,
    });
  });

  it("does not leak another workspace's roles (cross-tenant isolation)", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceA = await createWorkspace(app, owner.cookie, "A");
    const workspaceB = await createWorkspace(app, owner.cookie, "B");
    await createWorkspaceRoleNative(app, owner.cookie, workspaceA, {
      role: "only-in-a",
      permission: { work_item: ["read"] },
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
    const viewer = await inviteAndAcceptAsNewMemberNative(
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
    const viewer = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "viewer",
    );

    const [viewerRole] = await roleRows(workspaceId, "viewer");
    if (!viewerRole) throw new Error("expected a seeded viewer role row");
    // Owner decision, 23 Oct: the edit is a capability edit; the legacy statement row the
    // legacy gates read moves by delta, so removing `workspace:read` removes `ac:read`.
    const narrowed = (viewerRole.capabilities as string[]).filter(
      (capability) => capability !== "workspace:read",
    );
    const rewritten = await updateWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      viewerRole.id,
      { capabilities: narrowed },
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
      { role: "readonly", permission: { work_item: ["read"] } },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      role: string;
      permission: Record<string, string[]>;
    };
    expect(body.role).toBe("readonly");
    expect(body.permission).toEqual({ work_item: ["read"] });

    const rows = await roleRows(workspaceId, "readonly");
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]?.permission ?? "{}")).toEqual({
      work_item: ["read"],
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
      { role: "Owner", permission: { work_item: ["read"] } },
    );
    expect(response.status).toBe(400);
    // The only `owner` row is the built-in one; nothing custom was inserted.
    expect(
      (await roleRows(workspaceId, "owner")).filter((row) => !row.isSystem),
    ).toHaveLength(0);
    expect(await roleRows(workspaceId, "Owner")).toHaveLength(0);
  });

  describe("issue #318 (security): every BUILT_IN_ROLES key is reserved, not just 'owner'", () => {
    // Opus review of PR #315, S2: only "owner" was reserved before this fix, so a holder
    // of `ac:create` could mint a role literally named `manager`, `lead`, `admin`,
    // `member`, `viewer`, `customer` or `instance_admin` and (once assigned)
    // `require-workspace-capability.ts` granted that built-in's FULL capability set by
    // name alone, regardless of the row's own declared `permission`.
    const nonOwnerReservedNames = BUILT_IN_ROLE_KEYS.filter(
      (key) => key !== "owner",
    );

    for (const reserved of nonOwnerReservedNames) {
      // `admin`/`member`/`viewer` are DEFAULT_ROLE_NAMEs: `createWorkspace` already seeds
      // a genuine row for them at workspace-creation time, so "no row" is the wrong
      // assertion for those three -- the right one is "no ADDITIONAL row", i.e. the count
      // this request could have inserted into stays at zero. `manager`/`lead`/`customer`/
      // `instance_admin` have no seeded row at all, so both checks coincide at 0 for them.
      it(`rejects "${reserved}", inserting no row`, async () => {
        const { app } = createApp();
        const owner = await signUpUser(app);
        const workspaceId = await createWorkspace(
          app,
          owner.cookie,
          `Reserved-${reserved}`,
        );
        const before = await roleRows(workspaceId, reserved);

        const response = await createWorkspaceRoleNative(
          app,
          owner.cookie,
          workspaceId,
          { role: reserved, permission: { work_item: ["read"] } },
        );
        expect(response.status).toBe(400);
        expect(await roleRows(workspaceId, reserved)).toHaveLength(
          before.length,
        );
      });

      it(`rejects "${reserved}" case- and whitespace-normalised, the same as "owner" is`, async () => {
        const { app } = createApp();
        const owner = await signUpUser(app);
        const workspaceId = await createWorkspace(
          app,
          owner.cookie,
          `ReservedCase-${reserved}`,
        );
        const before = await roleRows(workspaceId, reserved);

        const response = await createWorkspaceRoleNative(
          app,
          owner.cookie,
          workspaceId,
          {
            role: `  ${reserved.toUpperCase()}  `,
            permission: { work_item: ["read"] },
          },
        );
        expect(response.status).toBe(400);
        expect(await roleRows(workspaceId, reserved)).toHaveLength(
          before.length,
        );
      });
    }

    it("a row that already exists for 'admin'/'member'/'viewer' (the workspace-creation seed) is genuinely that built-in, and every reserved name is still refused when NO row exists (manager/lead/customer/instance_admin)", async () => {
      const { app } = createApp();
      const owner = await signUpUser(app);
      const workspaceId = await createWorkspace(app, owner.cookie, "Sanity");

      for (const seeded of ["admin", "member", "viewer"] as const) {
        const rows = await roleRows(workspaceId, seeded);
        expect(rows, seeded).toHaveLength(1);
        expect(rows[0]?.isSystem, seeded).toBe(true);
      }
      // `manager` and `lead` are now genuine seeded built-ins too (owner decision, 23 Oct).
      for (const seeded of ["manager", "lead", "owner"] as const) {
        const rows = await roleRows(workspaceId, seeded);
        expect(rows, seeded).toHaveLength(1);
        expect(rows[0]?.isSystem, seeded).toBe(true);
      }
      for (const neverSeeded of ["customer", "instance_admin"] as const) {
        expect(
          await roleRows(workspaceId, neverSeeded),
          neverSeeded,
        ).toHaveLength(0);
      }
    });
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
      { role: "   ", permission: { work_item: ["read"] } },
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
      permission: { work_item: ["read"] },
    });

    const response = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "readonly", permission: { work_item: ["read", "create"] } },
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
    const member = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    const response = await createWorkspaceRoleNative(
      app,
      member.cookie,
      workspaceId,
      { role: "escalate", permission: { work_item: ["read"] } },
    );
    expect(response.status).toBe(403);
    expect(await roleRows(workspaceId, "escalate")).toHaveLength(0);
  });

  it("enforces the 25-role ceiling", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Ceiling25");
    // The ceiling counts custom roles only: the six built-ins do not use it up.
    for (let i = 0; i < 25; i++) {
      const created = await createWorkspaceRoleNative(
        app,
        owner.cookie,
        workspaceId,
        { role: `role-${i}`, permission: { work_item: ["read"] } },
      );
      expect(created.status).toBe(200);
    }

    const overLimit = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "one-too-many", permission: { work_item: ["read"] } },
    );
    expect(overLimit.status).toBe(400);
    expect(await roleRows(workspaceId, "one-too-many")).toHaveLength(0);
  }, 30_000);

  it("two concurrent creates of the same role name -- exactly one succeeds (issue #118, the advisory lock)", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Race");

    // One proof serves the race: the loser is refused for the duplicate name (409) before it
    // reaches the point where a proof is spent, so no second proof is needed or consumed.
    const body = { role: "racer", permission: { work_item: ["read"] } };
    const proof = await mintStepUpToken(
      app,
      owner.cookie,
      "workspace_role_create",
      { workspaceId, ...body },
    );
    expect(proof).not.toBeNull();
    const [first, second] = await Promise.all([
      createWorkspaceRoleNative(
        app,
        owner.cookie,
        workspaceId,
        body,
        proof as string,
      ),
      createWorkspaceRoleNative(
        app,
        owner.cookie,
        workspaceId,
        body,
        proof as string,
      ),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    // A clean 200/409 split, never two 200s (a silent duplicate) and never a
    // raw, unhandled 500 from the unique-constraint violation.
    expect(statuses).toEqual([200, 409]);
    expect(await roleRows(workspaceId, "racer")).toHaveLength(1);
  });
});

describe("issue #156: role assignment and deletion share a fixed lock order", () => {
  it("assignment wins the shared locks first, so deletion observes the holder and refuses", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Assign first",
    );
    const target = await signUpUser(app);
    const created = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      {
        role: "serialized-role",
        permission: { work_item: ["read"] },
      },
    );
    expect(created.status).toBe(200);
    const roleId = ((await created.json()) as { id: string }).id;

    // Hold only 4_003. The assignment must first take 4_002, then block on 4_003;
    // deletion starts after that and blocks on the already-held 4_002. Releasing the
    // gate proves the 4_002 → 4_003 order end to end rather than relying on request timing.
    const gate = await holdWorkspaceRoleLock(workspaceId);
    try {
      const adding = addWorkspaceMemberNative(app, owner.cookie, workspaceId, {
        userId: target.user.id,
        role: "serialized-role",
      });
      await waitForAdvisoryWait(4_003);
      const deleting = deleteWorkspaceRoleNative(
        app,
        owner.cookie,
        workspaceId,
        roleId,
      );
      await waitForQueuedBehindFirstActor();

      gate.release();
      const [added, deleted] = await Promise.all([adding, deleting]);
      expect(added.status).toBe(200);
      // A committed member reference is the existing role-delete contract's
      // validation failure (400), rather than a lock-contention response.
      expect(deleted.status).toBe(400);
    } finally {
      gate.release();
      await gate.transaction;
    }

    const [member] = await db
      .select({ role: schema.workspaceUserTable.role })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          eq(schema.workspaceUserTable.userId, target.user.id),
        ),
      );
    expect(member?.role).toBe("serialized-role");
    expect(await roleRows(workspaceId, "serialized-role")).toHaveLength(1);
  }, 30_000);

  it("deletion wins the shared locks first, so assignment rechecks and refuses the missing role", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Delete first",
    );
    const target = await signUpUser(app);
    const created = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      {
        role: "serialized-role",
        permission: { work_item: ["read"] },
      },
    );
    expect(created.status).toBe(200);
    const roleId = ((await created.json()) as { id: string }).id;

    // Deletion takes 4_002 before it blocks on our 4_003 gate. The later assignment
    // therefore waits on 4_002. Once the gate opens, deletion commits first and the
    // assignment's role lookup must fail inside its transaction.
    // The DELETE route only requests (202); the approval is the transaction that deletes
    // the role, so it is the actor that must win the shared locks.
    const pendingDelete = await requestWorkspaceRoleDeletion(
      app,
      owner.cookie,
      workspaceId,
      roleId,
    );
    const gate = await holdWorkspaceRoleLock(workspaceId);
    try {
      const deleting = approveWorkspaceRoleDeletion(
        app,
        owner.cookie,
        pendingDelete,
      );
      await waitForAdvisoryWait(4_003);
      const adding = addWorkspaceMemberNative(app, owner.cookie, workspaceId, {
        userId: target.user.id,
        role: "serialized-role",
      });
      await waitForQueuedBehindFirstActor();

      gate.release();
      const [deleted, added] = await Promise.all([deleting, adding]);
      expect(deleted.status).toBe(200);
      expect(added.status).toBe(400);
    } finally {
      gate.release();
      await gate.transaction;
    }

    const members = await db
      .select({ userId: schema.workspaceUserTable.userId })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          eq(schema.workspaceUserTable.userId, target.user.id),
        ),
      );
    expect(members).toHaveLength(0);
    expect(await roleRows(workspaceId, "serialized-role")).toHaveLength(0);
  }, 30_000);

  it("serializes an existing member's role change against deletion in both lock orders", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Update assignment",
    );
    const member = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );
    const created = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      {
        role: "serialized-role",
        permission: { work_item: ["read"] },
      },
    );
    expect(created.status).toBe(200);
    const roleId = ((await created.json()) as { id: string }).id;

    // First order: a member role update owns 4_002 while waiting on 4_003, then
    // deletion observes the committed assignment and refuses.
    const firstGate = await holdWorkspaceRoleLock(workspaceId);
    try {
      const updating = updateWorkspaceMemberRoleNative(
        app,
        owner.cookie,
        workspaceId,
        member.user.id,
        { role: "serialized-role" },
      );
      await waitForAdvisoryWait(4_003);
      const deleting = deleteWorkspaceRoleNative(
        app,
        owner.cookie,
        workspaceId,
        roleId,
      );
      await waitForQueuedBehindFirstActor();
      firstGate.release();
      const [updated, deleted] = await Promise.all([updating, deleting]);
      expect(updated.status).toBe(200);
      expect(deleted.status).toBe(400);
    } finally {
      firstGate.release();
      await firstGate.transaction;
    }
    expect(await memberRole(workspaceId, member.user.id)).toBe(
      "serialized-role",
    );

    // Restore the existing member's default role under the same production writer,
    // then force deletion to own 4_002 before the role update queues behind it.
    const restored = await updateWorkspaceMemberRoleNative(
      app,
      owner.cookie,
      workspaceId,
      member.user.id,
      { role: "member" },
    );
    expect(restored.status).toBe(200);
    const pendingDelete = await requestWorkspaceRoleDeletion(
      app,
      owner.cookie,
      workspaceId,
      roleId,
    );
    const secondGate = await holdWorkspaceRoleLock(workspaceId);
    try {
      const deleting = approveWorkspaceRoleDeletion(
        app,
        owner.cookie,
        pendingDelete,
      );
      await waitForAdvisoryWait(4_003);
      const updating = updateWorkspaceMemberRoleNative(
        app,
        owner.cookie,
        workspaceId,
        member.user.id,
        { role: "serialized-role" },
      );
      await waitForQueuedBehindFirstActor();
      secondGate.release();
      const [deleted, updated] = await Promise.all([deleting, updating]);
      expect(deleted.status).toBe(200);
      expect(updated.status).toBe(400);
    } finally {
      secondGate.release();
      await secondGate.transaction;
    }
    expect(await memberRole(workspaceId, member.user.id)).toBe("member");
    expect(await roleRows(workspaceId, "serialized-role")).toHaveLength(0);
  }, 60_000);

  it("serializes invitation acceptance against deletion and leaves a stale invitation pending", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Invitation assignment",
    );

    const firstRole = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "accept-first", permission: { work_item: ["read"] } },
    );
    expect(firstRole.status).toBe(200);
    const firstRoleId = ((await firstRole.json()) as { id: string }).id;
    const firstInviteResponse = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "accept-first@example.com", role: "accept-first" },
    );
    expect(firstInviteResponse.status).toBe(200);
    const firstInviteId = ((await firstInviteResponse.json()) as { id: string })
      .id;
    const firstInvitee = await signUpUser(app, {
      email: "accept-first@example.com",
    });

    // Acceptance gets 4_002 then waits at 4_003; deletion queues behind 4_002.
    const firstGate = await holdWorkspaceRoleLock(workspaceId);
    try {
      const accepting = acceptInvitationNative(
        app,
        firstInvitee.cookie,
        firstInviteId,
      );
      await waitForAdvisoryWait(4_003);
      const deleting = deleteWorkspaceRoleNative(
        app,
        owner.cookie,
        workspaceId,
        firstRoleId,
      );
      await waitForQueuedBehindFirstActor();
      firstGate.release();
      const [accepted, deleted] = await Promise.all([accepting, deleting]);
      expect(accepted.status).toBe(200);
      expect(deleted.status).toBe(400);
    } finally {
      firstGate.release();
      await firstGate.transaction;
    }
    expect(await memberRole(workspaceId, firstInvitee.user.id)).toBe(
      "accept-first",
    );

    const secondRole = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "delete-first", permission: { work_item: ["read"] } },
    );
    expect(secondRole.status).toBe(200);
    const secondRoleId = ((await secondRole.json()) as { id: string }).id;
    const secondInviteResponse = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      { email: "delete-first@example.com", role: "delete-first" },
    );
    expect(secondInviteResponse.status).toBe(200);
    const secondInviteId = (
      (await secondInviteResponse.json()) as { id: string }
    ).id;
    const secondInvitee = await signUpUser(app, {
      email: "delete-first@example.com",
    });

    // Deletion gets 4_002 then waits at 4_003; acceptance queues behind 4_002.
    const pendingDelete = await requestWorkspaceRoleDeletion(
      app,
      owner.cookie,
      workspaceId,
      secondRoleId,
    );
    const secondGate = await holdWorkspaceRoleLock(workspaceId);
    try {
      const deleting = approveWorkspaceRoleDeletion(
        app,
        owner.cookie,
        pendingDelete,
      );
      await waitForAdvisoryWait(4_003);
      const accepting = acceptInvitationNative(
        app,
        secondInvitee.cookie,
        secondInviteId,
      );
      await waitForQueuedBehindFirstActor();
      secondGate.release();
      const [deleted, accepted] = await Promise.all([deleting, accepting]);
      expect(deleted.status).toBe(200);
      expect(accepted.status).toBe(400);
    } finally {
      secondGate.release();
      await secondGate.transaction;
    }

    const [pending] = await db
      .select({ status: schema.invitationTable.status })
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.id, secondInviteId));
    expect(pending?.status).toBe("pending");
    expect(
      await memberRole(workspaceId, secondInvitee.user.id),
    ).toBeUndefined();
  }, 60_000);
});

describe("F2 -- cannot grant a capability you do not hold yourself (RL-3, S7 blueprint Finding F2)", () => {
  it("blocks an admin from creating a role that grants organization:delete, and the escalation chain never gets off the ground", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Ceiling");
    const admin = await inviteAndAcceptAsNewMemberNative(
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
    expect(await created.text()).toMatch(/workspace:delete/);
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
  it("previews a role patch with actual reach counts and leaves data and audit unchanged", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "RoleDryRun");
    const created = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "editor", permission: { work_item: ["read"] } },
    );
    const createdBody = (await created.json()) as {
      id: string;
      version: string;
    };
    await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "editor",
    );
    const before = await roleRows(workspaceId, "editor");
    const historyBefore = await db
      .select({ id: schema.auditLogTable.id })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityType, "workspace_role"),
          eq(schema.auditLogTable.workspaceId, workspaceId),
          eq(schema.auditLogTable.entityId, createdBody.id),
        ),
      );

    const preview = await csrfRequest(
      app,
      `/api/workspace/${workspaceId}/roles/${createdBody.id}?dryRun=true`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: owner.cookie,
        },
        body: JSON.stringify({
          permission: { work_item: ["read", "update"] },
          expectedVersion: createdBody.version,
        }),
      },
      owner.cookie,
    );
    expect(preview.status, await preview.clone().text()).toBe(200);
    expect(await preview.json()).toMatchObject({
      affected: { people: 1, workItems: 0, projects: 0 },
    });
    expect(await roleRows(workspaceId, "editor")).toEqual(before);
    const historyAfter = await db
      .select({ id: schema.auditLogTable.id })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityType, "workspace_role"),
          eq(schema.auditLogTable.workspaceId, workspaceId),
          eq(schema.auditLogTable.entityId, createdBody.id),
        ),
      );
    expect(historyAfter).toEqual(historyBefore);
  });

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
    // `organization:update` is `workspace:update`, which also implies `workspace:read`; the
    // statement view is derived from the stored capabilities.
    expect(body.permission.organization).toEqual(["update"]);
    expect(body.permission.member).toBeUndefined();

    // Prove the OLD grant was actually dropped, not merely that the new
    // field was accepted: a member holding this role can no longer add
    // members (member:create was removed).
    const holder = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "editor",
    );
    const newcomer = await signUpUser(app);
    const addAttempt = await csrfRequest(
      app,
      `/api/workspace/${workspaceId}/members`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: holder.cookie,
        },
        body: JSON.stringify({ userId: newcomer.user.id, role: "viewer" }),
      },
      holder.cookie,
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
      { role: "editor", permission: { work_item: ["read"] } },
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
    const admin = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );
    const created = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "editor", permission: { work_item: ["read"] } },
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
    expect(JSON.parse(row?.permission ?? "{}")).toEqual({
      work_item: ["read"],
    });
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
      { permission: { work_item: ["read"] } },
    );
    expect(updated.status).toBe(404);
  });
});

describe("S7 delete role (DELETE /api/workspace/{id}/roles/{roleId})", () => {
  it("refuses to delete a built-in role even when nobody holds it ('viewer')", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "DeleteViewer",
    );
    const [viewerRole] = await roleRows(workspaceId, "viewer");
    if (!viewerRole) throw new Error("expected a seeded viewer role row");

    // Owner decision, 23 Oct: the six built-ins are real role rows that cannot be deleted.
    const response = await deleteWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      viewerRole.id,
    );
    expect(response.status, await response.clone().text()).toBe(400);
    expect(await roleRows(workspaceId, "viewer")).toHaveLength(1);
  });

  it("deletes an unassigned custom role once the owner approves, and removes the row", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "DeleteCustom",
    );
    const created = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "temp", permission: { work_item: ["read"] } },
    );
    const { id: roleId } = (await created.json()) as { id: string };

    // The route only requests (202); the row is removed when the owner approves.
    const pendingDelete = await requestWorkspaceRoleDeletion(
      app,
      owner.cookie,
      workspaceId,
      roleId,
    );
    expect(await roleRows(workspaceId, "temp")).toHaveLength(1);
    const response = await approveWorkspaceRoleDeletion(
      app,
      owner.cookie,
      pendingDelete,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await roleRows(workspaceId, "temp")).toHaveLength(0);
  });

  it("refuses a role currently held by a member (the ordinary, single-role case)", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Assigned");
    const created = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "custom", permission: { work_item: ["read"] } },
    );
    const { id: roleId } = (await created.json()) as { id: string };
    await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "custom",
    );

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
    const holder = await inviteAndAcceptAsNewMemberNative(
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
      { role: "custom", permission: { work_item: ["read"] } },
    );
    const { id: roleId } = (await created.json()) as { id: string };
    const holder = await inviteAndAcceptAsNewMemberNative(
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

    const pendingDelete = await requestWorkspaceRoleDeletion(
      app,
      owner.cookie,
      workspaceId,
      roleId,
    );
    expect(await roleRows(workspaceId, "custom")).toHaveLength(1);
    const freed = await approveWorkspaceRoleDeletion(
      app,
      owner.cookie,
      pendingDelete,
    );
    expect(freed.status, await freed.clone().text()).toBe(200);
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
    const instanceAdmin = await signUpInstanceAdmin(app);
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
      { role: "shouldnotexist", permission: { work_item: ["read"] } },
    );
    expect(response.status).toBe(403);
    expect(await roleRows(workspaceId, "shouldnotexist")).toHaveLength(0);
  });

  it("the SAME instance admin succeeds once their workspace role actually is admin", async () => {
    const { app } = createApp();
    const instanceAdmin = await signUpInstanceAdmin(app);
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
      { role: "reallyworks", permission: { work_item: ["read"] } },
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

// Issue #108's native-only regression, added ahead of deleting
// prototype-key-role-characterization.test.ts (S10, issue #6). That file
// characterized a divergence between the plugin's own `/organization/
// has-permission` route (which threw a 500 for a role name colliding with
// an `Object.prototype` key, e.g. "toString", because `acRoles["toString"]`
// resolves to the inherited function rather than `undefined`) and native's
// `GET /api/capabilities` (which already failed closed correctly, since
// `workspaceRolePermission`'s exact-match `workspace_role` lookup finds no
// row for "toString" and denies everything). The plugin route is gone with
// S10, so only native's side needs live coverage going forward -- this
// keeps proving it, rather than losing the scenario along with the file
// that used to pin both halves.
describe("#108 a role name colliding with an Object.prototype key gets a clean deny, never a 500", () => {
  it('role = "toString" planted directly on a real membership (no backing workspace_role row named "toString") denies every capability with a plain 200, and a real write route refuses with 403 -- never a 500 or an unhandled exception', async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Prototype");
    const target = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "viewer",
    );

    await setMemberRoleRaw(workspaceId, target.user.id, "toString");

    const capabilities = await app.request(
      `/api/capabilities?workspaceId=${workspaceId}`,
      { headers: { cookie: target.cookie } },
    );
    expect(capabilities.status).toBe(200);
    const body = (await capabilities.json()) as Record<string, boolean>;
    for (const name of Object.keys(CAPABILITY_CHECKS)) {
      expect(body[name], `capability "${name}" should be denied`).toBe(false);
    }

    const write = await csrfRequest(
      app,
      "/api/project",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: target.cookie,
        },
        body: JSON.stringify({
          workspaceId,
          name: "Should Not Be Created",
          slug: "should-not-be-created",
          icon: "Layout",
        }),
      },
      target.cookie,
    );
    expect(write.status).toBe(403);
  });
});
