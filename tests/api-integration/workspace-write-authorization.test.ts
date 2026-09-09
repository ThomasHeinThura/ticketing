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
 *  4. #66, CLOSED. Authority must not become broader because a role row is
 *     absent. The half S4 owned was the SOURCE of that state (see the
 *     atomicity file) — S4 guaranteed the seed for its own native create
 *     transaction, but the shared fail-open fallback in
 *     `hasWorkspacePermission` was a different file's fix. #66 removed that
 *     fallback: a missing row now denies for every role but `owner`. A2-P15
 *     below used to be a PINNED reproduction of the escalation, kept green
 *     on purpose to make the open gap visible; it now asserts the closed
 *     behaviour (403), the same shape A2-P17 already went through for the
 *     instance-admin bypass.
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

  // A2-P15 — CLOSED by issue #66. This test used to be PINNED OPEN DEBT:
  // `hasWorkspacePermission` fell back to the COMPILED static role
  // definitions whenever a `workspace_role` DB row was absent, and
  // `admin`'s compiled definition diverged from the seeded DB row on 16 of
  // 16 capabilities — so deleting the narrowed admin row silently RESTORED
  // full compiled admin authority, a narrowing undone by a delete. #66
  // removed that fallback: `require-workspace-permission.ts` now denies
  // (rather than falls back) for any role other than `owner` when no row
  // matches, exactly the rule `require-workspace-role-authority.ts` already
  // used for the instance-admin boundary below.
  //
  // What S4 changed was the supply: no native create can produce this state,
  // because the seed is inside the create transaction (see
  // workspace-write-create-atomicity.test.ts). Reaching it still needs raw
  // database access, exactly as #65 measured — this probe constructs it
  // directly, as the attack does.
  it("A2-P15 deleting the narrowed admin row does NOT re-escalate — it stays 403 (issue #66 closed)", async () => {
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

    // The delete-after-narrow escalation attempt.
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
    // The narrowing survives the delete: no compiled-role fallback, no
    // escalation.
    expect(afterDelete.status).toBe(403);

    const [row] = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspaceId));
    expect(row?.name).toBe("Fallback");
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

/**
 * A2-P25/A2-P26 -- the RBAC evaluator's own membership read must not be
 * nondeterministic.
 *
 * Three independent reviewers converged on this from opposite sides: the
 * independent Opus security review of this pull request (as its MEDIUM 1), the
 * correctness-lens Sonnet reviewer of this pull request (as a HIGH, flagged as
 * an authorization-boundary defect), and the independent Opus review of #77 (as
 * its H2). All three named the same two functions.
 *
 * `require-workspace-permission.ts` and `require-workspace-role-authority.ts`
 * both read the caller's membership with `.limit(1)` and no `ORDER BY`, over a
 * table (`workspace_member`) with no UNIQUE constraint on
 * `(workspace_id, user_id)`. So with two rows for one pair the evaluator could
 * return either role and therefore GRANT or DENY depending on scan order --
 * measured by the reviewer at owner-row-first 200 versus viewer-row-first 403,
 * stable over twelve runs. The grant direction is the escalation direction.
 *
 * It was not a regression -- the reviewer enumerated every case and found no
 * input where the pre-#80 code denied and this head granted -- but on merge it
 * would have become the one uncovered read of seven, with #77 skipping these
 * two files precisely because #80 lands first. Fixed here instead of handed
 * over, so nothing depends on remembering.
 *
 * Both now read ALL rows and refuse when the answer is ambiguous. Fail-closed:
 * a corrupt authorization state is refused, never resolved by guessing. Issue
 * #88's `UNIQUE (workspace_id, user_id)` constraint makes the case unreachable,
 * at which point these two probes become vacuous -- and that is the correct
 * failure, not a false one.
 */
