import {
  type BuiltInRoleKey,
  type MembershipRoleProblem,
  membershipRoleProblem,
} from "@taskdesk/permissions";
import { and, countDistinct, eq } from "drizzle-orm";
import type db from "../database";
import { schema } from "../database";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Every `workspace_member.role` value for one `(workspaceId, userId)` pair.
 *
 * THE INVARIANT THIS DEFENDS. `workspace_member` (`workspaceUserTable`,
 * `apps/api/src/database/schema.ts`) carries NO UNIQUE constraint on
 * `(workspace_id, user_id)` -- only two plain, non-unique indexes
 * (`workspace_member_workspaceId_idx`, `workspace_member_userId_idx`) -- so
 * more than one row for the same pair is a state the database permits, and
 * it is reachable today: better-auth's `acceptInvitation` (`crud-invites.mjs`,
 * the `adapter.createMember(...)` call) has no existing-member check and
 * takes no lock. Invite a user who is not yet a member (invitation goes
 * pending), add that same user through the native add route
 * (`add-workspace-member.ts`), then have them accept the still-pending
 * invitation, and the pair now has two rows. See
 * `tests/api-integration/workspace-membership-duplicate-rows.test.ts`, probe
 * P1, for the reachability proof.
 *
 * WHY THIS FUNCTION EXISTS, RATHER THAN `.limit(1)`. A `LIMIT 1` read with no
 * `ORDER BY` returns whichever row a sequential scan produces first -- heap
 * order, not insertion order or any other meaning -- and an ordinary
 * `UPDATE` elsewhere can silently reverse it: PostgreSQL MVCC writes an
 * updated row as a new tuple appended to the end of the heap, so updating
 * the row that used to come "first" moves it after the others. Six call
 * sites in this codebase used to read one arbitrary row's role and act as
 * though it were the pair's only row:
 *
 *  - `remove-workspace-member.ts` and `leave-workspace.ts` skip the
 *    last-owner guard entirely when the unordered read happens to return a
 *    duplicate member's NON-owner row, then delete every row for the pair
 *    (including the owner row) -- leaving the workspace with zero owners.
 *  - `update-workspace-member-role.ts` skips the "current role is owner"
 *    refusal the same way, then updates every row for the pair -- silently
 *    demoting an owner.
 *  - `transfer-workspace-ownership.ts` reads the caller's authority from one
 *    arbitrary row.
 *  - `require-workspace-capability.ts` decides a capability grant from one
 *    arbitrary row -- a nondeterministic authorization answer for the exact
 *    same member, call to call.
 *
 * This function returns the WHOLE set instead, so every caller reasons
 * about all of it rather than trusting one arbitrary row.
 *
 * Deliberately UNORDERED -- there is no correct order to impose on a state
 * the schema should never have permitted, and imposing one would only make
 * the arbitrary answer deterministic, not correct. The durable fix is a
 * UNIQUE constraint on `(workspace_id, user_id)`; that needs its own
 * migration and a duplicate-data audit first and is tracked separately, not
 * part of this change.
 */
