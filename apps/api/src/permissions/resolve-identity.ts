/**
 * `resolveIdentity` — issue #8, Slice 1 of the runtime-authorization-integration plan
 * (issue #8 comment, 2026-09-23). This is the adapter `docs/01-architecture/rbac.md` and
 * `docs/01-architecture/auth-and-identity.md` have assumed since before this codebase had
 * one: it turns "which user made this request, and how" into the exact `ResolvedIdentity`
 * shape `packages/permissions`'s evaluator takes — memberships, roles, `sees_all`
 * (folded into `reach`), and API-key clamping.
 *
 * **This file is INERT.** Nothing on the request path calls it yet — no route, no
 * middleware. Slice 2 wires it in behind a shadow-mode comparison; this slice only proves
 * the mapping itself is correct, in isolation, before anything downstream trusts it.
 *
 * WHY `apps/api/src/permissions/`, NOT `packages/permissions`. `packages/permissions` is
 * deliberately pure — "no I/O, no database, no framework" (that package's own `index.ts`
 * doc comment) — so the same code answers the same question in the API, in a test and in
 * CI. This adapter is the opposite of pure by necessity: its whole job is reading
 * `person`, `workspace_member`, `user` and `team_member` rows. It belongs beside the other
 * request-context utilities in `apps/api/src/utils/` in spirit, but is given its own
 * `apps/api/src/permissions/` directory because it is a distinct, single-purpose seam —
 * the one place that is allowed to construct a `ResolvedIdentity` — and mixing it into
 * `apps/api/src/utils/` (44 unrelated files) would bury that fact. Nothing in
 * `apps/api/src/utils/workspace-access-middleware.ts` or
 * `require-workspace-capability.ts` is touched: PR #307 owns the former, and this slice
 * does not wire into either.
 *
 * SHAPE: a pure mapper (`resolveIdentityFromFacts`) plus a thin loader (`resolveIdentity`).
 * The mapper takes already-loaded rows and contains every fail-closed decision; the loader
 * only does I/O and never decides anything the mapper doesn't also decide when given the
 * same facts directly. This split is what makes the mapper exhaustively unit-testable
 * without a database.
 *
 * FAIL-CLOSED, THROUGHOUT — every branch below reads as "missing or ambiguous evidence
 * loses authority, never gains it":
 *
 *  - No `person` row for this user id (never provisioned, or an anonymous session that was
 *    never backfilled — `apps/api/src/utils/seed-internal-organisation.ts` only backfilled
 *    persons that existed *at that migration*) → `null`. No identity, not a low-authority one.
 *  - `person.active === false` (a deactivated member, including a deactivated API-key
 *    owner, since a personal key is resolved against its owner's *current* identity per
 *    rbac.md § MCP) → `null`, for the same reason.
 *  - `user.banned` → `null`, unconditionally, staff or customer (S6 below).
 *  - The credential is a key kind and either the key row itself is disabled, or no
 *    `apiKey` fact was supplied at all → `null` (S4 below).
 *  - A key credential whose `apiKey.ownerUserId` disagrees with the resolved `userId` →
 *    `null` — the caller passed two facts about two different people (S4 below).
 *  - A `workspace_member` pair with zero, more than one, or a malformed
 *    (`membershipRoleProblem`) role value → that workspace is skipped entirely, not
 *    guessed at. This reuses `resolveMembershipRoleFrom`, the exact function
 *    `assertCallerHasCapability` already uses, so the two can never disagree.
 *  - A `workspace_member.role` value that isn't a recognised, WORKSPACE-scope
 *    `BUILT_IN_ROLES` key is skipped — either a custom, editable role (Slice 1 has no
 *    capability source for these yet; `require-workspace-capability.ts`'s own doc comment
 *    names this identical gap) or a built-in name whose scope isn't `"workspace"`
 *    (`instance_admin`, `customer` — S1 below).
 *  - `side === "customer"` → every `workspace_member` row for that user is ignored, full
 *    stop, however it got there. A customer's only grant is the built-in `customer` role.
 *    This is what makes "a portal session must never gain agent roles" true by
 *    construction rather than by remembering to check it somewhere.
 *  - A customer identity presenting a key credential → `null` (S6 below).
 *  - A customer whose organisation is inactive, soft-deleted, or has portal access
 *    disabled → `null` (S6 below).
 *  - A team whose workspace the person no longer has a `workspace_member` row in is
 *    excluded from `teamIds` (S5 below).
 *  - No persisted API-key capability subset exists yet (see the KNOWN GAP below) →
 *    `keyCapabilities: []`, never `undefined` and never the owner's full RBAC.
 *
 * SECURITY REVIEW FIXES (Opus 5.5, PR #315, `docs/07-planning/security-reviews/315-resolve-identity.md`,
 * committed `cc68b93`). S1 was BLOCKING; S4, S5 and S6 were fixed in this same pass because
 * they were narrow, in-file, and cheaper to close now than to re-open this file for later.
 * S2 (custom roles minting a built-in name — issue #8's separate scope, see #318), S3 (the
 * `sees_all` shared-contract question), S7 (this comment block's own then-inaccurate
 * anonymous-plugin claim — fixed in the PR body, not repeated here), S8, S9 and S10 are
 * NOT addressed here; see the security-review note and the PR body for their disposition.
 *
 * KNOWN GAPS AGAINST THE SPEC — found while building this, not guessed around. Per this
 * slice's own instructions: spec wins, and each is listed in the PR body too.
 *
 *  1. **No API-key capability-subset column exists.** `auth-and-identity.md` describes an
 *     `api_key` extension table carrying "capability subset, IP allowlist, per-key rate
 *     limit, expiry, last-used, `is_mcp`". `apps/api/src/database/schema.ts`'s `apikeyTable`
 *     has none of that — only better-auth's own `permissions` column, a `{resource:
 *     action[]}` statements map in a completely different, disjoint vocabulary from
 *     `Capability` (`"task"` vs `work_item:*`, `"share"` vs no such action). Translating one
 *     into the other would be guessing at a mapping no document specifies, so this loader
 *     does not attempt it: every key-credentialed identity gets `keyCapabilities: []` until
 *     the real extension table lands. This is the maximally fail-closed answer, not a
 *     placeholder pretending to be a real one.
 *  2. **`mcp_key` cannot be distinguished from `api_key` yet.** The same missing extension
 *     table would carry `is_mcp`; without it, every key-authenticated request resolves to
 *     the `"api_key"` `CredentialKind`. Harmless today (both kinds are clamped identically
 *     by `can()`), but the loader can never produce `"mcp_key"` until that column exists.
 *  3. **`sees_all` has no populated source for workspace-scope memberships.** The `membership`
 *     table (`data-model.md` §2, P1 identity schema) has the real `sees_all` column, but
 *     nothing writes a `membership` row for a workspace membership yet — `workspace_member`
 *     (the table that actually has rows) has no such column at all. The loader therefore
 *     always resolves `seesAll: false`. The pure mapper scopes any future sees_all grant to
 *     the workspace whose membership carries it; it never becomes global reach.
 *  4. **Instance-admin, as modelled here, is narrower than two existing bypasses.**
 *     `docs/01-architecture/rbac.md` § Reach step 1 says `instance:admin` grants *reach*
 *     only; `BUILT_IN_ROLES.instance_admin` (`packages/permissions/src/roles.ts`) holds only
 *     `instance:*` capabilities, nothing workspace-scoped. This mapper follows the spec:
 *     `user.role === "admin"` (today's only instance-admin bit — no `membership` row models
 *     it) becomes an `instance_admin` `RoleGrant` (reach `"all"`, `instance:*` authority
 *     only). But `apps/api/src/utils/require-workspace-permission.ts` and
 *     `require-workspace-role-authority.ts` both call `isInstanceAdmin(c)` as a full bypass
 *     of *every* workspace-scoped capability check, on *any* workspace — strictly wider
 *     authority than the spec grants. `require-workspace-capability.ts` and
 *     `transfer-workspace-ownership.ts` deliberately do NOT bypass, and already document
 *     this exact three-way disagreement. Slice 1 does not resolve it (nothing calls this
 *     adapter yet); Slice 2's shadow log will surface it live, on real traffic, the way the
 *     issue's own addendum expects.
 *  5. **Customer identity has no `membership`/`role` backing at all.** No code path in
 *     `apps/api/src` ever assigns the `"customer"` role (`grep` returns nothing outside
 *     `packages/permissions`) — being `side === "customer"` is itself the grant, per
 *     rbac.md ("off the ladder"). This mapper treats it that way: a customer always holds
 *     exactly the built-in `customer` `RoleGrant`, organisation-scoped, never sourced from
 *     any row.
 *  6. **`portal` mirrors `side` 1:1.** `auth-and-identity.md`'s two-better-auth-instance
 *     portal split (`session.portal`, compared against the request host) is not built —
 *     there is no `portal` column on `session` (confirmed by reading `schema.ts`).
 *     `side === "customer"` therefore always yields `portal: "customer"` and `staff` always
 *     yields `"agent"`, which is the least-authority reading available (a customer can never
 *     read as `portal: "agent"`) until the real per-origin session split exists.
 */

