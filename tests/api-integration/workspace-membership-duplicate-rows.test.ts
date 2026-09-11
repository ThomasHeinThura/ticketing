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
  plantLegacyMembershipRole,
  signUpUser,
  updateMemberRoleViaPlugin,
} from "./helpers/organization-http";
import {
  addWorkspaceMemberNative,
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

/**
 * How many DISTINCT USER IDS hold `role = "owner"`.
 *
 * This helper used to return `owners.length` -- a count of ROWS -- which is
 * the identical confusion the production code had, so `expect(ownerCount).toBe(1)`
 * could not tell "one owner user" from "one owner row". The independent
 * security review of this pull request found the production defect precisely
 * because the test helper shared it: no probe could ever have caught it.
 * Recorded here because a test that mirrors the bug it is meant to catch is
 * worse than no test, and the next person editing this file needs to know why
 * the deduplication is deliberate.
 */
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
  return new Set(owners.map((row) => row.userId)).size;
}

/** Raw `role = "owner"` ROW count, for probes that must distinguish the two. */
async function ownerRowCount(workspaceId: string): Promise<number> {
  const owners = await db
    .select({ id: schema.workspaceUserTable.id })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.role, "owner"),
      ),
    );
  return owners.length;
}

/**
 * Distinct users whose row GRANTS owner when read COMMA-AWARE -- independent of `ownerCount`
 * above, which stays an EXACT `role = "owner"` match on purpose (mirroring the deliberate
 * asymmetry `distinctOwnerUserCount`'s own doc comment explains). The N1 probes below seed a
 * SINGLE row per pair whose value is the comma-joined `"owner,admin"`, not a duplicate row --
 * `ownerCount` would misreport zero owners for a workspace that plainly still has one, so this
 * is what "the workspace still has an owner" means for those probes specifically.
 */
async function ownerCountInclusive(workspaceId: string): Promise<number> {
  const rows = await db
    .select({
      userId: schema.workspaceUserTable.userId,
      role: schema.workspaceUserTable.role,
    })
    .from(schema.workspaceUserTable)
    .where(eq(schema.workspaceUserTable.workspaceId, workspaceId));
  const owners = rows.filter((row) =>
    row.role
      .split(",")
      .map((piece) => piece.trim().toLowerCase())
      .includes("owner"),
  );
  return new Set(owners.map((row) => row.userId)).size;
}

/**
 * The `workspace_member.id` PRIMARY KEY for one `(workspaceId, userId)` pair -- required by
 * `updateMemberRoleViaPlugin`, which (matching better-auth's own `updateMemberRole` body
 * schema, `crud-members.mjs:219-222`) addresses a member by row id, never by `userId`. Assumes
 * the pair is unambiguous -- every N1 probe below seeds exactly one row per pair before calling
 * this, never a duplicate.
 */