export async function workspaceMemberRoles(
  executor: DbOrTx,
  workspaceId: string,
  userId: string,
): Promise<string[]> {
  const rows = await executor
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
 * Does this single stored role value grant owner -- **including when it is a
 * comma-joined value like `"owner,admin"`**?
 *
 * THE DEFECT THIS CLOSES, because it was BLOCKING and it is not obvious. An
 * earlier version of `anyRoleIsOwner` was `roles.includes("owner")` -- an exact
 * match per row. But `workspace_member.role` can hold `"owner,admin"` as ONE
 * row's value: better-auth's `parseRoles` comma-joins an array
 * (`organization.mjs:18-20`), and issue #82 tracks that. An exact match returns
 * FALSE for that row, so the last-owner guards did not recognise the workspace
 * creator as an owner at all.
 *
 * Measured by the independent Opus review of this pull request, on real
 * PostgreSQL over real HTTP, against better-auth's own routes as the control:
 *
 * | with a sole `"owner,admin"` owner | native (before) | better-auth |
 * | --- | --- | --- |
 * | that owner leaves                 | **200, zero owners** | 400, refused |
 * | an admin removes them             | **200, zero owners** | n/a |
 * | an admin PATCHes them to `viewer` | **200, zero owners** | 403 |
 *
 * The setup step is authorized and ordinary -- the owner gives *themselves*
 * `role: ["owner","admin"]` through the still-mounted plugin route -- and then a
 * plain admin holding only `member:update` can demote the workspace creator, an
 * authority better-auth explicitly denies them. **Unrecoverable**: with zero
 * owners nobody can ever transfer ownership. So these native routes were LESS
 * safe than the plugin routes they replace, for that one input.
 */
export function roleGrantsOwner(role: string): boolean {
  return role
    .split(",")
    .map((piece) => piece.trim().toLowerCase())
    .includes("owner");
}

export function anyRoleIsOwner(roles: string[]): boolean {
  return roles.some(roleGrantsOwner);
}

/**
 * How many DISTINCT USERS hold `role = "owner"` in this workspace.
 *
 * WHY THIS IS NOT `rows.length`, and why getting it wrong was a privilege
 * defect rather than a tidiness one. The last-owner guards in
 * `leave-workspace.ts` and `remove-workspace-member.ts` ask "would this
 * removal leave the workspace with no owner?". Before this function they
 * answered it by counting owner ROWS. With no unique constraint on
 * `(workspace_id, user_id)` a single owner user can hold two `"owner"` rows,
 * so the count returned 2, the guard concluded "there is another owner", and
 * the delete -- which matches on `(workspaceId, userId)` and therefore removes
 * EVERY row for that pair -- left the workspace with **zero owners**.
 *
 * Found by the independent security review of this pull request, which also
 * showed the route that manufactures the precondition: the ownership transfer
 * used to set `role = "owner"` on every row of the incoming owner, so
 * transferring to a duplicated member produced exactly the two-owner-rows
 * state this guard then misread. Both halves are fixed; this is the half that
 * makes the invariant hold even if some other path produces duplicates.
 *
 * **AND A SECOND ASYMMETRY, WHICH IS THE POINT AND IS COUNTER-INTUITIVE, SO IT
 * IS SPELLED OUT: this count stays an EXACT `role = 'owner'` match while
 * `anyRoleIsOwner` is comma-AWARE.** That combination is what makes the guard
 * refuse in the corrupt case:
 *
 *   sole owner whose row says `"owner,admin"`
 *     -> `anyRoleIsOwner` is TRUE  (comma-aware, inclusive) -> enter the guard
 *     -> `distinctOwnerUserCount` is 0 (exact, so it does not count them)
 *     -> `0 <= 1` -> REFUSE
 *
 * Make the count comma-aware too and it returns 1, `1 <= 1` still refuses --
 * fine here. But make `anyRoleIsOwner` exact and the guard is never entered at
 * all, which was the BLOCKING defect. And in
 * `delete-account-data.ts` the same pair runs the other way round: its guard is
 * `isOwner && ownerCount <= 1 -> block`, so **over**-counting owners SKIPS the
 * block and orphans the workspace. One predicate cannot serve both questions:
 * "is this member an owner" wants the inclusive reading, "how many owners are
 * there" wants the exact one. Do not "simplify" them into one.
 *
 * Note the asymmetry with `workspaceMemberRoles`, and that it is deliberate:
 * "what is THIS user's role" must refuse to guess when the answer is
 * ambiguous, while "how many owner USERS are there" has a correct answer even
 * when rows are duplicated -- so one denies on ambiguity and the other
 * deduplicates.
 */
export async function distinctOwnerUserCount(
  executor: DbOrTx,
  workspaceId: string,
): Promise<number> {
  const [row] = await executor
    .select({ owners: countDistinct(schema.workspaceUserTable.userId) })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.role, "owner"),
      ),
    );
  return Number(row?.owners ?? 0);
}

/**
 * Is this pair's role answer UNAMBIGUOUS -- exactly one row?
 *
 * The single predicate every authority decision uses, so two call sites cannot
 * reduce the same rows differently. **Cardinality, deliberately NOT
 * agreement:** `["owner", "owner"]` is refused too, because a duplicated
 * membership row is a corrupt authorization state whatever it says.
 *
 * The review of this pull request found what happens when two reductions
 * disagree on exactly that shape: the capability middleware reduced with
 * `.every(...)` while the transfer controller reduced with `length !== 1`, so
 * for `["owner", "owner"]` the middleware granted and the controller refused --
 * fail-closed, so never an escalation, but it locked the only owner out of
 * their own transfer route with nobody else holding the capability, making
 * ownership unmovable without database surgery.
 *
 * This file arrived on `main` twice, from #80 and from this pull request, and
 * the add/add conflict resolved to this pull request's superset -- #80 shipped
 * only `workspaceMemberRoles` and `isUnambiguousMembership`, both byte-identical
 * to the copies here, while `anyRoleIsOwner` and `distinctOwnerUserCount` are
 * this pull request's. #80's independent reviewer specifically warned that
 * "keep the superset" would discard #80's better wording for this predicate, so
 * that wording is kept above rather than lost.
 */