import {
  BUILT_IN_ROLES,
  type BuiltInRoleKey,
  type CredentialKind,
  isKeyCredential,
  type Membership,
  type Reach,
  type ResolvedIdentity,
  type RoleGrant,
  type Side,
} from "@taskdesk/permissions";
import { and, eq, inArray } from "drizzle-orm";
import db, { schema } from "../database";
import {
  isGenuineBuiltInRoleGrant,
  resolveMembershipRoleFrom,
} from "../utils/workspace-member-roles";

/* ------------------------------------------------------------------ *
 * The pure mapper
 * ------------------------------------------------------------------ */

/** One `workspace_member` row for this user, exactly as stored. */
export type WorkspaceMembershipFact = {
  readonly workspaceId: string;
  readonly role: string;
  /**
   * The `sees_all` grant for this membership. Always `false` from the real loader today
   * (see KNOWN GAP 3 above) — present here so the pure mapper's reach logic is fully
   * testable without a database.
   */
  readonly seesAll: boolean;
  /**
   * Issue #318 (security), Opus review of PR #315 finding S2. Does a GENUINE seeded
   * `workspace_role` row (`is_system = true`) back this row's `role` name, in this
   * workspace? Read by the loader from `workspace_role.is_system`
   * (`seed-default-workspace-roles.ts`/`create-workspace.ts` set it `true`;
   * `create-workspace-role.ts` never does). Always `false` from the real loader for
   * `"owner"`, which never gets a `workspace_role` row at all (retrofit plan R5) —
   * `isGenuineBuiltInRoleGrant` (`workspace-member-roles.ts`, shared with
   * `require-workspace-capability.ts`) special-cases `"owner"` rather than trusting this
   * field for it, the same split `require-workspace-capability.ts`'s
   * `isGenuineBuiltInRoleAssignment` uses. Without this field (or before it existed), a
   * custom role an administrator named e.g. `"manager"` read as indistinguishable from a
   * genuine built-in manager here, the same gap `require-workspace-capability.ts`'s own
   * doc comment named for the legacy capability check.
   */
  readonly isSystemRole: boolean;
};

