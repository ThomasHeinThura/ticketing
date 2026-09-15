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
 * comma-splitting to match the plugin"). It describes what the STILL-MOUNTED PLUGIN's own
 * reader computes from a stored value, for exactly one caller: the test that proves this
 * description and better-auth's actual `crud-members.mjs:259` behaviour
 * (`.flatMap(r => r.split(",")).map(r => r.trim()).filter(Boolean)`) agree. It is
 * DELIBERATELY NOT used by `repairableMembershipRole` below — see that function's doc for
 * why trimming-to-find-agreement is exactly the bug this file exists to not have.
 *
 * Empty pieces are dropped and each piece is trimmed, matching the plugin's own reader.
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
 * The raw, UNTRIMMED, non-empty comma-separated pieces of a value, in order, not
 * deduplicated. Never trimmed — see {@link repairableMembershipRole}.
 */
function rawNonEmptyCommaPieces(value: string): string[] {
  return value.split(MEMBERSHIP_ROLE_SEPARATOR).filter((piece) => piece !== "");
}

/**
 * The single role a malformed value can be repaired to WITHOUT making a privilege decision,
 * or `null` when there is no such value and a human must choose — issue #82, corrected after
 * an independent review found the ORIGINAL version of this function manufactured authority.
 *
 * **THE DEFECT THIS REPLACES, AND WHY "SAME ROLE AFTER TRIMMING" WAS THE WRONG TEST.** The
 * first version of this function collapsed a value to its one DISTINCT TRIMMED segment —
 * so `" owner"` (a single piece, no comma at all, padded) collapsed to `"owner"` exactly the
 * same way `"admin,admin"` collapses to `"admin"`. Those two cases are not the same, and
 * treating them alike is a privilege escalation:
 *
 *   - `"admin,admin"` already contains a CLEAN, matching `"admin"` piece, byte-identical,
 *     with no trimming needed. better-auth's own comma-split-and-OR evaluator
 *     (`permission.mjs`, no `.trim()` anywhere in it) already reads this row as granting
 *     `admin` TODAY, before any repair runs. Collapsing to `"admin"` changes NOTHING either
 *     evaluator was already doing — that is what "makes no privilege decision" actually
 *     means.
 *   - `" owner"` has no comma and exactly one piece, and that piece is ITSELF padded. Traced
 *     against the real, installed `better-auth@1.6.30`: `" owner".split(",")` = `[" owner"]`,
 *     and `[" owner"].includes("owner")` is `false` (exact-string, no trim) — the plugin's
 *     own `isCreator`/`acRoles` lookups both fail on the padded string. TaskDesk's native
 *     evaluator also denies it (exact match, no row named `" owner"`). So TODAY this row
 *     grants NOTHING under either evaluator. Trimming it to `"owner"` does not restate an
 *     existing agreement — it MANUFACTURES one, and because `"owner"` is the one role whose
 *     authority is compiled-in and unbounded (`require-workspace-permission.ts`'s
 *     `role === "owner" ? builtInRoleStatements("owner") : ...`), the manufactured agreement
 *     is full, ungated workspace ownership, minted by the migration itself with no operator
 *     visibility.
 *
 * **THE CORRECTED RULE.** Safe to repair means: comma-bearing, AND every non-empty RAW
 * (untrimmed) piece is the exact same byte string, AND that string is already, on its own,
 * a well-formed single role name (no comma, no padding, non-empty). No trimming is ever
 * performed to MAKE pieces agree — only to confirm that a piece which already agrees with
 * every other piece is not itself malformed. A value with no comma at all is NEVER
 * auto-repaired: there is no second piece to confirm agreement against, so trimming it
 * would be inventing agreement rather than finding it already there.
 *
 * | value              | repair                                                          |
 * | ------------------ | ---------------------------------------------------------------|
 * | `"admin,admin"`     | `"admin"` — both raw pieces already `"admin"`                  |
 * | `"admin,"`          | `"admin"` — the one non-empty raw piece is already `"admin"`   |
 * | `",admin"`          | `"admin"` — same                                                |
 * | `"admin,,admin"`    | `"admin"` — same, extra empty piece dropped                     |
 * | `" owner"`          | `null` — no comma, nothing to confirm agreement against         |
 * | `"owner "`          | `null` — same                                                   |
 * | `" admin "`         | `null` — same                                                   |
 * | `"admin, admin"`    | `null` — raw pieces `"admin"` and `" admin"` are NOT identical  |
 * | `" admin,admin"`    | `null` — raw pieces `" admin"` and `"admin"` are NOT identical  |
 * | `"owner,admin"`     | `null` — genuine ambiguity, unchanged from before                |
 *
 * Mirrors migration `0050`'s SQL exactly — both require every RAW piece to already be
 * byte-identical and well-formed, never trimming toward agreement.
 * `membership-role-value.test.ts` pins the agreement, because a repair rule that drifts from
 * the migration that ran it is worse than no repair rule at all.
 */
export function repairableMembershipRole(value: string): string | null {
  if (isSingleMembershipRole(value)) return value;
  if (!value.includes(MEMBERSHIP_ROLE_SEPARATOR)) {
    // No comma: empty, whitespace-only, or a single padded role name. There is no second
    // piece to confirm agreement against, so refuse rather than trim toward an authority
    // this row does not currently grant under either evaluator. See the doc above.
    return null;
  }
  const [first, ...rest] = rawNonEmptyCommaPieces(value);
  if (first === undefined) return null; // every piece was empty, e.g. ",", ",,"
  if (!isSingleMembershipRole(first)) return null;
  if (rest.some((piece) => piece !== first)) return null;
  return first;
}
