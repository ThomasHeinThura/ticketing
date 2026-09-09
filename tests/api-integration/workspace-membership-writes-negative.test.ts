/**
 * S5 — the negative tests the retrofit plan's S5 row names explicitly
 * (issue #6, `docs/07-planning/retrofits/organization-plugin-retrofit.md`
 * §3): "last owner cannot leave, cannot self-demote, cannot remove a member
 * of another workspace." Plus the concurrency obligation from the same
 * verification list: the atomic ownership-transfer endpoint, under
 * concurrent use, must not be able to leave a workspace with zero owners.
 *
 * Kept in their own file, separate from `workspace-membership-writes.test.ts`,
 * so the required set is easy to find and audit on its own.
 *
 * THE QUALITY BAR THIS FILE IS WRITTEN AGAINST: a check that counts rows the
 * caller already fetched, rather than counting inside the same transaction
 * as the write, races. Every probe below that could plausibly race is run
 * CONCURRENTLY, with `Promise.all`, against a real PostgreSQL -- not
 * asserted sequentially and assumed to generalise.
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
  leaveWorkspaceNative,
  removeWorkspaceMemberNative,
  transferWorkspaceOwnershipNative,
  updateWorkspaceMemberRoleNative,
} from "./helpers/workspace-membership-write-http";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

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

async function membershipRole(
  workspaceId: string,
  userId: string,
): Promise<string | undefined> {
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

async function ownerCount(workspaceId: string): Promise<number> {
  const owners = await db
    .select({ userId: schema.workspaceUserTable.userId })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.role, "owner"),
      ),
    );
  return owners.length;
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("S5 REQUIRED: last owner cannot leave", () => {
  it("the workspace's only owner is refused when they try to leave", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Solo Owner");

    const left = await leaveWorkspaceNative(app, owner.cookie, workspaceId);
    expect(left.status).toBe(400);

    // The membership row survives untouched.
    expect(await membershipRole(workspaceId, owner.user.id)).toBe("owner");
    expect(await ownerCount(workspaceId)).toBe(1);
  });

  it("the same refusal applies to removing the only owner via DELETE, not only via leave", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Solo Owner Delete",
    );

    const removed = await removeWorkspaceMemberNative(
      app,
      owner.cookie,
      workspaceId,
      owner.user.id,
    );
    expect(removed.status).toBe(400);
    expect(await membershipRole(workspaceId, owner.user.id)).toBe("owner");
    expect(await ownerCount(workspaceId)).toBe(1);
  });

  it("an owner CAN leave once ownership has been transferred away first", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Transfer Then Leave",
    );
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    const transferred = await transferWorkspaceOwnershipNative(
      app,
      owner.cookie,
      workspaceId,
      { newOwnerUserId: member.user.id },
    );
    expect(transferred.status).toBe(200);

    // Now an admin, not the only owner -- leaving is safe.
    const left = await leaveWorkspaceNative(app, owner.cookie, workspaceId);
    expect(left.status).toBe(200);
    expect(await membershipRole(workspaceId, owner.user.id)).toBeUndefined();
    expect(await ownerCount(workspaceId)).toBe(1);
  });
});

describe("S5 REQUIRED: cannot self-demote", () => {
  it("the owner cannot change their OWN role away from owner through the generic role-update route", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "No Self Demote",
    );

    const updated = await updateWorkspaceMemberRoleNative(
      app,
      owner.cookie,
      workspaceId,
      owner.user.id,
      { role: "admin" },
    );
    expect(updated.status).toBe(400);
    expect(await membershipRole(workspaceId, owner.user.id)).toBe("owner");
  });

  it("this holds even when a second owner exists -- the owner role can only ever change via transfer-ownership", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "Two Owners");
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    // Seed a second owner directly -- this route must refuse the demote
    // unconditionally, not merely "when it would be the last owner".
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "owner" })
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          eq(schema.workspaceUserTable.userId, member.user.id),
        ),
      );
    expect(await ownerCount(workspaceId)).toBe(2);

    const updated = await updateWorkspaceMemberRoleNative(
      app,
      owner.cookie,
      workspaceId,
      owner.user.id,
      { role: "admin" },
    );
    expect(updated.status).toBe(400);
    expect(await membershipRole(workspaceId, owner.user.id)).toBe("owner");
  });
});

describe("S5 REQUIRED: cannot remove a member of another workspace", () => {
  it("an admin of workspace A cannot remove a member who only belongs to workspace B", async () => {
    const { app } = createApp();
    const ownerA = await signUpUser(app);
    const ownerB = await signUpUser(app);
    const workspaceA = await createWorkspace(app, ownerA.cookie, "Alpha");
    const workspaceB = await createWorkspace(app, ownerB.cookie, "Bravo");
    const adminA = await inviteAndAcceptAsNewMember(
      app,
      ownerA.cookie,
      workspaceA,
      "admin",
    );
    const memberB = await inviteAndAcceptAsNewMember(
      app,
      ownerB.cookie,
      workspaceB,
      "member",
    );

    const removed = await removeWorkspaceMemberNative(
      app,
      adminA.cookie,
      workspaceA,
      memberB.user.id,
    );
    // Not found in A -- 404, never 200, and B's row is completely untouched.
    expect(removed.status).toBe(404);
    expect(await membershipRole(workspaceB, memberB.user.id)).toBe("member");
  });

  it("the same boundary holds for a role update: an admin of A cannot change a B-only member's role", async () => {
    const { app } = createApp();
    const ownerA = await signUpUser(app);
    const ownerB = await signUpUser(app);
    const workspaceA = await createWorkspace(app, ownerA.cookie, "Alpha2");
    const workspaceB = await createWorkspace(app, ownerB.cookie, "Bravo2");
    const adminA = await inviteAndAcceptAsNewMember(
      app,
      ownerA.cookie,
      workspaceA,
      "admin",
    );
    const memberB = await inviteAndAcceptAsNewMember(
      app,
      ownerB.cookie,
      workspaceB,
      "member",
    );

    const updated = await updateWorkspaceMemberRoleNative(
      app,
      adminA.cookie,
      workspaceA,
      memberB.user.id,
      { role: "admin" },
    );
    expect(updated.status).toBe(404);
    expect(await membershipRole(workspaceB, memberB.user.id)).toBe("member");
  });
});

describe("S5 REQUIRED: the atomic transfer endpoint under concurrent use cannot leave zero (or two) owners", () => {
  it("two concurrent transfers from the SAME owner to two different targets: exactly one succeeds", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Concurrent Transfer",
    );
    const admin1 = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );
    const admin2 = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );

    // Fired together, against the SAME owner cookie, at the SAME workspace.
    // `lockWorkspaceMembership`'s advisory lock (workspace-membership-lock.ts)
    // must serialize these: whichever commits first demotes the owner to
    // admin, and the second transaction's re-read of the caller's role --
    // taken only after it acquires the lock the first one just released --
    // must see "admin", not "owner", and refuse.
    const [result1, result2] = await Promise.all([
      transferWorkspaceOwnershipNative(app, owner.cookie, workspaceId, {
        newOwnerUserId: admin1.user.id,
      }),
      transferWorkspaceOwnershipNative(app, owner.cookie, workspaceId, {
        newOwnerUserId: admin2.user.id,
      }),
    ]);

    const statuses = [result1.status, result2.status].sort();
    // Exactly one 200 and one refusal (403 CallerNotOwnerError) -- never two
    // 200s (which would mean two owners momentarily existed and one demote
    // was lost) and never two failures (which would mean the workspace kept
    // its original owner and the whole probe proved nothing).
    expect(statuses).toEqual([200, 403]);

    // The database has EXACTLY one owner, whichever of admin1/admin2 won.
    const owners = await db
      .select({ userId: schema.workspaceUserTable.userId })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          eq(schema.workspaceUserTable.role, "owner"),
        ),
      );
    expect(owners).toHaveLength(1);
    expect([admin1.user.id, admin2.user.id]).toContain(owners[0]?.userId);

    // The original owner is demoted exactly once, to admin -- not owner,
    // and not something stranger produced by two interleaved writes.
    expect(await membershipRole(workspaceId, owner.user.id)).toBe("admin");
  });

  it("two concurrent leaves from two owners (seeded directly) cannot both succeed and cannot leave zero owners", async () => {
    // This is the adversarial setup the atomic transfer endpoint is designed
    // to make unreachable in practice (transfer always leaves exactly one
    // owner) -- seeded directly here so the invariant can be tested even
    // though the only in-product path to it is closed.
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "Two Owners Leave",
    );
    const second = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "owner" })
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          eq(schema.workspaceUserTable.userId, second.user.id),
        ),
      );
    expect(await ownerCount(workspaceId)).toBe(2);

    const [left1, left2] = await Promise.all([
      leaveWorkspaceNative(app, owner.cookie, workspaceId),
      leaveWorkspaceNative(app, second.cookie, workspaceId),
    ]);

    const statuses = [left1.status, left2.status].sort();
    // Exactly one leave succeeds; the other, re-reading AFTER the lock is
    // free, finds only one owner left and refuses rather than racing to
    // zero.
    expect(statuses).toEqual([200, 400]);
    expect(await ownerCount(workspaceId)).toBe(1);
  });
});