/**
 * The `person` row for this user, or `null` when none exists. The three `organisation*`
 * fields are read alongside `person` in the loader's first query (S6): they gate a
 * *customer* identity only — an inactive, soft-deleted or portal-access-disabled
 * organisation must not resolve a customer to a live identity
 * (multi-tenancy.md:156 `organisation.portal_access`; god-mode.md:408 "Organisation
 * suspended … every session … invalidated"). Staff persons live in the internal
 * organisation, which this codebase never suspends, soft-deletes or disables portal access
 * for — but the fields are still read unconditionally, so the gate is one `if` in the
 * mapper rather than a second, side-conditional query.
 */
export type PersonFact = {
  readonly personId: string;
  readonly organisationId: string;
  readonly side: Side;
  readonly active: boolean;
  readonly organisationActive: boolean;
  readonly organisationPortalAccess: boolean;
  readonly organisationDeleted: boolean;
};

/**
 * The facts an API-key-credentialed request supplies, loaded by the caller.
 *
 * `ownerUserId` is required (S4, Opus review of PR #315): the caller supplies `userId` and
 * `apiKey` as two independent values, and without an owner id on the key fact itself the
 * mapper has no way to check they agree — a caller bug that mismatched them would silently
 * resolve the WRONG person's identity under the key's clamp. `resolveIdentityFromFacts`
 * refuses whenever `ownerUserId !== userId`.
 */
