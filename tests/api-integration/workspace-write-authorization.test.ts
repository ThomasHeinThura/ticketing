/**
 * S4 — authorization on the native workspace write routes. Issue #6
 * (retrofit plan §3 S4 row, risks R4/R5/R10), issue #66.
 *
 * Three separate obligations, kept separate on purpose:
 *
 *  1. CROSS-WORKSPACE. A write must act on the workspace the caller was
 *     authorized against and no other. The plugin took the target from the
 *     request body; these routes take it from the path and re-resolve
 *     membership through `workspaceAccess.fromParam`.
 *
 *  2. ROLE. Update needs `organization:update`, delete needs
 *     `organization:delete` — the inherited capability keys, which are what
 *     the seeded `workspace_role` rows actually carry. Re-keying them to the
 *     TaskDesk `workspace:*` vocabulary is #7's capability migration
 *     (retrofit plan §3.1 item 1) and is deliberately NOT done here.
 *
 *  3. INSTANCE ADMIN. The inherited routes refused a non-member outright —
 *     better-auth has no notion of a TaskDesk instance admin. TaskDesk's
 *     shared path does, in two places, so these routes carry an explicit
 *     membership precondition; see `require-workspace-membership.ts`.
 *     A SECOND instance-admin boundary — an instance admin who IS a member
 *     but whose OWN workspace role does not grant the capability — used to
 *     be a pinned, unfixed finding here (`hasWorkspacePermission` short-
 *     circuits on `isInstanceAdmin`). Thomas's decision (2026-09-08): do not
 *     bless that bypass on routes THIS batch adds. It is now closed by
 *     `apps/api/src/utils/require-workspace-role-authority.ts`, and A2-P17
 *     below asserts the closed behaviour rather than the defect.
 *
 *  4. #66. Authority must not become broader because a role row is absent.
 *     The half S4 owns is the SOURCE of that state (see the atomicity file).
 *     The shared fail-open fallback in `hasWorkspacePermission` is #66's
 *     second step, is blocked behind S7, and is pinned here — preserved as
 *     evidence, not fixed, and not weakened.
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
import {
  createWorkspaceNative,
  deleteWorkspaceNative,
  updateWorkspaceNative,
} from "./helpers/workspace-write-http";

async function createWorkspace(
  app: ReturnType<typeof createApp>["app"],
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
 * Narrow a workspace's own definition of `role` by removing one capability
 * key from the row the create transaction seeded.
 *
 * Read-modify-write on the ACTUAL row rather than re-deriving the payload
 * from `@taskdesk/permissions`: this is what an admin narrowing a role in
 * the Roles UI does, and it keeps the probe honest if the seeded payload
 * ever changes.
 */
async function narrowSeededRole(
  workspaceId: string,
  role: string,
  capabilityKey: string,
) {
  const [row] = await db
    .select({ permission: schema.workspaceRoleTable.permission })
    .from(schema.workspaceRoleTable)
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, workspaceId),
        eq(schema.workspaceRoleTable.role, role),
      ),
    );
  if (!row) throw new Error(`expected a seeded ${role} row`);
  const permission = JSON.parse(row.permission) as Record<string, string[]>;
  expect(permission[capabilityKey]).toBeDefined();
  delete permission[capabilityKey];

  await db
    .update(schema.workspaceRoleTable)
    .set({ permission: JSON.stringify(permission) })
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, workspaceId),
        eq(schema.workspaceRoleTable.role, role),
      ),
    );
}

/**
 * THE TRAP THIS AVOIDS. `databaseHooks.user.create.after` promotes the FIRST
 * user on the instance to instance admin (`apps/api/src/auth.ts`), and both
 * `validateWorkspaceAccess` and `hasWorkspacePermission` short-circuit for
 * instance admins. A boundary test whose actor happened to be the first
 * sign-up would therefore measure the BYPASS and pass for the wrong reason —
 * which is what the first run of A2-P11 did.
 *
 * Every test below burns the promotion on a throwaway user first, and
 * `expectOrdinaryUser` re-checks each actor against the database rather than
 * trusting that ordering.
 */
async function bootstrapInstanceAdmin(
  app: ReturnType<typeof createApp>["app"],
) {
  await signUpUser(app);
}

