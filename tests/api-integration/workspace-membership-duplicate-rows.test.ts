/**
 * `workspace_member` (`workspaceUserTable`, `apps/api/src/database/schema.ts`) carries NO
 * UNIQUE constraint on `(workspace_id, user_id)` -- only two plain, non-unique indexes -- so
 * two membership rows for the same user in the same workspace are a state the database
 * permits. It is API-reachable today: better-auth's `acceptInvitation` (`crud-invites.mjs`,
 * the `adapter.createMember(...)` call) has no existing-member check and takes no lock --
 * invite a user who is not yet a member (invitation goes pending), add that same user through
 * the native add route (`POST /api/workspace/{id}/members`), then have them accept the
 * still-pending invitation, and the pair now has two rows.
 *
 * P1 below is the non-vacuity control for the whole file: it proves the schema still permits
 * that state with a direct `db.insert`, so the other three probes prove something real. **If
 * a UNIQUE constraint is ever added to `(workspace_id, user_id)`** -- the durable fix, tracked
 * separately because it needs its own migration and a duplicate-data audit first, and
 * deliberately NOT shipped in this change -- **P1 fails and every other probe in this file
 * becomes vacuous; that is the correct failure, not a false one.**
 *
 * P2-P4 seed the duplicate-row state directly with `db.insert`/`db.update` rather than
 * reproducing the full invite -> add -> accept HTTP race end to end, the same way
 * `workspace-membership-writes-negative.test.ts` seeds a second owner directly for its own
 * concurrent-leave probe ("seeded directly here so the invariant can be tested even though
 * the only in-product path to it is closed"): P1 proves the state is reachable, so it is fine
 * to produce it directly and test what happens once it exists.
 *
 * THE QUALITY BAR THIS FILE IS WRITTEN AGAINST, same as its sibling
 * `workspace-membership-writes-negative.test.ts`: assertions on real PostgreSQL database
 * state and real HTTP status codes, `resetTestDatabase()` before every test, no mocks.
 *
 * MAKING THE PROBES DETERMINISTIC -- READ THIS BEFORE CHANGING ANY PROBE BELOW. A `LIMIT 1`
 * read with no `ORDER BY` is not free to return any row it likes: it returns whatever its
 * query plan's scan order produces, and that order is an implementation detail, not a
 * contract. It is NOT SAFE to assume it fires the defect just because a duplicate row exists
 * -- it must be forced, and the forcing must be verified against the actual plan the
 * production code's own query gets, not against a "sequential scan on freshly inserted rows"
 * assumption. Measured empirically against this database: the read every site here does (an
 * `and(eq(workspaceId), eq(userId))` predicate with two separate single-column indexes
 * available) gets planned as an INDEX SCAN on the `workspace_id` index, and for that
 * predicate, an ordinary `UPDATE` of a non-indexed column (e.g. `joined_at`) on the row you
 * want de-prioritized does NOT change its position -- because Postgres performs it as a HOT
 * (Heap-Only Tuple) update, which reuses the SAME index entry (only the heap tuple moves;
 * `joined_at`/`role` are not indexed columns, so no new index entry is created), so the row
 * that update touched keeps sorting exactly where it always did. What DOES move a row's
 * position in this plan, confirmed with an ad-hoc `ctid`/`EXPLAIN` probe before writing these
 * assertions: deleting the row and reinserting an equivalent one. That forces a genuinely NEW
 * heap tuple AND a new index entry, and the new entry sorts after every row that was not
 * touched. `forceRowToSortLast`, below, does exactly that: it deletes the row identified by
 * `(workspaceId, userId, role)` and reinserts a same-shaped replacement (new synthetic id and
 * `joined_at`, everything else identical) -- which the six call sites under test never read,
 * so it changes nothing observable about "the state of this membership" while still forcing
 * every UNTOUCHED sibling row for the same pair to come back FIRST from the unordered read.
 *
 * This demonstrates precisely one thing, and no more: THAT THE ORDER IS NOT GUARANTEED -- an
 * ordinary write elsewhere in the product is enough to reverse it -- never that PostgreSQL
 * returns one particular row in some universal order, and never that a `joined_at` touch
 * specifically is what does it (it measurably does NOT, against this query plan). Every probe
 * below that relies on `forceRowToSortLast` also asserts, in a comment, which row it expects
 * to come back first as a result, and this file was run once with the fix reverted to confirm
 * each one actually fires for the right reason (see this lane's task report for the recorded
 * red output).
 */
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { requireWorkspaceCapability } from "../../apps/api/src/utils/require-workspace-capability";
import { resetTestDatabase } from "./helpers/database";
import {
  inviteAndAcceptAsNewMember,
  signUpUser,
} from "./helpers/organization-http";
import {
  removeWorkspaceMemberNative,
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

/** Every `workspace_member.role` for one `(workspaceId, userId)` pair, in whatever order
 * PostgreSQL's unordered scan happens to return them -- deliberately not sorted by the
 * caller except where a probe sorts it itself for a stable assertion. */
async function rolesForPair(
  workspaceId: string,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ role: schema.workspaceUserTable.role })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    );
  return rows.map((row) => row.role);
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