export type ApiKeyFact = {
  /** `apikey.enabled`. `false` (or a revoked/disabled owner, via `person.active`) → `null`. */
  readonly enabled: boolean;
  /** `apikey.userId` (or `.referenceId`) — the id the key row itself claims to belong to. */
  readonly ownerUserId: string;
  /**
   * The persisted capability subset, when one exists. Always absent from the real loader
   * today (KNOWN GAP 1) — present here so the mapper's clamping-and-passthrough behaviour
   * is unit-testable without inventing schema that does not exist yet.
   */
  readonly capabilities?: readonly string[];
};

/** One `team_member` row for this user, with the team's own `workspace_id` (S5). */
export type TeamMembershipFact = {
  readonly teamId: string;
  readonly workspaceId: string;
};

/** Every fact `resolveIdentityFromFacts` needs, already loaded — no I/O inside the mapper. */
export type IdentityFacts = {
  readonly userId: string;
  readonly person: PersonFact | null;
  /** `user.banned` (S6) — refused unconditionally, staff or customer. */
  readonly banned: boolean;
  /** `user.role === "admin"` — today's only instance-admin bit. See KNOWN GAP 4. */
  readonly isInstanceAdmin: boolean;
  /** Every `workspace_member` row for this user, across every workspace — no per-row I/O. */
  readonly workspaceMemberships: readonly WorkspaceMembershipFact[];
  /**
   * Every `team_member` row for this user, with each team's `workspace_id`. Filtered down
   * to `teamIds` in the mapper, keeping only teams whose workspace the person currently has
   * a `workspace_member` row in (S5) — `remove-workspace-member.ts`/`leave-workspace.ts`
   * delete only `workspace_member`, so an unfiltered join would keep a removed member's old
   * team indefinitely.
   */
  readonly teamMemberships: readonly TeamMembershipFact[];
  readonly credential: CredentialKind;
  /** Present only when `credential` is a key kind (`isKeyCredential`). */
  readonly apiKey?: ApiKeyFact;
};

function groupByWorkspace(
  memberships: readonly WorkspaceMembershipFact[],
): Map<string, WorkspaceMembershipFact[]> {
  const grouped = new Map<string, WorkspaceMembershipFact[]>();
  for (const row of memberships) {
    const existing = grouped.get(row.workspaceId);
    if (existing) {
      existing.push(row);
    } else {
      grouped.set(row.workspaceId, [row]);
    }
  }
  return grouped;
}

/**
 * Is `value` a `BUILT_IN_ROLES` key that a `workspace_member.role` string may honestly name?
 *
 * **Not** `Object.hasOwn(BUILT_IN_ROLES, value)` alone — that also accepts `instance_admin`
 * (`scope: "instance"`) and `customer` (`scope: "organisation"`). Both compile: nothing in
 * `BuiltInRoleKey` restricts which scope a key belongs to. Opus security review of PR #315,
 * finding S1: a workspace owner can create a `workspace_role`/`workspace_member.role` row
 * literally named `"instance_admin"` or `"customer"` (`create-workspace-role.ts` reserves
 * only `"owner"`), and this function used to accept it — producing an `instance_admin`
 * `RoleGrant` with a non-null `scopeId` (violating `identity.ts`'s own "`null` for an
 * instance-scope role" invariant) or a `customer` grant on a **staff** identity (violating
 * "a customer is never staff"). Today's evaluator happens to neutralise both
 * (`grantAppliesTo` requires `scopeId === null` for an instance grant), so this was not
 * exploitable — but this is the one place allowed to construct a `ResolvedIdentity`, and
 * every future consumer (Slice 2's shadow diff, a rank comparison, a `roleKey ===
 * "instance_admin"` check) trusts its output directly, not through `grantAppliesTo`.
 *
 * `BUILT_IN_ROLES[value].scope === "workspace"` is exactly the fix the review named: a
 * `workspace_member.role` can only ever honestly grant a workspace-scope built-in.
 */
