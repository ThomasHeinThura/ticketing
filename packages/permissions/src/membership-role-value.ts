/**
 * The canonical rule for a stored membership role VALUE — issue #82.
 *
 * > **One workspace membership = exactly one role.**
 *
 * `workspace_member.role` is an unconstrained `text` column. This module is the single
 * place that decides whether a value in it is well-formed, so the two authorization
 * surfaces that read it cannot answer that question differently. It is deliberately pure —
 * no I/O, no framework, no database — for the same reason as the rest of this package: the
 * same code answers the question in the API middleware, in a migration's mirror test, and
 * in CI.
 *
 * **WHY THIS EXISTS.** better-auth 1.6.30 accepts `role` as `z.union([z.string(),
 * z.array(z.string())])` on `POST /organization/update-member-role`
 * (`crud-members.mjs:215`) and comma-JOINS an array before persisting (`parseRoles`,
 * `organization.mjs:18-20`). Its own evaluator then comma-SPLITS the column back apart and
 * **ORs across every piece** (`permission.mjs:2-11`,
 * `for (const role of roles) if (acRoles[role]?.authorize(...)?.success) return true`),
 * while TaskDesk's native evaluator does an exact-string lookup and matches nothing. So
 * `"owner,admin"` is not one role and is not zero roles — to the plugin it is the UNION of
 * two, and to the native side it is an unknown name.
 *
 * The union is the dangerous half, and it is not a lockout: `permission.mjs:5-8`
 * short-circuits `isCreator && allowCreatorsAllPermissions` to `true` BEFORE any specific
 * permission is examined, and `crud-members.mjs:293-296` computes `isCreator` as
 * `member.role.split(",").includes("owner")`. A member whose role merely CONTAINS the
 * substring-piece `owner` therefore holds full creator authority on the plugin's own
 * mutation routes — enough to demote the real workspace owner. See
 * `tests/api-integration/multi-role-membership-characterization.test.ts` § C.
 *
 * **WHAT IS INVALID.** Everything that is not exactly one trimmed, non-empty role name:
 *
 * | value             | problem        | why it is not merely cosmetic                        |
 * | ----------------- | -------------- | ---------------------------------------------------- |
 * | `""`              | `empty`        | no role at all; the plugin's split yields `[""]`      |
 * | `"owner,admin"`   | `multi-valued` | the union — the privilege defect itself               |
 * | `"admin,"`        | `multi-valued` | trailing comma; the plugin splits to `["admin", ""]`  |
 * | `"admin,admin"`   | `multi-valued` | duplicate; still two pieces to the plugin's split     |
 * | `"admin, viewer"` | `multi-valued` | comma wins over the whitespace reading                |
 * | `" admin"`        | `untrimmed`    | native exact-match finds no row; plugin's split has   |
 * |                   |                | no `.trim()` either, so BOTH deny — but silently      |
 *
 * **WHAT IS DELIBERATELY STILL VALID.** A role name with INTERNAL whitespace (`"team
 * lead"`). better-auth's `create-role` normalises a new role name with nothing but
 * `role.toLowerCase()` (`crud-access-control.mjs:9`), so such a name is creatable today and
 * is a legitimate single role. This rule is about CARDINALITY and about padding, not about
 * inventing a name grammar the rest of the product does not enforce.
 *
 * Note this is a rule about the stored VALUE, not about the role's existence: a value may be
 * perfectly well-formed here and still name no role this workspace has. That second question
 * belongs to the evaluator, which resolves it against `workspace_role`. Keeping them apart is
 * what lets the API distinguish "your membership row is corrupt" from "your role has no such
 * capability" — issue #82's own requirement that the failure be *distinguishable*.
 */

/**
 * The character better-auth joins an array of roles with, and splits a stored value on.
 * Named rather than inlined because its presence in a stored value IS the defect.
 */
export const MEMBERSHIP_ROLE_SEPARATOR = ",";

/** Why a stored membership role value is not exactly one role. */
export type MembershipRoleProblem = "empty" | "multi-valued" | "untrimmed";

/**
 * What is wrong with this stored membership role value, or `null` when nothing is.
 *
 * `multi-valued` is checked BEFORE `untrimmed` on purpose: `" admin,viewer"` is both, and
 * the multi-value reading is the one with a privilege consequence, so it is the one an
 * operator should be shown.
 */
export function membershipRoleProblem(
  value: string,
): MembershipRoleProblem | null {
  if (value.includes(MEMBERSHIP_ROLE_SEPARATOR)) return "multi-valued";
  // Covers both `""` and a value that is nothing but whitespace: neither names a role, and
  // calling `"   "` merely "untrimmed" would imply trimming it produced something.
  if (value.trim().length === 0) return "empty";
  if (value.trim() !== value) return "untrimmed";
  return null;
}

/** Is this stored value exactly one role — the canonical invariant, as a predicate? */
export function isSingleMembershipRole(value: string): boolean {
  return membershipRoleProblem(value) === null;
}

/**
 * The pieces better-auth's evaluator would read out of this value, deduplicated.
 *
 * This is NOT a sanctioned way to interpret a membership row — the native evaluator must
 * never comma-split, which is issue #82's explicit instruction ("do not implement
 * comma-splitting to match the plugin"). It exists for exactly two callers that need to
 * reason ABOUT the malformed value rather than act on it:
 *
 *  1. the recovery path in migration `0050`, which may safely repair a value only when
 *     every piece names the SAME role (`"admin,admin"`, `"admin,"`, `" admin "`) — because
 *     that repair makes no privilege decision. When the pieces name two DIFFERENT roles the
 *     migration refuses and asks an operator, since picking one would be choosing someone's
 *     privileges for them;
 *  2. the test that proves this function and the migration's SQL agree.
 *
 * Empty pieces are dropped and each piece is trimmed, matching `crud-members.mjs:259`'s
 * `.flatMap(r => r.split(",")).map(r => r.trim()).filter(Boolean)`.
 */
export function legacyMembershipRoleSegments(value: string): string[] {
  const seen = new Set<string>();
  for (const piece of value.split(MEMBERSHIP_ROLE_SEPARATOR)) {
    const trimmed = piece.trim();
    if (trimmed.length > 0) seen.add(trimmed);
  }
  return [...seen];
}

/**
 * The single role a malformed value can be repaired to WITHOUT making a privilege decision,
 * or `null` when there is no such value and a human must choose.
 *
 * Mirrors migration `0050`'s SQL for every ASCII-whitespace shape -- the migration's
 * `btrim` calls take an explicit space/tab/newline/CR/FF/VT character list to match this
 * function's `trim()`, but do not reach the non-ASCII whitespace `trim()` also strips (NBSP
 * and the Unicode space separators); see `0050_enforce_single_role_membership.sql` for that
 * gap. `membership-role-value.test.ts` pins the ASCII agreement, because a repair rule that
 * drifts from the migration that ran it is worse than no repair rule at all.
 */
export function repairableMembershipRole(value: string): string | null {
  if (isSingleMembershipRole(value)) return value;
  const segments = legacyMembershipRoleSegments(value);
  return segments.length === 1 ? (segments[0] ?? null) : null;
}
