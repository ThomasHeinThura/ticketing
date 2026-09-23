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
 *  - The credential is a key kind and the key row itself is disabled → `null`.
 *  - A `workspace_member` pair with zero, more than one, or a malformed
 *    (`membershipRoleProblem`) role value → that workspace is skipped entirely, not
 *    guessed at. This reuses `resolveMembershipRoleFrom`, the exact function
 *    `assertCallerHasCapability` already uses, so the two can never disagree.
 *  - A `workspace_member.role` value that isn't a recognised `BUILT_IN_ROLES` key (a
 *    custom, editable role) is skipped — Slice 1 has no capability source for custom
 *    roles yet; `require-workspace-capability.ts`'s own doc comment names this identical
 *    gap for the same reason ("nowhere yet a custom, editable role could acquire it").
 *  - `side === "customer"` → every `workspace_member` row for that user is ignored, full
 *    stop, however it got there. A customer's only grant is the built-in `customer` role.
 *    This is what makes "a portal session must never gain agent roles" true by
 *    construction rather than by remembering to check it somewhere.
 *  - No persisted API-key capability subset exists yet (see the KNOWN GAP below) →
 *    `keyCapabilities: []`, never `undefined` and never the owner's full RBAC.
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
 *     always resolves `seesAll: false`. The pure mapper still fully implements and
 *     unit-tests the `seesAll → reach: { kind: "all" }` rule (rbac.md § Reach, step 2), fed
 *     directly rather than through the loader, so the day a write path exists this file
 *     needs no change — only the loader's `seesAll: false` literal becomes a real read.
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
import { eq } from "drizzle-orm";
import db, { schema } from "../database";
import { resolveMembershipRoleFrom } from "../utils/workspace-member-roles";

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
};

/** The `person` row for this user, or `null` when none exists. */
export type PersonFact = {
  readonly personId: string;
  readonly organisationId: string;
  readonly side: Side;
  readonly active: boolean;
};

/** The facts an API-key-credentialed request supplies, loaded by the caller. */
export type ApiKeyFact = {
  /** `apikey.enabled`. `false` (or a revoked/disabled owner, via `person.active`) → `null`. */
  readonly enabled: boolean;
  /**
   * The persisted capability subset, when one exists. Always absent from the real loader
   * today (KNOWN GAP 1) — present here so the mapper's clamping-and-passthrough behaviour
   * is unit-testable without inventing schema that does not exist yet.
   */
  readonly capabilities?: readonly string[];
};

/** Every fact `resolveIdentityFromFacts` needs, already loaded — no I/O inside the mapper. */
export type IdentityFacts = {
  readonly userId: string;
  readonly person: PersonFact | null;
  /** `user.role === "admin"` — today's only instance-admin bit. See KNOWN GAP 4. */
  readonly isInstanceAdmin: boolean;
  /** Every `workspace_member` row for this user, across every workspace — no per-row I/O. */
  readonly workspaceMemberships: readonly WorkspaceMembershipFact[];
  readonly teamIds: readonly string[];
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

function isBuiltInRoleKey(value: string): value is BuiltInRoleKey {
  return Object.hasOwn(BUILT_IN_ROLES, value);
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

  // The key itself (not its owner) is disabled.
  if (isKeyCredential(facts.credential) && facts.apiKey?.enabled === false) {
    return null;
  }

  const keyCapabilities = keyCapabilitiesFor(facts);

  if (person.side === "customer") {
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
    if (!isBuiltInRoleKey(resolution.role)) {
      // A custom, editable role name. Slice 1 has no capability source for these yet —
      // same gap `require-workspace-capability.ts`'s own doc comment names.
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

  const seesAllAnywhere = memberships.some((membership) => membership.seesAll);
  const reach: Reach =
    facts.isInstanceAdmin || seesAllAnywhere
      ? { kind: "all" }
      : { kind: "membership" };

  return {
    userId: facts.userId,
    personId: person.personId,
    side: "staff",
    organisationId: person.organisationId,
    portal: "agent",
    credential: facts.credential,
    memberships,
    teamIds: facts.teamIds,
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
 * queries — never one per membership. Three queries regardless of how many workspaces or
 * teams the user belongs to:
 *
 *   1. `user` left-joined to `person` (role + person facts in one round trip);
 *   2. every `workspace_member` row for this user;
 *   3. every `team_member` row for this user.
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
    })
    .from(schema.userTable)
    .leftJoin(
      schema.personTable,
      eq(schema.personTable.userId, schema.userTable.id),
    )
    .where(eq(schema.userTable.id, input.userId))
    .limit(1);

  // A `leftJoin` types every joined-table column as nullable regardless of that table's own
  // NOT NULL constraints (drizzle cannot know the join matched from the column types alone),
  // so `organisationId`/`active` are checked here too, even though `person` itself never
  // stores a null in either. All four must be present together or not at all -- they are
  // the same row.
  if (
    row === undefined ||
    row.personId === null ||
    row.organisationId === null ||
    row.active === null
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
  };

  const memberRows = await executor
    .select({
      workspaceId: schema.workspaceUserTable.workspaceId,
      role: schema.workspaceUserTable.role,
    })
    .from(schema.workspaceUserTable)
    .where(eq(schema.workspaceUserTable.userId, input.userId));

  const teamRows = await executor
    .select({ teamId: schema.teamMemberTable.teamId })
    .from(schema.teamMemberTable)
    .where(eq(schema.teamMemberTable.userId, input.userId));

  return resolveIdentityFromFacts({
    userId: input.userId,
    person,
    isInstanceAdmin: row.instanceRole === "admin",
    workspaceMemberships: memberRows.map((member) => ({
      workspaceId: member.workspaceId,
      role: member.role,
      // KNOWN GAP 3: no populated `sees_all` source for workspace-scope memberships yet.
      seesAll: false,
    })),
    teamIds: [...new Set(teamRows.map((team) => team.teamId))],
    credential: input.credential,
    apiKey: input.apiKey,
  });
}