function isBuiltInWorkspaceRoleKey(value: string): value is BuiltInRoleKey {
  return (
    Object.hasOwn(BUILT_IN_ROLES, value) &&
    BUILT_IN_ROLES[value as BuiltInRoleKey].scope === "workspace"
  );
}

/** `keyCapabilities` for a key-credentialed identity — never `undefined`, never a guess. */
function keyCapabilitiesFor(
  facts: Pick<IdentityFacts, "credential" | "apiKey">,
): readonly string[] | undefined {
  if (!isKeyCredential(facts.credential)) {
    return undefined;
  }
  // Invariant (`identity.ts`): a key credential ALWAYS carries a defined subset, even when
  // nothing was actually loaded for it. `?? []` is the fail-closed default — see KNOWN GAP 1.
  return facts.apiKey?.capabilities ?? [];
}

/**
 * The pure half of `resolveIdentity`: pre-loaded rows in, `ResolvedIdentity | null` out.
 * No I/O, no framework — exhaustively unit-tested in `resolve-identity.test.ts`.
 */
export function resolveIdentityFromFacts(
  facts: IdentityFacts,
): ResolvedIdentity | null {
  const { person } = facts;

  // Anonymous, never-provisioned, or deactivated — no identity at all, not a low-authority
  // one. A deactivated API-key OWNER is refused here too: the owner IS this `person`.
  if (person === null || !person.active) {
    return null;
  }

  // S6 (Opus review of PR #315): a banned user is refused unconditionally, staff or
  // customer. better-auth's own ban enforcement is session-only and the API-key path
  // (`verifyApiKey`) does not check it at all — this is the one place that resolves
  // identity for BOTH paths, so it is the one place that can refuse for both.
  if (facts.banned) {
    return null;
  }

  if (isKeyCredential(facts.credential)) {
    // S4: a key credential with no `apiKey` fact at all used to resolve to a non-null
    // identity with `keyCapabilities: []` — inert for a capability policy, but NOT inert
    // for a `self`/`portal` policy, which never consults `keyCapabilities`
    // (`evaluator.ts`). Absence of the fact is refused outright, the same as an explicit
    // `enabled: false`.
    if (facts.apiKey === undefined || facts.apiKey.enabled === false) {
      return null;
    }
    // S4: the caller supplies `userId` and `apiKey` as two independently-passed values;
    // without this check a caller bug that mismatched them would resolve the WRONG
    // person's identity, clamped by a key that was never theirs.
    if (facts.apiKey.ownerUserId !== facts.userId) {
      return null;
    }
  }

  const keyCapabilities = keyCapabilitiesFor(facts);

  if (person.side === "customer") {
    // S6: no document in the corpus grants a customer `api_key:manage` (absent from
    // `CUSTOMER_CAPABILITIES`, roles.ts) or names a portal route that creates a key, so
    // there is no spec basis for a customer identity to carry one — refused, fail-closed,
    // rather than assumed harmless because `keyCapabilities` would clamp it to nothing:
    // clamping only affects a CAPABILITY policy, and a `self`/`portal` policy never
    // consults it (same class of gap as S4, probed by the reviewer on a `kind-3` policy).
    if (isKeyCredential(facts.credential)) {
      return null;
    }
    // S6: multi-tenancy.md:156 (`organisation.portal_access`) and god-mode.md:408
    // ("Organisation suspended … every session … invalidated") both expect an inactive,
    // soft-deleted or portal-access-disabled organisation to cut a customer's access.
    // Staff never hit this (the internal organisation is never suspended), so the gate is
    // scoped to the customer branch rather than checked for every identity.
    if (
      !person.organisationActive ||
      person.organisationDeleted ||
      !person.organisationPortalAccess
    ) {
      return null;
    }

    // A customer's grant is never sourced from `workspace_member` — being `side ===
    // "customer"` IS the grant (KNOWN GAP 5). Any `workspace_member` row for this user,
    // however it got there, is ignored: a portal session must never gain agent roles.
    const customerGrant: RoleGrant = {
      roleKey: BUILT_IN_ROLES.customer.key,
      scope: BUILT_IN_ROLES.customer.scope,
      scopeId: person.organisationId,
      rank: BUILT_IN_ROLES.customer.rank,
      capabilities: BUILT_IN_ROLES.customer.capabilities,
    };

    return {
      userId: facts.userId,
      personId: person.personId,
      side: "customer",
      organisationId: person.organisationId,
      portal: "customer", // KNOWN GAP 6: mirrors `side` until the real portal split exists.
      credential: facts.credential,
      memberships: [],
      teamIds: [],
      reach: { kind: "organisation", ids: [person.organisationId] },
      authority: [customerGrant],
      keyCapabilities,
    };
  }

  // Staff.
  const memberships: Membership[] = [];
  const authority: RoleGrant[] = [];

  for (const [workspaceId, rows] of groupByWorkspace(
    facts.workspaceMemberships,
  )) {
    const resolution = resolveMembershipRoleFrom(rows.map((row) => row.role));
    if (!resolution.ok) {
      // No membership, ambiguous rows, or a malformed value — skip this workspace rather
      // than guess. Matches `assertCallerHasCapability`'s exact resolution.
      continue;
    }
    if (!isBuiltInWorkspaceRoleKey(resolution.role)) {
      // Either a custom, editable role name (Slice 1 has no capability source for these
      // yet — same gap `require-workspace-capability.ts`'s own doc comment names), or a
      // built-in name that exists but is not workspace-scope (`instance_admin`,
      // `customer`) — see `isBuiltInWorkspaceRoleKey`'s doc comment, S1.
      continue;
    }
    // `resolution.ok` came from `resolveMembershipRoleFrom(rows.map(...))`, whose
    // `isUnambiguousMembership` check means `rows` has EXACTLY one element here — the same
    // explicit-undefined-check idiom `resolveMembershipRoleFrom` itself uses under
    // `noUncheckedIndexedAccess`, kept explicit rather than asserted away.
    const membershipRow = rows[0];
    if (membershipRow === undefined) {
      continue;
    }
    if (
      !isGenuineBuiltInRoleGrant(resolution.role, membershipRow.isSystemRole)
    ) {
      // Issue #318 (security), S2: `role` names a real `BUILT_IN_ROLES` key, but this row
      // is not backed by a genuine seeded `workspace_role` row — a custom role that took a
      // built-in's name before `create-workspace-role.ts` reserved every key. Treated the
      // same as an unrecognised custom role name above: skipped, not granted the built-in's
      // capabilities.
      continue;
    }
    const builtIn = BUILT_IN_ROLES[resolution.role];
    const seesAll = rows.some((row) => row.seesAll);
    memberships.push({
      scope: "workspace",
      scopeId: workspaceId,
      seesAll,
    });
    authority.push({
      roleKey: builtIn.key,
      scope: builtIn.scope,
      scopeId: workspaceId,
      rank: builtIn.rank,
      capabilities: builtIn.capabilities,
    });
  }

  if (facts.isInstanceAdmin) {
    authority.push({
      roleKey: BUILT_IN_ROLES.instance_admin.key,
      scope: BUILT_IN_ROLES.instance_admin.scope,
      scopeId: null,
      rank: BUILT_IN_ROLES.instance_admin.rank,
      capabilities: BUILT_IN_ROLES.instance_admin.capabilities,
    });
  }

  const seesAllWorkspaceIds = [
    ...new Set(
      memberships
        .filter((membership) => membership.seesAll)
        .map((membership) => membership.scopeId),
    ),
  ];
  const reach: Reach = facts.isInstanceAdmin
    ? { kind: "all" }
    : seesAllWorkspaceIds.length > 0
      ? {
          kind: "membership_with_workspaces",
          workspaceIds: seesAllWorkspaceIds,
        }
      : { kind: "membership" };

  // S5: keep only teams whose workspace this person currently has a `workspace_member`
  // row in. `remove-workspace-member.ts`/`leave-workspace.ts` delete only `workspace_member`
  // rows, never `team_member`, so an unfiltered `teamMemberships` join would keep a removed
  // member's old team's reach indefinitely (rbac.md § MCP: "membership removal … take[s]
  // effect on the next call"). Filtered against the RAW membership rows (every workspace a
  // `workspace_member` row exists for), not just the ones that resolved to a valid grant
  // above — a malformed or ambiguous role value is a data-quality problem with the ROLE,
  // not evidence that the person stopped being a member of the workspace.
  const memberWorkspaceIds = new Set(
    facts.workspaceMemberships.map((row) => row.workspaceId),
  );
  const teamIds = [
    ...new Set(
      facts.teamMemberships
        .filter((team) => memberWorkspaceIds.has(team.workspaceId))
        .map((team) => team.teamId),
    ),
  ];

  return {
    userId: facts.userId,
    personId: person.personId,
    side: "staff",
    organisationId: person.organisationId,
    portal: "agent",
    credential: facts.credential,
    memberships,
    teamIds,
    reach,
    authority,
    keyCapabilities,
  };
}