async function memberRowId(
  workspaceId: string,
  userId: string,
): Promise<string> {
  const [row] = await db
    .select({ id: schema.workspaceUserTable.id })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("memberRowId: no row for that workspace/user pair");
  return row.id;
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

/**
 * R1-R4 -- the ZERO-OWNER chain, and the reason this group exists.
 *
 * The independent Opus security review of this pull request found that the first version of
 * the duplicate-row fix was conservative in one direction only. It made "is the TARGET an
 * owner" conservative (`anyRoleIsOwner`, any row counts) and left "are there OTHER owners"
 * row-based: `select(userId).where(role='owner')` then `owners.length <= 1`. So a workspace
 * whose ONLY owner user held two `"owner"` rows counted 2, the last-owner guard passed, and
 * the delete -- which matches `(workspaceId, userId)` and therefore removes EVERY row for the
 * pair -- landed on **zero owners**.
 *
 * And the ownership transfer manufactured exactly that precondition: it set `role = "owner"`
 * on every row of the incoming owner, so transferring to a duplicated member produced the
 * two-owner-rows-for-one-user state the guard then misread. The full chain had no
 * unauthorized step in it.
 *
 * **Why the original probes could not catch it: this file's own `ownerCount()` helper had the
 * identical row-versus-user confusion**, so `expect(ownerCount).toBe(1)` could not distinguish
 * one owner user from one owner row. The helper is fixed above and deduplicates now, and
 * `ownerRowCount()` exists for the probes that must tell the two apart. A test that mirrors
 * the bug it is meant to catch is worse than no test.
 *
 * Both halves are fixed: `distinctOwnerUserCount` removes the misreading, and the transfer
 * refusing an ambiguous incoming owner removes the manufacturing.
 */
describe("R1-R4: a duplicated OWNER must never let a workspace reach zero owners", () => {
  it("R1 the sole owner holding TWO owner rows cannot leave -- the guard counts users, not rows", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "R1 Leave");
    // A second member exists, so `memberCount <= 1` is not what refuses the leave -- the
    // last-OWNER guard is, which is the thing under test.
    await inviteAndAcceptAsNewMember(app, owner.cookie, workspaceId, "member");

    await insertDuplicateRow(workspaceId, owner.user.id, "owner");
    expect(await ownerRowCount(workspaceId)).toBe(2);
    expect(await ownerCount(workspaceId)).toBe(1); // ...but only ONE owner user

    const response = await leaveWorkspaceNative(app, owner.cookie, workspaceId);

    expect(response.status).not.toBe(200);
    // The invariant, asserted on the database rather than on the status alone.
    expect(await ownerCount(workspaceId)).toBeGreaterThanOrEqual(1);
  });

  it("R2 an admin cannot remove the sole owner who holds TWO owner rows", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "R2 Remove");
    const admin = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );

    await insertDuplicateRow(workspaceId, owner.user.id, "owner");
    expect(await ownerRowCount(workspaceId)).toBe(2);
    expect(await ownerCount(workspaceId)).toBe(1);

    const response = await removeWorkspaceMemberNative(
      app,
      admin.cookie,
      workspaceId,
      owner.user.id,
    );

    expect(response.status).not.toBe(200);
    expect(await ownerCount(workspaceId)).toBeGreaterThanOrEqual(1);
  });

  it("R3 transferring to a member with duplicate rows is REFUSED with 409, so two owner rows are never manufactured", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "R3 Transfer");
    const target = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    await insertDuplicateRow(workspaceId, target.user.id, "viewer");
    expect(await rolesForPair(workspaceId, target.user.id)).toHaveLength(2);

    const response = await transferWorkspaceOwnershipNative(
      app,
      owner.cookie,
      workspaceId,
      { newOwnerUserId: target.user.id },
    );

    // 409, not 404 and not 403: a corrupt membership row is a conflict an operator must be
    // able to tell apart from "not a member" and from "insufficient permissions". Issue #82's
    // own scope item asks for exactly that distinguishability.
    expect(response.status).toBe(409);
    // Nothing moved: the target did not become an owner, and the real owner still is one.
    expect(await rolesForPair(workspaceId, target.user.id)).not.toContain(
      "owner",
    );
    expect(await rolesForPair(workspaceId, owner.user.id)).toEqual(["owner"]);
    expect(await ownerCount(workspaceId)).toBe(1);
  });

  it('R4 the capability GATE itself refuses ["owner","owner"] -- the controller never runs, which is what proves cardinality decided it and not `.every(...)`', async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "R4 Agree");
    const target = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );

    // The state the two reductions used to disagree about: the gate reduced with
    // `.every(...)` and GRANTED (both rows say "owner"), while the controller reduced with
    // `length !== 1` and REFUSED. Fail-closed, so never an escalation -- but it locked the
    // only owner out of the transfer route while nobody else held the capability, leaving
    // ownership unmovable without database surgery. They now share one predicate,
    // `isUnambiguousMembership`, today.
    await insertDuplicateRow(workspaceId, owner.user.id, "owner");

    const response = await transferWorkspaceOwnershipNative(
      app,
      owner.cookie,
      workspaceId,
      { newOwnerUserId: target.user.id },
    );

    // THIS IS THE FIX FOR THE VACUOUS ORIGINAL VERSION OF THIS PROBE. An earlier version of
    // this test asserted only `expect(response.status).not.toBe(200)`, and BOTH readings
    // return 403 for this route: `.every(...)` grants at the gate (both rows say "owner"), so
    // the request reaches `transferWorkspaceOwnership`'s own in-transaction re-check, which
    // independently uses `isUnambiguousMembership` and throws `CallerNotOwnerError` -- also
    // 403 (`apps/api/src/workspace/index.ts`'s `CallerNotOwnerError` handler). Reverting the
    // reduction to `.every(...)` therefore leaves this file at 361/361 green, exactly the
    // vacuity the independent review found. Confirmed empirically against this codebase: the
    // two readings' HTTP status codes for this route are IDENTICAL (403/403) -- the status
    // code cannot distinguish them, so this probe does not use it as the distinguishing
    // assertion.
    //
    // The response BODY can, because `HTTPException.getResponse()` (hono) returns the
    // exception's own `message` as the entire response text with no wrapping, and the two
    // layers throw different messages: `requireWorkspaceCapability` always throws
    // "Insufficient permissions"; `CallerNotOwnerError` is "Only the current owner can
    // transfer ownership". Only the GATE's message is reachable if cardinality, not
    // `.every(...)`, is what refused this request -- `.every(...)` would let the request past
    // the gate entirely and the message seen would be the CONTROLLER's instead. So asserting
    // the exact gate message is what makes this probe distinguish the two reductions rather
    // than merely re-confirm "some layer said no".
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Insufficient permissions");
    expect(await rolesForPair(workspaceId, target.user.id)).not.toContain(
      "owner",
    );
    expect(await ownerCount(workspaceId)).toBe(1);
  });
});