async function insertDuplicateRow(
  workspaceId: string,
  userId: string,
  role: string,
): Promise<void> {
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId,
    role,
    joinedAt: new Date(),
  });
}

/**
 * Delete the row identified by `(workspaceId, userId, role)` and reinsert a same-shaped
 * replacement (new synthetic id, new `joined_at`; `workspaceId`/`userId`/`role` unchanged),
 * so every OTHER, untouched row for the same `(workspaceId, userId)` pair comes back FIRST
 * from the unordered read every site under test performs. See the file header for why a plain
 * `UPDATE` was tried first and measurably does not do this.
 */
async function forceRowToSortLast(
  workspaceId: string,
  userId: string,
  role: string,
): Promise<void> {
  await db
    .delete(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
        eq(schema.workspaceUserTable.role, role),
      ),
    );
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId,
    role,
    joinedAt: new Date(),
  });
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("P1 reachability: the schema still permits a second row for one (workspace, user) pair", () => {
  it("a direct db.insert of a second workspace_member row for a pair that already has one SUCCEEDS", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "P1 Reachability",
    );

    // Exactly one row before the probe -- the owner row workspace creation seeds.
    expect(await rolesForPair(workspaceId, owner.user.id)).toEqual(["owner"]);

    // THE NON-VACUITY CONTROL FOR THE WHOLE FILE. If this insert is ever rejected --
    // meaning a UNIQUE constraint landed on (workspace_id, user_id) -- every other probe in
    // this file is proving something that can no longer happen, and THIS is the assertion
    // that will tell you so, loudly, rather than the other probes failing for some unrelated
    // reason.
    await insertDuplicateRow(workspaceId, owner.user.id, "viewer");

    const roles = await rolesForPair(workspaceId, owner.user.id);
    expect(roles).toHaveLength(2);
    expect([...roles].sort()).toEqual(["owner", "viewer"]);
  });
});

describe("P2 owner-removal bypass, end to end through HTTP", () => {
  it("an owner with a duplicate viewer row cannot be removed, and the workspace keeps its owner", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "P2 Owner Removal",
    );
    // "another member with authority" -- an admin can call DELETE on other members
    // (`workspace-membership-writes-negative.test.ts` already establishes this).
    const admin = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );

    // Duplicate the owner's row with a non-owner role -- P1 proves this insert succeeds.
    await insertDuplicateRow(workspaceId, owner.user.id, "viewer");

    // Force the unordered read the controller does to return the "viewer" duplicate FIRST,
    // by forcing the ORIGINAL "owner" row to re-sort after it (see the file header). Pre-fix,
    // this makes `remove-workspace-member.ts`'s `.limit(1)` read see role "viewer", skip the
    // last-owner guard entirely, and delete BOTH rows -- leaving zero owners.
    await forceRowToSortLast(workspaceId, owner.user.id, "owner");

    const removed = await removeWorkspaceMemberNative(
      app,
      admin.cookie,
      workspaceId,
      owner.user.id,
    );

    // POST-FIX: the guard sees the owner row regardless of which one the unordered read
    // would have returned, and refuses -- there is no other owner to hand off to.
    expect(removed.status).toBe(400);
    expect(await ownerCount(workspaceId)).toBe(1);
    const rolesAfter = await rolesForPair(workspaceId, owner.user.id);
    expect([...rolesAfter].sort()).toEqual(["owner", "viewer"]);
  });
});