/* ------------------------------------------------------------------ *
 * The thin loader
 * ------------------------------------------------------------------ */

type DbOrTx = Pick<typeof db, "select">;

export type ResolveIdentityInput = {
  readonly userId: string;
  readonly credential: CredentialKind;
  /** Required exactly when `credential` is a key kind — the caller already has this from
   * `c.get("apiKey")` (`authenticate-api-request.ts`), so the loader does not re-query it. */
  readonly apiKey?: ApiKeyFact;
};

/**
 * Loads exactly what `resolveIdentityFromFacts` needs, in a bounded, fixed number of
 * queries — never one per membership. Four queries regardless of how many workspaces or
 * teams the user belongs to (issue #318 added the fourth; the loader ran three of these
 * before it):
 *
 *   1. `user` left-joined to `person` left-joined to `organisation` (role, ban status,
 *      person facts and the customer-gating organisation facts, all in one round trip);
 *   2. every `workspace_member` row for this user;
 *   3. issue #318 (security), S2: every `workspace_role` row with `is_system = true` in any
 *      workspace query 2 returned — one `IN (...)` query over the distinct workspace ids,
 *      not one per membership — so the mapper can tell a genuine seeded built-in role row
 *      from a custom row that merely shares its name. Skipped (no query at all) when query
 *      2 found no memberships;
 *   4. every `team_member` row for this user, inner-joined to `team` for its `workspace_id`
 *      (S5) — still one query, not a second round trip.
 */