/**
 * N1a-N1d -- THE COMMA-JOINED OWNER DEFECT, a different shape from P1-P4/R1-R4 above.
 *
 * Those probes are about DUPLICATE ROWS: two `workspace_member` rows for one
 * `(workspace_id, user_id)` pair. N1 is about a SINGLE row whose `role` column holds a
 * COMMA-JOINED value -- `"owner,admin"` -- because better-auth's `parseRoles` comma-joins an
 * array (`organization.mjs:18-20`) when the still-mounted plugin route `POST
 * /api/auth/organization/update-member-role` is given `role: ["owner","admin"]`.
 *
 * THE DEFECT: an independent Opus security review found that `anyRoleIsOwner` used to be
 * `roles.includes("owner")` -- an EXACT match per row. `"owner,admin"` does not equal
 * `"owner"`, so that match returned FALSE for a sole owner's row holding that value, and every
 * last-owner guard built on it (`leave-workspace.ts`, `remove-workspace-member.ts`,
 * `update-workspace-member-role.ts`) never recognised the workspace creator as an owner at
 * all. Measured by the reviewer on real PostgreSQL over real HTTP, against better-auth's own
 * routes as the control:
 *
 * | with a sole `"owner,admin"` owner | native, before the fix | better-auth |
 * | --- | --- | --- |
 * | that owner leaves                 | **200, zero owners** | 400, refused |
 * | an admin removes them             | **200, zero owners** | n/a |
 * | an admin PATCHes them to `viewer` | **200, zero owners** | 403 |
 *
 * The setup step is authorized and ordinary -- the owner grants THEMSELVES `role:
 * ["owner","admin"]` through the still-mounted plugin route, which returns 200 and persists the
 * value verbatim (already established by
 * `multi-role-membership-characterization.test.ts`'s `"owner,admin"` persistence probe). Then a
 * plain admin holding only `member:update` can demote the workspace creator -- an authority
 * better-auth explicitly denies them. UNRECOVERABLE: with zero owners nobody can ever transfer
 * ownership again.
 *
 * THE FIX: `roleGrantsOwner` (`apps/api/src/utils/workspace-member-roles.ts`) comma-splits
 * before matching, and `anyRoleIsOwner` is now `roles.some(roleGrantsOwner)`.
 * `distinctOwnerUserCount` deliberately stays an EXACT `role = 'owner'` match -- see that
 * file's doc comments for why the asymmetry is the mechanism, not a bug. N1a-N1c below USED to
 * produce the state the way the reviewer did -- through the plugin route, to prove the defect
 * was API-reachable and not merely schema-permitted. **Issue #82 closed that path**: the
 * organization write boundary refuses the request (400) and migration `0050`'s CHECK
 * constraint refuses the row, so the state is no longer API-reachable at all. The three tests
 * now PLANT the row as legacy data, which is the only way it can still arise -- a deployment
 * that carried one before the fix. The guards below must survive exactly that, so their
 * assertions are unchanged. N1d is the separate
 * INCOMING-value guard: `add-workspace-member.ts` and `update-workspace-member-role.ts` now
 * refuse a `role` argument that itself grants owner comma-joined, before either route ever
 * opens a transaction.
 */