async function expectOrdinaryUser(userId: string) {
  const [row] = await db
    .select({ role: schema.userTable.role })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId));
  expect(row?.role).not.toBe("admin");
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("S4 native writes: cross-workspace and role boundaries (A2-P11..A2-P15)", () => {
  it("A2-P11 a member of workspace A cannot update or delete workspace B", async () => {
    const { app } = createApp();
    await bootstrapInstanceAdmin(app);
    const ownerA = await signUpUser(app);
    const ownerB = await signUpUser(app);
    await expectOrdinaryUser(ownerA.user.id);
    await expectOrdinaryUser(ownerB.user.id);
    const workspaceA = await createWorkspace(app, ownerA.cookie, "Alpha");
    const workspaceB = await createWorkspace(app, ownerB.cookie, "Bravo");

    // ownerA is a full owner — of A. That authority must not reach B.
    const update = await updateWorkspaceNative(app, ownerA.cookie, workspaceB, {
      name: "Hijacked",
    });
    expect(update.status).not.toBe(200);
    expect([401, 403, 404]).toContain(update.status);

    const remove = await deleteWorkspaceNative(app, ownerA.cookie, workspaceB);
    expect(remove.status).not.toBe(200);
    expect([401, 403, 404]).toContain(remove.status);

    // B is untouched, and A still exists.
    const [rowB] = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspaceB));
    expect(rowB?.name).toBe("Bravo");
    const [rowA] = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspaceA));
    expect(rowA).toBeTruthy();
  });

  it("A2-P12 a non-member is refused, and the refusal does not disclose the workspace", async () => {
    const { app } = createApp();
    await bootstrapInstanceAdmin(app);
    const owner = await signUpUser(app);
    const stranger = await signUpUser(app);
    await expectOrdinaryUser(stranger.user.id);
    const workspaceId = await createWorkspace(app, owner.cookie, "Private");

    const update = await updateWorkspaceNative(
      app,
      stranger.cookie,
      workspaceId,
      { name: "Nope" },
    );
    expect([401, 403, 404]).toContain(update.status);
    expect(await update.text()).not.toContain("Private");

    const remove = await deleteWorkspaceNative(
      app,
      stranger.cookie,
      workspaceId,
    );
    expect([401, 403, 404]).toContain(remove.status);

    const rows = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspaceId));
    expect(rows).toHaveLength(1);
  });

  it("A2-P13 viewer and member cannot update; admin can update but cannot delete; owner can delete", async () => {
    const { app } = createApp();
    await bootstrapInstanceAdmin(app);
    const owner = await signUpUser(app);
    await expectOrdinaryUser(owner.user.id);
    const workspaceId = await createWorkspace(app, owner.cookie, "Roles");

    const viewer = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "viewer",
    );
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );
    const admin = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );

    expect(
      (
        await updateWorkspaceNative(app, viewer.cookie, workspaceId, {
          name: "Viewer Rename",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await updateWorkspaceNative(app, member.cookie, workspaceId, {
          name: "Member Rename",
        })
      ).status,
    ).toBe(403);

    expect(
      (
        await updateWorkspaceNative(app, admin.cookie, workspaceId, {
          name: "Admin Rename",
        })
      ).status,
    ).toBe(200);

    // Delete is owner-only: the seeded admin payload carries
    // organization:update but not organization:delete.
    expect(
      (await deleteWorkspaceNative(app, admin.cookie, workspaceId)).status,
    ).toBe(403);
    expect(
      (await deleteWorkspaceNative(app, viewer.cookie, workspaceId)).status,
    ).toBe(403);

    const stillThere = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspaceId));
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0]?.name).toBe("Admin Rename");

    expect(
      (await deleteWorkspaceNative(app, owner.cookie, workspaceId)).status,
    ).toBe(200);
    expect(
      await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId)),
    ).toHaveLength(0);
  });

  it("A2-P14 a NARROWED admin role row is enforced — the DB row wins over the compiled definition while it exists", async () => {
    const { app } = createApp();
    await bootstrapInstanceAdmin(app);
    const owner = await signUpUser(app);
    await expectOrdinaryUser(owner.user.id);
    const workspaceId = await createWorkspace(app, owner.cookie, "Narrowed");
    const admin = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );

    // Admin can update before the narrowing.
    expect(
      (
        await updateWorkspaceNative(app, admin.cookie, workspaceId, {
          name: "Before Narrowing",
        })
      ).status,
    ).toBe(200);

    // Narrow the workspace's own admin definition: drop organization:update.
    await narrowSeededRole(workspaceId, "admin", "organization");

    const afterNarrowing = await updateWorkspaceNative(
      app,
      admin.cookie,
      workspaceId,
      { name: "After Narrowing" },
    );
    expect(afterNarrowing.status).toBe(403);

    const [row] = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspaceId));
    expect(row?.name).toBe("Before Narrowing");
  });

  // A2-P15 — PINNED OPEN DEBT. Issue #66 is OPEN and lives in
  // `hasWorkspacePermission`, a SHARED authorization file this lane does not
  // own (AGENTS.md shared-contract ownership) — this lane may not fix it.
  //
  // A test that asserts an escalation is a test that protects it — the
  // sharper lesson this batch already learned and closed for A2-P17 (below),
  // which used to assert 200 for a viewer-who-is-instance-admin until the
  // bypass it measured was closed. This case pins the SAME shape of defect
  // in code this lane does not own, so it cannot close it the same way — but
  // it must not read as an assertion that the defect is correct behaviour.
  //
  // THE DEFECT: `hasWorkspacePermission` falls back to the COMPILED static
  // role definitions whenever a `workspace_role` DB row is absent, and
  // `admin`'s compiled definition diverges from the seeded DB row on 16 of
  // 16 capabilities. Deleting the narrowed admin row therefore silently
  // RESTORES full compiled admin authority — a narrowing undone by a delete.
  // #66's second ordered fix ("remove the fail-open fallback, or replace it
  // with a fail-closed / explicit recovery mechanism") is blocked behind S7
  // and is explicitly out of this batch's scope.
  //
  // What S4 DOES change is the supply: after this batch, no native create can
  // produce this state, because the seed is inside the create transaction
  // (see workspace-write-create-atomicity.test.ts). Reaching it still needs
  // raw database access, exactly as #65 measured.
  //
  // THE ASSERTION BELOW IS THE CURRENT (DEFECTIVE) VALUE, NOT THE CORRECT
  // ONE. The expected value AFTER #66 closes is 403 (a refusal) — the moment
  // the fail-open fallback is removed or made fail-closed, this test FAILS
  // LOUDLY here ("expected 200, received 403"), and that failure is the
  // signal: update the assertion to `403` in the SAME commit that closes
  // #66. Leaving it at 200 past that point would turn this test from a
  // pin into a guard for the escalation.
  it("A2-P15 PINNED (#66 OPEN, not this lane's to fix): deleting the narrowed admin row currently re-escalates via the compiled-role fallback — must become 403 when #66 closes", async () => {
    const { app } = createApp();
    await bootstrapInstanceAdmin(app);
    const owner = await signUpUser(app);
    await expectOrdinaryUser(owner.user.id);
    const workspaceId = await createWorkspace(app, owner.cookie, "Fallback");
    const admin = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );

    await narrowSeededRole(workspaceId, "admin", "organization");
    expect(
      (
        await updateWorkspaceNative(app, admin.cookie, workspaceId, {
          name: "Denied While Narrowed",
        })
      ).status,
    ).toBe(403);

    // The delete-after-narrow escalation.
    await db
      .delete(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, workspaceId),
          eq(schema.workspaceRoleTable.role, "admin"),
        ),
      );

    const afterDelete = await updateWorkspaceNative(
      app,
      admin.cookie,
      workspaceId,
      { name: "Escalated" },
    );
    // CURRENT (DEFECTIVE) VALUE — pinned open debt, issue #66, not this
    // lane's to fix. This is NOT an assertion that 200 is correct behaviour;
    // it is the reproduction, kept green so the escalation stays visible
    // instead of silently fixed-and-forgotten or silently protected.
    // EXPECTED VALUE AFTER #66 CLOSES: 403. Change this line to
    // `.toBe(403)` in the SAME commit that closes #66.
    expect(afterDelete.status).toBe(200);
  });
});