describe("A2-P25/A2-P26 the evaluator refuses an ambiguous membership rather than guessing", () => {
  it("A2-P25 a member with TWO rows is denied, whichever row a scan would return first", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "A2-P25");
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );

    // Baseline: one row, real "admin" authority, the update succeeds. Without
    // this the denial below could be passing for an unrelated reason.
    const before = await updateWorkspaceNative(
      app,
      member.cookie,
      workspaceId,
      {
        name: "Renamed By Admin",
      },
    );
    expect(before.status).toBe(200);

    // Now the same member holds a second, lower row. The rows disagree, so the
    // answer is not derivable and must be refused -- regardless of order.
    await db.insert(schema.workspaceUserTable).values({
      workspaceId,
      userId: member.user.id,
      role: "viewer",
      joinedAt: new Date(),
    });

    const after = await updateWorkspaceNative(app, member.cookie, workspaceId, {
      name: "Renamed While Ambiguous",
    });
    expect(after.status).toBe(403);
  });

  it("A2-P26 two rows that AGREE are still refused -- the rule is one row, not one distinct role", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "A2-P26");
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );

    // Deliberately duplicate the SAME role. A reduction that asked "do all rows
    // agree?" would grant here; the rule is cardinality, because a duplicated
    // membership row is a corrupt state whatever it says, and #77's reviewer
    // showed that two reductions disagreeing on exactly this shape locked an
    // owner out of their own transfer route.
    await db.insert(schema.workspaceUserTable).values({
      workspaceId,
      userId: member.user.id,
      role: "admin",
      joinedAt: new Date(),
    });

    const response = await updateWorkspaceNative(
      app,
      member.cookie,
      workspaceId,
      { name: "Renamed With Duplicate Admin" },
    );
    expect(response.status).toBe(403);
  });

  it("A2-P27 the INSTANCE-ADMIN path refuses an ambiguous membership -- the only probe that reaches the twin guard", async () => {
    // WHY THIS PROBE EXISTS, and it is the more interesting half of the fix.
    //
    // `requireWorkspacePermission` short-circuits to `true` for an instance
    // admin (`require-workspace-permission.ts:105-107`) BEFORE it reads
    // membership at all. So for that one caller the membership read that
    // decides authority is NOT the one in `requireWorkspacePermission` -- it is
    // the one in `require-workspace-role-authority.ts`, the twin, which
    // early-returns `next()` for everybody else.
    //
    // A2-P25 and A2-P26 use an ordinary invited `admin`, so they never execute
    // the twin: the first guard refuses them and the request never gets there.
    // Which means the twin's half of this fix was UNTESTED, and the commit that
    // introduced it claimed both twins were "fixed together" while its
    // non-vacuity evidence covered only one -- the exact failure mode that
    // commit message itself named. Found by the independent Opus delta review
    // of #80, which showed the twin's guard could be deleted outright with the
    // entire 41-file suite still green.
    const { app } = createApp();

    // The first user to sign up on a fresh instance becomes the instance admin.
    const instanceAdmin = await signUpUser(app);
    const [adminRow] = await db
      .select({ role: schema.userTable.role })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, instanceAdmin.user.id));
    expect(adminRow?.role).toBe("admin");

    // They must also be a MEMBER, or `requireWorkspaceMembership` refuses first
    // and the twin is still never reached -- so they create the workspace
    // themselves and own it.
    const workspaceId = await createWorkspace(
      app,
      instanceAdmin.cookie,
      "A2-P27",
    );

    // Baseline: one row, allowed. Without this the refusal below could be
    // passing for an unrelated reason.
    const before = await updateWorkspaceNative(
      app,
      instanceAdmin.cookie,
      workspaceId,
      { name: "Renamed With One Row" },
    );
    expect(before.status).toBe(200);

    // Two rows: ambiguous. The first guard still grants (instance-admin
    // short-circuit), so a 403 here can ONLY have come from the twin.
    await db.insert(schema.workspaceUserTable).values({
      workspaceId,
      userId: instanceAdmin.user.id,
      role: "viewer",
      joinedAt: new Date(),
    });

    const after = await updateWorkspaceNative(
      app,
      instanceAdmin.cookie,
      workspaceId,
      { name: "Renamed While Ambiguous" },
    );
    expect(after.status).toBe(403);
  });
});