/**
 * The ONE `workspace_role.permission` payload for a `(workspaceId, role)` pair, or `null`
 * when the answer is absent or ambiguous.
 *
 * THE TWIN OF `workspaceMemberRoles`, ONE TABLE OVER, AND IT WAS MISSED. Everything the
 * module comment above says about `workspace_member` is also true of `workspace_role`:
 * `apps/api/drizzle/0030_smart_umar.sql:11-12` creates `workspace_role_workspaceId_idx` and
 * `workspace_role_role_idx` as plain, NON-unique indexes, and `schema.ts` confirms
 * `index(...)` rather than `uniqueIndex(...)`. Measured against a real PostgreSQL 18: the
 * only unique constraint on the table is `workspace_role_pkey`, on `id`. Two rows for
 * `('w','manager')` carrying DIFFERENT `permission` payloads insert cleanly, and an
 * unordered `LIMIT 1` then returns one of them arbitrarily.
 *
 * REACHABLE TODAY, AS A TOCTOU RACE RATHER THAN AN ABSENT CHECK. better-auth's
 * `createOrgRole` (`crud-access-control.mjs`) DOES call `checkIfRoleNameIsTakenByRoleInDB`
 * before creating -- confirmed directly, and confirmed it works for two SEQUENTIAL calls
 * (the second returns `400 ROLE_NAME_IS_ALREADY_TAKEN`). But the check and the insert are
 * two separate steps with no transaction, lock, or unique index between them, so two
 * CONCURRENT `create-role` calls with the same name can both pass the check before either
 * inserts -- measured directly: 8 concurrent calls through the still-mounted
 * `organization()` plugin produced 2 rows with different payloads on the first attempt.
 * Tracked as #118; the `UNIQUE (workspace_id, role)` constraint that closes the race at the
 * only layer that actually can is the other half and lands with the migration.
 *
 * WIDER BLAST RADIUS THAN #88's. A duplicated `workspace_member` row affects one
 * `(workspace, user)` pair. A duplicated `workspace_role` row affects EVERY member holding
 * that role name, on every request -- and because the two rows can carry deliberately
 * different permission sets, the divergence is not a tie between equal values.
 *
 * Returns the raw `permission` string so each caller keeps its own parsing: the capability
 * evaluator tolerates a malformed payload differently from the role-authority evaluator, and
 * collapsing that here would change behaviour this function is not meant to touch.
 *
 * `null` already means DENY at both call sites, so refusing on ambiguity is fail-closed
 * without any new branch: a corrupt role definition is refused, never resolved by guessing.
 */
export async function workspaceRolePermission(
  executor: DbOrTx,
  workspaceId: string,
  role: string,
): Promise<string | null> {
  const rows = await executor
    .select({ permission: schema.workspaceRoleTable.permission })
    .from(schema.workspaceRoleTable)
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, workspaceId),
        eq(schema.workspaceRoleTable.role, role),
      ),
    );

  // NOT `.limit(1)`, and NOT `rows[0]`. Exactly one row, or no answer.
  if (rows.length !== 1) return null;
  return rows[0]?.permission ?? null;
}

export function isUnambiguousMembership(roles: string[]): boolean {
  return roles.length === 1;
}