describe('N1a-N1d: a comma-joined "owner,admin" row must still be recognised as an owner', () => {
  it('N1a a sole owner whose row is "owner,admin" cannot leave through the native route, and the workspace keeps its owner', async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "N1a Leave");
    // A second member, so `memberCount <= 1` is not what refuses the leave -- the last-OWNER
    // guard is, matching R1's rationale above.
    await inviteAndAcceptAsNewMember(app, owner.cookie, workspaceId, "member");

    // PLANTED as legacy data. This setup used to grant the owner `["owner","admin"]` through
    // the still-mounted plugin route, and called that "an API-reachable path, not a bypass" --
    // which was true when it was written. Issue #82 closed it: that write is now refused 400,
    // and migration `0050`'s CHECK constraint refuses the row outright. A row in this shape can
    // now only predate the fix, and surviving exactly such a row is what these last-owner
    // guards are for, so everything below is unchanged.
    await plantLegacyMembershipRole(workspaceId, owner.user.id, "owner,admin");
    expect(await rolesForPair(workspaceId, owner.user.id)).toEqual([
      "owner,admin",
    ]);

    // THE BETTER-AUTH CONTROL: the reviewer's own oracle. The plugin's OWN `/organization/leave`
    // refuses this exact caller with 400 (crud-members.mjs's `leaveOrganization`:
    // `member.role.split(",").includes(creatorRole)` is true for "owner,admin", and the
    // creator-role member count is 1) -- so the native route below is held to a bar the
    // surface it replaces already meets.
    const pluginControl = await app.request("/api/auth/organization/leave", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ organizationId: workspaceId }),
    });
    expect(pluginControl.status).toBe(400);
    expect(await rolesForPair(workspaceId, owner.user.id)).toEqual([
      "owner,admin",
    ]);

    const response = await leaveWorkspaceNative(app, owner.cookie, workspaceId);

    // POST-FIX: `anyRoleIsOwner` is comma-aware (`roleGrantsOwner`), so the guard recognises
    // "owner,admin" as an owner row and refuses. PRE-FIX (`roles.includes("owner")`, an exact
    // match) this returned false for this row, the last-owner guard never ran, and the leave
    // deleted the pair's only row -- zero owners, exactly the reviewer's measured row above.
    expect(response.status).toBe(400);
    expect(await rolesForPair(workspaceId, owner.user.id)).toEqual([
      "owner,admin",
    ]);
    expect(await ownerCountInclusive(workspaceId)).toBeGreaterThanOrEqual(1);
  });

  it('N1b an admin cannot remove the sole owner whose row is "owner,admin", and the owner row is untouched', async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "N1b Remove");
    const admin = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );

    // PLANTED as legacy data. This setup used to grant the owner `["owner","admin"]` through
    // the still-mounted plugin route, and called that "an API-reachable path, not a bypass" --
    // which was true when it was written. Issue #82 closed it: that write is now refused 400,
    // and migration `0050`'s CHECK constraint refuses the row outright. A row in this shape can
    // now only predate the fix, and surviving exactly such a row is what these last-owner
    // guards are for, so everything below is unchanged.
    await plantLegacyMembershipRole(workspaceId, owner.user.id, "owner,admin");
    expect(await rolesForPair(workspaceId, owner.user.id)).toEqual([
      "owner,admin",
    ]);

    const response = await removeWorkspaceMemberNative(
      app,
      admin.cookie,
      workspaceId,
      owner.user.id,
    );

    // POST-FIX: the same comma-aware `anyRoleIsOwner` recognises the owner row and refuses.
    // PRE-FIX this returned 200 and deleted the pair's only row -- zero owners, exactly the
    // reviewer's measured "200, zero owners" row for "an admin removes them" (better-auth has
    // no equivalent control here: its own `removeMember` refuses removing the creator
    // regardless of who is asking, an authority shape this route deliberately does not mirror
    // -- marked "n/a" in the table above).
    expect(response.status).toBe(400);
    expect(await rolesForPair(workspaceId, owner.user.id)).toEqual([
      "owner,admin",
    ]);
  });

  it('N1c an admin cannot demote the sole owner whose row is "owner,admin" to viewer, and the owner row is unchanged', async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const workspaceId = await createWorkspace(app, owner.cookie, "N1c Demote");
    const admin = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );

    const ownerMemberId = await memberRowId(workspaceId, owner.user.id);
    // PLANTED as legacy data. This setup used to grant the owner `["owner","admin"]` through
    // the still-mounted plugin route, and called that "an API-reachable path, not a bypass" --
    // which was true when it was written. Issue #82 closed it: that write is now refused 400,
    // and migration `0050`'s CHECK constraint refuses the row outright. A row in this shape can
    // now only predate the fix, and surviving exactly such a row is what these last-owner
    // guards are for, so everything below is unchanged.
    await plantLegacyMembershipRole(workspaceId, owner.user.id, "owner,admin");
    expect(await rolesForPair(workspaceId, owner.user.id)).toEqual([
      "owner,admin",
    ]);

    // THE BETTER-AUTH CONTROL: the plugin's OWN `/organization/update-member-role` refuses this
    // actor -- a plain "admin" is not the creator (`updaterIsCreator` false), the target IS the
    // creator (`isUpdatingCreator` true, from splitting "owner,admin"), and
    // `isUpdatingCreator && !updaterIsCreator` throws FORBIDDEN (403) before any specific
    // permission is even checked (crud-members.mjs:290-292).
    const pluginControl = await updateMemberRoleViaPlugin(
      app,
      admin.cookie,
      workspaceId,
      ownerMemberId,
      "viewer",
    );
    expect(pluginControl.status).toBe(403);
    expect(await rolesForPair(workspaceId, owner.user.id)).toEqual([
      "owner,admin",
    ]);

    const response = await updateWorkspaceMemberRoleNative(
      app,
      admin.cookie,
      workspaceId,
      owner.user.id,
      { role: "viewer" },
    );

    // POST-FIX: comma-aware `anyRoleIsOwner` recognises "owner,admin" and throws
    // `CannotChangeOwnerRoleHereError`. PRE-FIX this returned 200 and silently demoted the
    // owner -- exactly the reviewer's measured "200, zero owners" row, and LESS safe than the
    // plugin route it replaces, which refused the identical actor and operation with 403.
    expect(response.status).toBe(400);
    expect(await rolesForPair(workspaceId, owner.user.id)).toEqual([
      "owner,admin",
    ]);
  });

  describe("N1d the incoming-value guard: a role argument that itself grants owner comma-joined is refused, before either route opens a transaction", () => {
    it('PATCH /members/{id}/role with "owner,admin" is refused, and the target row is unchanged', async () => {
      const { app } = createApp();
      const owner = await signUpUser(app);
      const workspaceId = await createWorkspace(app, owner.cookie, "N1d Patch");
      const admin = await inviteAndAcceptAsNewMember(
        app,
        owner.cookie,
        workspaceId,
        "admin",
      );
      const target = await inviteAndAcceptAsNewMember(
        app,
        owner.cookie,
        workspaceId,
        "member",
      );

      const response = await updateWorkspaceMemberRoleNative(
        app,
        admin.cookie,
        workspaceId,
        target.user.id,
        { role: "owner,admin" },
      );

      // POST-FIX: `roleGrantsOwner("owner,admin")` is true (comma-split, includes "owner"), so
      // `update-workspace-member-role.ts` refuses before the transaction even opens. PRE-FIX
      // the guard was an exact `role === "owner"` match, which "owner,admin" does not satisfy,
      // so this value would have sailed through to the role-row lookup -- and would have been
      // ACCEPTED had a role literally named "owner,admin" existed (`create-role` only
      // lowercases names, so one is creatable).
      expect(response.status).toBe(400);
      expect(await rolesForPair(workspaceId, target.user.id)).toEqual([
        "member",
      ]);
    });

    it('POST /members with role "owner,admin" is refused the same way, by add-workspace-member.ts\'s identical guard, and no row is created', async () => {
      const { app } = createApp();
      const owner = await signUpUser(app);
      const workspaceId = await createWorkspace(app, owner.cookie, "N1d Add");
      const admin = await inviteAndAcceptAsNewMember(
        app,
        owner.cookie,
        workspaceId,
        "admin",
      );
      const notYetMember = await signUpUser(app);

      const response = await addWorkspaceMemberNative(
        app,
        admin.cookie,
        workspaceId,
        { userId: notYetMember.user.id, role: "owner,admin" },
      );

      expect(response.status).toBe(400);
      expect(await rolesForPair(workspaceId, notYetMember.user.id)).toEqual([]);
    });
  });
});