describe("P3 owner demotion", () => {
  it("an owner with a duplicate viewer row cannot have their role changed through the generic role-update route", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "P3 Owner Demotion",
    );
    const admin = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );

    await insertDuplicateRow(workspaceId, owner.user.id, "viewer");
    // Same forcing as P2: the untouched "viewer" duplicate comes back first. Pre-fix,
    // `update-workspace-member-role.ts`'s `.limit(1)` read sees role "viewer", skips
    // `CannotChangeOwnerRoleHereError`, and the subsequent UPDATE changes EVERY row for the
    // pair -- including the real "owner" row -- to the new role. The owner is silently
    // demoted.
    await forceRowToSortLast(workspaceId, owner.user.id, "owner");

    const updated = await updateWorkspaceMemberRoleNative(
      app,
      admin.cookie,
      workspaceId,
      owner.user.id,
      { role: "member" },
    );

    // POST-FIX: the guard sees the owner row regardless of read order and refuses. The
    // owner's role is untouched -- still "owner" among this pair's rows.
    expect(updated.status).toBe(400);
    const rolesAfter = await rolesForPair(workspaceId, owner.user.id);
    expect([...rolesAfter].sort()).toEqual(["owner", "viewer"]);
  });
});

/**
 * `requireWorkspaceCapability` is exercised directly, as Hono middleware in front of a
 * one-route probe app, against the REAL database -- no mock, unlike the module's own unit
 * test (`tests/api/utils/require-workspace-capability.test.ts`). `workspace:manage_members`
 * is used rather than the one capability wired to a real route
 * (`workspace:transfer_ownership`, `owner`-only) because it is held by `admin` but NOT by
 * `viewer` (`packages/permissions/src/roles.ts`), which is what lets a duplicate-row member
 * with one row of each demonstrate a genuine divergence rather than "denied both ways".
 */
function buildCapabilityProbeApp() {
  return new Hono<{ Variables: { userId: string; workspaceId: string } }>()
    .use("*", async (c, next) => {
      c.set("workspaceId", c.req.header("x-workspace-id") ?? "");
      c.set("userId", c.req.header("x-user-id") ?? "");
      return next();
    })
    .get(
      "/probe",
      requireWorkspaceCapability("workspace:manage_members"),
      (c) => c.json({ ok: true }),
    );
}

function probeCapability(workspaceId: string, userId: string) {
  return buildCapabilityProbeApp().request("/probe", {
    headers: { "x-workspace-id": workspaceId, "x-user-id": userId },
  });
}

describe("P4 capability-gate divergence", () => {
  it("the gate refuses a viewer+admin duplicate member even when the untouched row happens to be admin", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "P4 Divergence Admin First",
    );
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "viewer",
    );
    await insertDuplicateRow(workspaceId, member.user.id, "admin");
    // Force the ORIGINAL "viewer" row to re-sort after the duplicate -- the untouched "admin"
    // row comes back first. Pre-fix, this makes the gate's `.limit(1)` read see role "admin",
    // which DOES hold `workspace:manage_members`, and GRANT the request (200) -- despite this
    // same member also holding a "viewer" row that does not.
    await forceRowToSortLast(workspaceId, member.user.id, "viewer");

    const res = await probeCapability(workspaceId, member.user.id);

    // POST-FIX: fail-closed -- EVERY row for the pair must grant the capability, and the
    // "viewer" row does not, so this is refused regardless of which row an unordered read
    // would have returned.
    expect(res.status).toBe(403);
  });

  it("the gate refuses the SAME entitlement (viewer+admin) when the untouched row happens to be viewer instead -- proving the pre-fix answer was order, not entitlement", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(
      app,
      owner.cookie,
      "P4 Divergence Viewer First",
    );
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );
    await insertDuplicateRow(workspaceId, member.user.id, "viewer");
    // Force the ORIGINAL "admin" row to re-sort after the duplicate this time -- the
    // untouched "viewer" duplicate comes back first. Pre-fix, the gate's `.limit(1)` read
    // sees role "viewer" here, which does NOT hold `workspace:manage_members`, and REFUSES
    // (403) -- the opposite answer from the previous test, for the identical set of roles
    // {viewer, admin}, purely because physical row order differs. That is the divergence this
    // probe exists to name: two requests from a member with the exact same entitlement got
    // opposite answers, decided by an unordered read, not by anything the member was actually
    // granted.
    await forceRowToSortLast(workspaceId, member.user.id, "admin");

    const res = await probeCapability(workspaceId, member.user.id);

    // POST-FIX: fail-closed, same as the sibling test -- both orderings now agree.
    expect(res.status).toBe(403);
  });
});