export async function resolveIdentity(
  input: ResolveIdentityInput,
  executor: DbOrTx = db,
): Promise<ResolvedIdentity | null> {
  const [row] = await executor
    .select({
      personId: schema.personTable.id,
      organisationId: schema.personTable.organisationId,
      side: schema.personTable.side,
      active: schema.personTable.active,
      instanceRole: schema.userTable.role,
      banned: schema.userTable.banned,
      organisationActive: schema.organisationTable.active,
      organisationPortalAccess: schema.organisationTable.portalAccess,
      organisationDeletedAt: schema.organisationTable.deletedAt,
    })
    .from(schema.userTable)
    .leftJoin(
      schema.personTable,
      eq(schema.personTable.userId, schema.userTable.id),
    )
    .leftJoin(
      schema.organisationTable,
      eq(schema.organisationTable.id, schema.personTable.organisationId),
    )
    .where(eq(schema.userTable.id, input.userId))
    .limit(1);

  // A `leftJoin` types every joined-table column as nullable regardless of that table's own
  // NOT NULL constraints (drizzle cannot know the join matched from the column types alone),
  // so every person/organisation field is checked here too, even though the underlying rows
  // never store a null in most of them. All of `person` and `organisation` must be present
  // together or not at all -- `person.organisation_id` is a NOT NULL FK, so if `person`
  // exists its `organisation` row does too; a null here after `personId` is non-null would
  // be a genuine data fault, refused the same as a missing person.
  if (
    row === undefined ||
    row.personId === null ||
    row.organisationId === null ||
    row.active === null ||
    row.organisationActive === null ||
    row.organisationPortalAccess === null
  ) {
    return null;
  }

  const side: Side | null =
    row.side === "staff" || row.side === "customer" ? row.side : null;
  if (side === null) {
    // A `person.side` value outside the two known values is a data fault, not a decision
    // this loader may make — fail closed rather than guess which portal it belongs to.
    return null;
  }

  const person: PersonFact = {
    personId: row.personId,
    organisationId: row.organisationId,
    side,
    active: row.active,
    organisationActive: row.organisationActive,
    organisationPortalAccess: row.organisationPortalAccess,
    organisationDeleted: row.organisationDeletedAt !== null,
  };

  const memberRows = await executor
    .select({
      workspaceId: schema.workspaceUserTable.workspaceId,
      role: schema.workspaceUserTable.role,
    })
    .from(schema.workspaceUserTable)
    .where(eq(schema.workspaceUserTable.userId, input.userId));

  // Issue #318 (security), S2. A 4th bounded query (still fixed regardless of how many
  // memberships this person has — never one per membership): which of THIS person's
  // `workspace_member.role` values are backed by a genuine seeded `workspace_role` row
  // (`is_system = true`) in the SAME workspace, so `isGenuineBuiltInRoleGrant` can refuse a
  // custom row that merely shares a built-in's name. Skipped entirely when the person has
  // no memberships at all — the common case for a brand-new user.
  const memberWorkspaceIds = [
    ...new Set(memberRows.map((member) => member.workspaceId)),
  ];
  const systemRoleRows =
    memberWorkspaceIds.length === 0
      ? []
      : await executor
          .select({
            workspaceId: schema.workspaceRoleTable.workspaceId,
            role: schema.workspaceRoleTable.role,
          })
          .from(schema.workspaceRoleTable)
          .where(
            and(
              inArray(
                schema.workspaceRoleTable.workspaceId,
                memberWorkspaceIds,
              ),
              eq(schema.workspaceRoleTable.isSystem, true),
            ),
          );
  const systemRoleKeys = new Set(
    systemRoleRows.map((row) => `${row.workspaceId}\u0000${row.role}`),
  );

  const teamRows = await executor
    .select({
      teamId: schema.teamMemberTable.teamId,
      workspaceId: schema.teamTable.workspaceId,
    })
    .from(schema.teamMemberTable)
    .innerJoin(
      schema.teamTable,
      eq(schema.teamTable.id, schema.teamMemberTable.teamId),
    )
    .where(eq(schema.teamMemberTable.userId, input.userId));

  return resolveIdentityFromFacts({
    userId: input.userId,
    person,
    banned: row.banned === true,
    isInstanceAdmin: row.instanceRole === "admin",
    workspaceMemberships: memberRows.map((member) => ({
      workspaceId: member.workspaceId,
      role: member.role,
      // KNOWN GAP 3: no populated `sees_all` source for workspace-scope memberships yet.
      seesAll: false,
      isSystemRole: systemRoleKeys.has(
        `${member.workspaceId}\u0000${member.role}`,
      ),
    })),
    teamMemberships: teamRows.map((team) => ({
      teamId: team.teamId,
      workspaceId: team.workspaceId,
    })),
    credential: input.credential,
    apiKey: input.apiKey,
  });
}