/**
 * The ONE resolution every authorization surface uses to turn a pair's stored rows into
 * either a single usable role name or a named refusal — issue #82.
 *
 * WHY A RESULT TYPE RATHER THAN A `string | null`. Issue #82 requires the native evaluator
 * to fail closed on a malformed value *and to do so DISTINGUISHABLY*, "so an operator can
 * tell 'malformed membership row' from 'role has no such capability'". A bare `null` cannot
 * carry that difference, and the two cases genuinely need different answers: a role that
 * simply lacks a capability is a correct 403, while a corrupt membership row is a data fault
 * the caller can do nothing about and an operator must be told about. `GET /api/capabilities`
 * turns `malformed-role` into an explicit 409 for exactly that reason; every other route
 * still just denies, because a route's job is to refuse, not to diagnose.
 *
 * WHY THE MALFORMED CASE IS NOT MERELY THEORETICAL, and why it must be refused rather than
 * interpreted. `workspace_member.role` is an unconstrained `text` column, and the
 * still-mounted better-auth plugin comma-JOINS an array of roles into it while its own
 * evaluator comma-SPLITS the column back apart and ORs across the pieces
 * (`permission.mjs:2-11`). So the same stored `"owner,admin"` means "the union of owner and
 * admin" to the plugin and "an unknown role name" to this code. Splitting here to match
 * would import the union — and the union is the vulnerability, not the fix. Issue #82 says
 * so in as many words: "Do **not** implement comma-splitting to match the plugin."
 *
 * As of migration `0050` a `CHECK` constraint makes this state unreachable for new writes.
 * Before S10 unmounted the plugin, `organizationPluginRoleGuard` also refused the plugin
 * write that used to create it (now deleted — the plugin route it guarded no longer
 * exists). This resolution is what still holds for a row that predates the constraint — a
 * deployment that was already carrying one when the fix shipped. It is deliberately kept
 * even though the constraint "should" make it dead: the constraint is a backstop for this
 * rule, not a replacement for it, and a future migration that has to drop the constraint
 * must not silently re-open the union.
 */
export type MembershipRoleResolution =
  | { ok: true; role: string }
  | { ok: false; reason: "no-membership" }
  | { ok: false; reason: "ambiguous-rows"; rowCount: number }
  | { ok: false; reason: "malformed-role"; problem: MembershipRoleProblem };

export function resolveMembershipRoleFrom(
  roles: string[],
): MembershipRoleResolution {
  if (roles.length === 0) return { ok: false, reason: "no-membership" };
  if (!isUnambiguousMembership(roles)) {
    return { ok: false, reason: "ambiguous-rows", rowCount: roles.length };
  }
  // Load-bearing for the compiler, not dead code: `roles[0]` is `string | undefined` under
  // `noUncheckedIndexedAccess`, and `length === 1` does not narrow an index access. The
  // same explicit test appears at both former call sites, and is kept here now that they
  // share this function, so the reason stays on the page.
  const role = roles[0];
  if (role === undefined) return { ok: false, reason: "no-membership" };

  const problem = membershipRoleProblem(role);
  if (problem !== null) {
    return { ok: false, reason: "malformed-role", problem };
  }
  return { ok: true, role };
}

/** `resolveMembershipRoleFrom` over this pair's rows, read through `workspaceMemberRoles`. */
export async function resolveMembershipRole(
  executor: DbOrTx,
  workspaceId: string,
  userId: string,
): Promise<MembershipRoleResolution> {
  return resolveMembershipRoleFrom(
    await workspaceMemberRoles(executor, workspaceId, userId),
  );
}

/**
 * Issue #318 (security), Opus review of PR #315 finding S2. Is a `workspace_member.role`
 * value that names a `BUILT_IN_ROLES` key GENUINELY that built-in, rather than a custom row
 * that merely shares its name?
 *
 * Shared by `require-workspace-capability.ts`'s `builtInRoleHasCapability` (which queries
 * `workspace_role.is_system` for `isSystem` before calling this) and `resolve-identity.ts`'s
 * pure mapper (which already has `isSystemRole` from its own loaded facts) -- the same
 * one-line predicate in both, so they can never independently drift out of agreement, which
 * is exactly what the shadow-mode comparison #8's Slice 2 depends on.
 *
 * `"owner"` is always genuine: it is the one `BUILT_IN_ROLES` key that NEVER gets a
 * `workspace_role` row at all (retrofit plan R5 -- `create-workspace.ts`'s own comment),
 * and it has been reserved from custom creation since before this fix, so a
 * `workspace_member.role` value of `"owner"` cannot come from anywhere but the compiled-in
 * static role. Every other key is genuine only when the caller's own `is_system` read is
 * `true`.
 */
export function isGenuineBuiltInRoleGrant(
  role: BuiltInRoleKey,
  isSystem: boolean,
): boolean {
  return role === "owner" || isSystem;
}