describe("S4 native writes: the instance-admin boundary (A2-P16..A2-P17)", () => {
  it("A2-P16 an instance admin who is NOT a member cannot rename or delete a workspace", async () => {
    // The inherited routes refused a non-member outright, and better-auth has
    // no instance-admin concept at all. Mounting these writes on TaskDesk's
    // shared path alone would have handed every instance admin the authority
    // to delete ANY workspace on the instance — a new power acquired silently
    // as a side effect of moving a route. `requireWorkspaceMembership` is what
    // stops that, and this is the probe that proves it.
    const { app } = createApp();
    const instanceAdmin = await signUpUser(app);
    const owner = await signUpUser(app);
    await expectOrdinaryUser(owner.user.id);

    const [adminRow] = await db
      .select({ role: schema.userTable.role })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, instanceAdmin.user.id));
    expect(adminRow?.role).toBe("admin");

    const workspaceId = await createWorkspace(app, owner.cookie, "Not Theirs");

    const update = await updateWorkspaceNative(
      app,
      instanceAdmin.cookie,
      workspaceId,
      { name: "Renamed By Instance Admin" },
    );
    expect(update.status).toBe(403);

    const remove = await deleteWorkspaceNative(
      app,
      instanceAdmin.cookie,
      workspaceId,
    );
    expect(remove.status).toBe(403);

    const [row] = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspaceId));
    expect(row?.name).toBe("Not Theirs");
  });

  // A2-P17. CLOSED by `require-workspace-role-authority.ts`, not pinned.
  //
  // `hasWorkspacePermission` short-circuits on `isInstanceAdmin` before it
  // ever reads the caller's workspace role, so an instance admin who IS a
  // member passes THAT function's own check whatever their role says. Under
  // the inherited plugin a `viewer` member could not update a workspace,
  // instance admin or not — and Thomas's decision (2026-09-08) is that these
  // two mutation routes must not bless the bypass either. This batch adds an
  // independent, additive guard —
  // `requireWorkspaceRoleAuthority` — that resolves the SAME instance admin's
  // authority from their own workspace-role row instead, and refuses the
  // request when that row does not grant it. The shared `hasWorkspacePermission`
  // function itself is untouched; every OTHER route that depends on it is
  // unaffected by this file.
  it("A2-P17 an instance admin who is a VIEWER member is refused — the bypass does not reach this route", async () => {
    const { app } = createApp();
    const instanceAdmin = await signUpUser(app);
    const owner = await signUpUser(app);
    const [adminRow] = await db
      .select({ role: schema.userTable.role })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, instanceAdmin.user.id));
    expect(adminRow?.role).toBe("admin");
    const workspaceId = await createWorkspace(app, owner.cookie, "Shared Eval");

    // Make the instance admin a plain viewer of this workspace.
    await db.insert(schema.workspaceUserTable).values({
      workspaceId,
      userId: instanceAdmin.user.id,
      role: "viewer",
      joinedAt: new Date(),
    });

    const update = await updateWorkspaceNative(
      app,
      instanceAdmin.cookie,
      workspaceId,
      { name: "Viewer Who Is Instance Admin" },
    );
    expect(update.status).toBe(403);

    const remove = await deleteWorkspaceNative(
      app,
      instanceAdmin.cookie,
      workspaceId,
    );
    expect(remove.status).toBe(403);

    const [row] = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspaceId));
    expect(row?.name).toBe("Shared Eval");
  });

  it("A2-P17b an instance admin who is a genuine ADMIN member can still update — the guard checks real authority, not merely instance-admin-ness", async () => {
    const { app } = createApp();
    const instanceAdmin = await signUpUser(app);
    const owner = await signUpUser(app);
    const [adminRow] = await db
      .select({ role: schema.userTable.role })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, instanceAdmin.user.id));
    expect(adminRow?.role).toBe("admin");
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Shared Eval Admin",
    );

    await db.insert(schema.workspaceUserTable).values({
      workspaceId,
      userId: instanceAdmin.user.id,
      role: "admin",
      joinedAt: new Date(),
    });

    const update = await updateWorkspaceNative(
      app,
      instanceAdmin.cookie,
      workspaceId,
      { name: "Admin Who Is Instance Admin" },
    );
    expect(update.status).toBe(200);

    // The seeded `admin` row carries `organization:update` but not `delete`
    // (only `owner`'s compiled definition does) — same shape as A2-P13.
    const remove = await deleteWorkspaceNative(
      app,
      instanceAdmin.cookie,
      workspaceId,
    );
    expect(remove.status).toBe(403);
  });

  it("A2-P17c an instance admin who is the workspace's OWNER can still delete it — the never-seeded owner row is not treated as a missing row", async () => {
    // Retrofit plan R5: `owner` is deliberately never given a `workspace_role`
    // DB row; its authority is always the compiled definition. The single
    // most common real deployment shape is the first user, who is both the
    // instance's admin AND the owner of the workspace they create — this
    // probe is what stops the A2-P17 fix from silently locking that person
    // out of their own workspace.
    const { app } = createApp();
    const instanceAdminOwner = await signUpUser(app);
    const [adminRow] = await db
      .select({ role: schema.userTable.role })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, instanceAdminOwner.user.id));
    expect(adminRow?.role).toBe("admin");
    const workspaceId = await createWorkspace(
      app,
      instanceAdminOwner.cookie,
      "Owned By Instance Admin",
    );

    const [ownerRow] = await db
      .select({ role: schema.workspaceUserTable.role })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          eq(schema.workspaceUserTable.userId, instanceAdminOwner.user.id),
        ),
      );
    expect(ownerRow?.role).toBe("owner");
    const [seededOwnerRoleRow] = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, workspaceId),
          eq(schema.workspaceRoleTable.role, "owner"),
        ),
      );
    expect(seededOwnerRoleRow).toBeUndefined();

    const update = await updateWorkspaceNative(
      app,
      instanceAdminOwner.cookie,
      workspaceId,
      { name: "Still Mine" },
    );
    expect(update.status).toBe(200);

    const remove = await deleteWorkspaceNative(
      app,
      instanceAdminOwner.cookie,
      workspaceId,
    );
    expect(remove.status).toBe(200);
  });
});
