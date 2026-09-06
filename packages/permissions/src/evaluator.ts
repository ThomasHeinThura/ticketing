/**
 * The permission evaluator.
 *
 * Two axes, evaluated separately and never mixed: **reach** (what you can see) and
 * **authority** (what you can change). "An authority check never consults reach, and a reach
 * check never consults authority. Enforced by the type system: the evaluator takes them as
 * separate arguments" (`docs/01-architecture/rbac.md`).
 *
 * Pure. No I/O, no database, no clock beyond what the caller passes in.
 */

import {
  CAPABILITIES,
  type Capability,
  type CapabilityTier,
  capabilitiesInGroup,
  isCapability,
  tierPermits,
} from "./capabilities";
import type {
  Membership,
  RefusedCapabilityHandler,
  ResolvedIdentity,
  RoleGrant,
  ScopeTarget,
  UnknownCapabilityHandler,
} from "./identity";
import {
  type CapabilityPolicy,
  isCapabilityPolicy,
  isDelegatedPolicy,
  isPortalPolicy,
  isPublicPolicy,
  isSelfPolicy,
  type Policy,
  type Scope,
  type ScopeSource,
} from "./policy";
import { type RoleScope, roleScopeTier } from "./roles";

/* ------------------------------------------------------------------ *
 * Capability expansion
 * ------------------------------------------------------------------ */

export type CapabilityExpansionOptions = {
  /**
   * The tier of the **container** being expanded — `roleScopeTier(grant.scope)` for a role
   * row, the owner's tier for an API key. Left undefined, expansion is **not** clamped: this
   * is the shape a caller who has not yet adopted a tier gets, not a safe default, and it
   * exists only so a caller not built around a container's tier keeps compiling. The real
   * security boundary is `authorityFor`'s own call, which always supplies one (finding 6) —
   * an omitted tier here must never be read as "instance".
   */
  readonly tier?: CapabilityTier;
  readonly onUnknown?: UnknownCapabilityHandler;
  /** A stored capability the container's tier does not permit. Refused, and reported here. */
  readonly onRefused?: RefusedCapabilityHandler;
  readonly roleKey?: string;
  readonly source?: "role" | "api_key";
};

/**
 * Expand a stored capability list through its implications, transitively, clamped to
 * `options.tier` when one is given.
 *
 * Implication is expanded **at evaluation time as well as at grant time**, so a role stored
 * without an implied entry still behaves correctly (RL-5). Three things are refused rather
 * than expanded:
 *
 * - an unrecognised string, reported to `onUnknown` and treated as absent — it is never
 *   expanded by a wildcard implication;
 * - when a `tier` is given, a capability above it, reported to `onRefused` and treated as
 *   absent. A workspace-scope role row carrying `"instance:admin"` then expands to
 *   **nothing**, however that string got into the row — a role editor, a JSON import, a
 *   plugin, or another process writing the table directly (finding 6). The gate sits where a
 *   name is **taken off the queue**, not only where it is read out of `stored`, so it holds
 *   for a capability that arrives by implication too.
 */
export function expandCapabilities(
  stored: readonly string[],
  options: CapabilityExpansionOptions = {},
): Set<Capability> {
  const { tier, onUnknown, onRefused, roleKey, source = "role" } = options;
  const expanded = new Set<Capability>();
  const queue: Capability[] = [];

  const admit = (capability: Capability): boolean => {
    if (tier === undefined || tierPermits(tier, capability)) return true;
    onRefused?.(capability, { roleKey, source, tier });
    return false;
  };

  for (const name of stored) {
    if (!isCapability(name)) {
      onUnknown?.(name, { roleKey, source });
      continue;
    }
    if (admit(name)) queue.push(name);
  }

  while (queue.length > 0) {
    const capability = queue.pop() as Capability;
    if (expanded.has(capability)) continue;
    expanded.add(capability);

    for (const implied of CAPABILITIES[capability].implies) {
      if (implied === "instance:*") {
        for (const instanceCapability of capabilitiesInGroup("Instance")) {
          if (expanded.has(instanceCapability)) continue;
          if (admit(instanceCapability)) queue.push(instanceCapability);
        }
        continue;
      }
      if (expanded.has(implied)) continue;
      if (admit(implied)) queue.push(implied);
    }
  }

  return expanded;
}

/* ------------------------------------------------------------------ *
 * Authority
 * ------------------------------------------------------------------ */

/**
 * Which grant scopes may satisfy a policy declaring each scope kind — finding 4.
 *
 * `workspace` ⊐ `project` ⊐ `work_item`: a workspace role covers every project and work item
 * inside it. `organisation` is **not** in that chain — a `workspace` row has no organisation
 * column at all (`data-model.md`), and `project.organisation_id` names the *customer* a
 * project serves, not a container the workspace sits inside. The one organisation-scope role,
 * `customer`, therefore satisfies an organisation-scope policy and nothing else. `instance`
 * satisfies everything.
 */
const GRANT_SCOPES_FOR: Readonly<Record<Scope, readonly RoleScope[]>> = {
  instance: ["instance"],
  organisation: ["instance", "organisation"],
  workspace: ["instance", "workspace"],
  project: ["instance", "workspace", "project"],
  work_item: ["instance", "workspace", "project"],
};

/**
 * The id `grant.scopeId` must equal for `grant.scope` to satisfy a policy declaring
 * `policyScope`, read off the flat target bag. `undefined` means the target did not supply it;
 * `null` means it was supplied and is genuinely absent (an internal project's `null`
 * organisation), which matches no grant.
 *
 * For `policyScope === "work_item"`, the project id that matters is the work item's **own**
 * project (`workItemProjectId`) — the work item's id itself is irrelevant to authority, only
 * to reach.
 */
function requiredIdFor(
  policyScope: Scope,
  grantScope: RoleScope,
  target: ScopeTarget,
): string | null | undefined {
  switch (grantScope) {
    case "organisation":
      return target.organisationId;
    case "workspace":
      return target.workspaceId;
    case "project":
      return policyScope === "work_item"
        ? target.workItemProjectId
        : target.projectId;
    default:
      return undefined;
  }
}

/**
 * Does `grant` satisfy a policy declaring `scope`?
 *
 * Two gates, both new here. **Selection**: `policyScope` chooses which id on the target is
 * authoritative, via `GRANT_SCOPES_FOR` and `requiredIdFor` — not "any grant whose `scopeId`
 * equals any id present on the target", which is what let a workspace-scope role satisfy an
 * `instance`-scope policy and a project-scope policy resolve against the wrong workspace
 * (finding 4). **Containment**: a grant of a scope kind the table does not list for
 * `policyScope` never applies, whatever id it carries.
 */
function grantAppliesTo(
  grant: RoleGrant,
  scope: Scope,
  target: ScopeTarget,
): boolean {
  if (!GRANT_SCOPES_FOR[scope].includes(grant.scope)) return false;

  // An instance grant applies everywhere — and carries scopeId null. A row that claims scope
  // "instance" with an id is malformed, and malformed never means everywhere.
  if (grant.scope === "instance") return grant.scopeId === null;

  const required = requiredIdFor(scope, grant.scope, target);
  if (required === undefined || required === null) return false;
  return grant.scopeId === required;
}

/**
 * The capabilities this identity holds against `target` for a policy declaring `scope`,
 * implications expanded and clamped to each grant's own tier.
 *
 * **Scopes narrow.** A project-scope role attached to the target project *overrides* the
 * workspace roles for that project — it is a per-project override on the project Members
 * screen, not an addition — so a role that removes a capability actually removes it. Instance
 * roles always apply.
 *
 * **Tiers clamp.** Each grant's capabilities are expanded through `expandCapabilities` with
 * `tier: roleScopeTier(grant.scope)` — a workspace-, project- or organisation-scope grant
 * therefore expands to no `instance:*` capability whatever strings its row contains, no matter
 * how the caller names the scope (finding 6). This runs here, unconditionally, so it protects
 * a row no grant-time check ever saw.
 */
export function authorityFor(
  identity: Pick<ResolvedIdentity, "authority">,
  scope: Scope,
  target: ScopeTarget,
  options: {
    onUnknown?: UnknownCapabilityHandler;
    onRefused?: RefusedCapabilityHandler;
  } = {},
): Set<Capability> {
  const applicable = identity.authority.filter((grant) =>
    grantAppliesTo(grant, scope, target),
  );

  const projectOverrides = applicable.filter(
    (grant) => grant.scope === "project",
  );
  const selected =
    projectOverrides.length > 0
      ? applicable.filter(
          (grant) => grant.scope === "instance" || grant.scope === "project",
        )
      : applicable;

  const held = new Set<Capability>();
  for (const grant of selected) {
    for (const capability of expandCapabilities(grant.capabilities, {
      tier: roleScopeTier(grant.scope),
      onUnknown: options.onUnknown,
      onRefused: options.onRefused,
      roleKey: grant.roleKey,
      source: "role",
    })) {
      held.add(capability);
    }
  }
  return held;
}

/**
 * Does this identity hold `capability` for a policy declaring `scope`, against `target`?
 *
 * `can(identity, 'work_item:assign', 'project', { projectId })`. Authority only — this
 * function does not know what reach is, and it never will.
 */
export function can(
  identity: Pick<ResolvedIdentity, "authority" | "keyCapabilities">,
  capability: Capability,
  scope: Scope,
  target: ScopeTarget,
  options: {
    onUnknown?: UnknownCapabilityHandler;
    onRefused?: RefusedCapabilityHandler;
  } = {},
): boolean {
  if (!authorityFor(identity, scope, target, options).has(capability)) {
    return false;
  }

  // A request carrying an API key is additionally clamped to the key's frozen subset:
  // effective authority is owner RBAC ∩ key capability subset (rbac.md § MCP).
  if (identity.keyCapabilities !== undefined) {
    const keyHeld = expandCapabilities(identity.keyCapabilities, {
      onUnknown: options.onUnknown,
      source: "api_key",
    });
    if (!keyHeld.has(capability)) return false;
  }

  return true;
}

/* ------------------------------------------------------------------ *
 * Reach
 * ------------------------------------------------------------------ */

/**
 * What a reach check needs to know about the resource. Assembled by the repository layer; the
 * evaluator never loads anything.
 */
export type ProjectReachFacts = {
  readonly projectId: string;
  readonly workspaceId: string;
  /** The customer organisation this project belongs to; `null` for an internal project. */
  readonly organisationId: string | null;
  /** Ancestors, nearest first — reach step 4, hierarchy inheritance. */
  readonly ancestorProjectIds?: readonly string[];
  /** `project.owner_team_id` — reach step 5. Grants reach only, never authority. */
  readonly ownerTeamId?: string | null;
  /**
   * A `private` work item or submission is in reach only for its requester and participants,
   * even inside the right organisation (`CP-16`).
   */
  readonly visibleToPersonIds?: readonly string[] | null;
};

/**
 * May this identity see this project (and what hangs off it)?
 *
 * The resolution order in rbac.md § Reach. Steps 1 and 2 — `instance:admin` and an explicit
 * `sees_all` grant — are already resolved into `identity.reach.kind === 'all'` by
 * `resolveIdentity`, which is why this function needs no capability lookup at all.
 *
 * A `false` answer is a **404**, never a 403: returning 403 would confirm the record exists.
 */
export function reaches(
  identity: Pick<
    ResolvedIdentity,
    "personId" | "reach" | "memberships" | "teamIds"
  >,
  project: ProjectReachFacts,
): boolean {
  if (
    project.visibleToPersonIds != null &&
    !project.visibleToPersonIds.includes(identity.personId)
  ) {
    return false;
  }

  switch (identity.reach.kind) {
    // 1. instance:admin, or 2. an explicit sees_all grant.
    case "all":
      return true;

    // 6. A customer whose organisation is the project's customer. And never anything else.
    case "organisation":
      return (
        project.organisationId !== null &&
        identity.reach.ids.includes(project.organisationId)
      );

    case "membership": {
      // 3. Project membership.
      if (hasMembership(identity.memberships, "project", project.projectId)) {
        return true;
      }
      // 4. Membership of an ancestor project.
      for (const ancestorId of project.ancestorProjectIds ?? []) {
        if (hasMembership(identity.memberships, "project", ancestorId)) {
          return true;
        }
      }
      // 5. Team membership where the team owns the project.
      if (
        project.ownerTeamId != null &&
        identity.teamIds.includes(project.ownerTeamId)
      ) {
        return true;
      }
      // 7. Otherwise no — and the response is 404.
      return false;
    }

    default:
      return false;
  }
}

function hasMembership(
  memberships: readonly Membership[],
  scope: Membership["scope"],
  scopeId: string,
): boolean {
  return memberships.some(
    (membership) =>
      membership.scope === scope && membership.scopeId === scopeId,
  );
}

/* ------------------------------------------------------------------ *
 * Resolved scope — finding 4
 *
 * `evaluatePolicy` selects the authoritative id for a capability policy off the flat
 * `context.target` bag it has always taken (see `requiredIdFor`/`GRANT_SCOPES_FOR` above),
 * which is enough to close a grant of the wrong *kind* satisfying a policy of another kind.
 * It is not enough, alone, to close a policy's own scope id resolving against the WRONG
 * tenant — a `project`-scope policy whose `target.workspaceId` was set from a header rather
 * than from the addressed project's own row. That needs the caller to commit to where each id
 * came from, which is what `ResolvedScope` and `scopeSource` are for.
 *
 * A capability policy may optionally be evaluated against an explicit `ResolvedScope`
 * (`PolicyContext.scope`) instead of leaving the id embedded, unverified, in `context.target`.
 * When one is supplied, `evaluatePolicy` checks that its `kind` matches `policy.scope` and
 * that its source (row/request — a **distinct** branded type per source, not one brand plus a
 * string field) matches `policy.scopeSource`, refusing a mismatch with its own code before
 * authority is ever considered.
 *
 * This is thinner than it looks, on purpose — see the caveat below the constructors.
 * ------------------------------------------------------------------ */

const ROW_SCOPE = Symbol("taskdesk.permissions.RowScope");
const REQUEST_SCOPE = Symbol("taskdesk.permissions.RequestScope");

type RowBrand = { readonly [ROW_SCOPE]: true };
type RequestBrand = { readonly [REQUEST_SCOPE]: true };

type InstanceScopeFacts = { readonly kind: "instance" };
type OrganisationScopeFacts = {
  readonly kind: "organisation";
  readonly organisationId: string;
};
type WorkspaceScopeFacts = {
  readonly kind: "workspace";
  readonly workspaceId: string;
};
type ProjectScopeFacts = {
  readonly kind: "project";
  readonly projectId: string;
  /** The project's **own** `workspace_id` column — read in the same query as `projectId`. */
  readonly workspaceId: string;
};
type WorkItemScopeFacts = {
  readonly kind: "work_item";
  readonly workItemId: string;
  /** The work item's **own** `project_id` column. */
  readonly projectId: string;
  /** The work item's project's **own** `workspace_id` column. */
  readonly workspaceId: string;
};

type ScopeFacts =
  | InstanceScopeFacts
  | OrganisationScopeFacts
  | WorkspaceScopeFacts
  | ProjectScopeFacts
  | WorkItemScopeFacts;

export type RowScope = ScopeFacts & RowBrand;
export type RequestScope = ScopeFacts & RequestBrand;

/**
 * A scope resolved by one of this module's constructors, carrying its own containment chain
 * and which of the two legitimate sources it came from.
 *
 * **This is not, and is not claimed to be, unrepresentable-by-construction protection against
 * a caller who lies about where a value came from.** The registry's call site is
 * `evaluatePolicy(entry.policy, ctx)` where `RegistryEntry.policy: Policy` — the narrowing to a
 * specific policy shape is erased there, so `tsc` catches only a hand-written policy literal,
 * never a value built at runtime from a header. And nothing stops
 * `workspaceScopeFromRow({ workspaceId: c.req.header("X-Workspace-Id") })` from typechecking —
 * the brand only proves the value went through *a* constructor, not that the constructor's
 * name matches what was actually passed in. The real defence is the **runtime** check below
 * (`isResolvedScope`, and `evaluatePolicy`'s source comparison): a hand-built, JSON-round-tripped
 * or object-spread copy loses the brand and is refused, and a caller who honestly used the
 * wrong constructor family for a route's declared `scopeSource` is refused too. What is not
 * caught is a caller who deliberately mislabels the call — that is a code-review question
 * (`fromRow` beside a header read is a lie a reviewer can see), not one this type system
 * answers.
 */
export type ResolvedScope = RowScope | RequestScope;

export class ScopeResolutionError extends Error {}

function requireId(value: string, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ScopeResolutionError(
      `${field} must be a non-empty id — an unresolved scope is a denial, not a wildcard`,
    );
  }
  return value;
}

function brandRow<T extends ScopeFacts>(facts: T): T & RowBrand {
  Object.defineProperty(facts, ROW_SCOPE, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(facts) as T & RowBrand;
}

function brandRequest<T extends ScopeFacts>(facts: T): T & RequestBrand {
  Object.defineProperty(facts, REQUEST_SCOPE, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(facts) as T & RequestBrand;
}

export function instanceScopeFromRow(): RowScope {
  return brandRow({ kind: "instance" });
}
export function instanceScopeFromRequest(): RequestScope {
  return brandRequest({ kind: "instance" });
}

export function organisationScopeFromRow(facts: {
  organisationId: string;
}): RowScope {
  return brandRow({
    kind: "organisation",
    organisationId: requireId(facts.organisationId, "organisationId"),
  });
}
export function organisationScopeFromRequest(facts: {
  organisationId: string;
}): RequestScope {
  return brandRequest({
    kind: "organisation",
    organisationId: requireId(facts.organisationId, "organisationId"),
  });
}

export function workspaceScopeFromRow(facts: {
  workspaceId: string;
}): RowScope {
  return brandRow({
    kind: "workspace",
    workspaceId: requireId(facts.workspaceId, "workspaceId"),
  });
}
export function workspaceScopeFromRequest(facts: {
  workspaceId: string;
}): RequestScope {
  return brandRequest({
    kind: "workspace",
    workspaceId: requireId(facts.workspaceId, "workspaceId"),
  });
}

export function projectScopeFromRow(facts: {
  projectId: string;
  workspaceId: string;
}): RowScope {
  return brandRow({
    kind: "project",
    projectId: requireId(facts.projectId, "projectId"),
    workspaceId: requireId(facts.workspaceId, "workspaceId"),
  });
}
export function projectScopeFromRequest(facts: {
  projectId: string;
  workspaceId: string;
}): RequestScope {
  return brandRequest({
    kind: "project",
    projectId: requireId(facts.projectId, "projectId"),
    workspaceId: requireId(facts.workspaceId, "workspaceId"),
  });
}

export function workItemScopeFromRow(facts: {
  workItemId: string;
  projectId: string;
  workspaceId: string;
}): RowScope {
  return brandRow({
    kind: "work_item",
    workItemId: requireId(facts.workItemId, "workItemId"),
    projectId: requireId(facts.projectId, "projectId"),
    workspaceId: requireId(facts.workspaceId, "workspaceId"),
  });
}
export function workItemScopeFromRequest(facts: {
  workItemId: string;
  projectId: string;
  workspaceId: string;
}): RequestScope {
  return brandRequest({
    kind: "work_item",
    workItemId: requireId(facts.workItemId, "workItemId"),
    projectId: requireId(facts.projectId, "projectId"),
    workspaceId: requireId(facts.workspaceId, "workspaceId"),
  });
}

/** The source brand `scope` carries, or `undefined` for anything that did not come from one of
 *  the constructors above — a plain object literal, a `JSON.parse` round trip, or an
 *  object-spread copy, all of which drop the non-enumerable brand property. */
function scopeSourceOf(scope: unknown): ScopeSource | undefined {
  if (typeof scope !== "object" || scope === null) return undefined;
  if (ROW_SCOPE in scope) return "row";
  if (REQUEST_SCOPE in scope) return "request";
  return undefined;
}

/** True for a value produced by one of this module's scope constructors — never for a hand-built
 *  object of the same shape, even one that matches `ResolvedScope`'s fields exactly. */
export function isResolvedScope(value: unknown): value is ResolvedScope {
  return scopeSourceOf(value) !== undefined;
}

/** `ResolvedScope` flattened to the bag shape `grantAppliesTo` already knows how to read. The
 *  work item's own project id lands in `workItemProjectId`, matching `ScopeTarget`'s existing
 *  field for exactly this fact. */
function flattenResolvedScope(scope: ResolvedScope): ScopeTarget {
  switch (scope.kind) {
    case "instance":
      return { instance: true };
    case "organisation":
      return { organisationId: scope.organisationId };
    case "workspace":
      return { workspaceId: scope.workspaceId };
    case "project":
      return { projectId: scope.projectId, workspaceId: scope.workspaceId };
    case "work_item":
      return {
        workItemId: scope.workItemId,
        workItemProjectId: scope.projectId,
        workspaceId: scope.workspaceId,
      };
  }
}

/* ------------------------------------------------------------------ *
 * Route policy evaluation
 * ------------------------------------------------------------------ */

export type PolicyDecision =
  | { readonly allowed: true; readonly requiresElevation: boolean }
  | {
      readonly allowed: false;
      /**
       * `500` is not an authorization answer: it is the evaluator refusing to answer at all
       * because the caller did not supply a well-formed value for a security-relevant fact the
       * route's policy requires. It is never a `403` (we do not know the caller lacks
       * authority) and never a `404` (we do not know the row is out of reach — and a `404`
       * here would hide a broken middleware among ordinary not-founds for as long as it took
       * someone to notice).
       */
      readonly status: 401 | 403 | 404 | 500;
      readonly code: string;
      readonly reason: string;
      readonly missingCapability?: Capability;
      /** Set only with `code: "policy_context_incomplete"` — for the log, not for the wire. */
      readonly missingContext?: readonly string[];
    };

/**
 * The declared "this route addresses no single resource" answer, spelled explicitly rather
 * than implied by omitting `inReach`. Pass this — never `undefined` — when the policy's
 * `reach` names the `no_single_resource` exemption.
 */
export const NO_SINGLE_RESOURCE = { noSingleResource: true } as const;
export type NoSingleResource = typeof NO_SINGLE_RESOURCE;

/**
 * The declared "this route names no person parameter" answer, spelled explicitly rather than
 * implied by omitting `targetPersonId`. Pass this — never `undefined` — when the policy's
 * `personParam` names the `no_person_parameter` exemption.
 */
export const NO_PERSON_PARAMETER = { noPersonParameter: true } as const;
export type NoPersonParameter = typeof NO_PERSON_PARAMETER;

/**
 * What the middleware knows by the time the policy runs.
 *
 * `inReach`, `targetPersonId` and `portalPredicateSatisfied` stay optional in the type — this
 * package cannot force every caller to be rewritten in the same change (`tests/permissions/
 * matrix-fixture.ts` builds one shape for every policy kind) — but `evaluatePolicy` never
 * again treats an absent or malformed value as permission: absence is a denial, enforced at
 * runtime as defence in depth for exactly the case the type system cannot reach, a policy map
 * or a context object assembled from JSON, a plugin, or a `try`/`catch` that left a field
 * unset (defect 5).
 */
export type PolicyContext = {
  readonly identity: ResolvedIdentity | null;
  readonly target: ScopeTarget;
  /**
   * A capability policy's scope, resolved through one of this module's constructors
   * (`workspaceScopeFromRow`, `projectScopeFromRequest`, …) rather than left as loose ids in
   * `target`. Optional, for the same reason every field below is: this package cannot force
   * every caller to be rewritten in the same change, and `tests/permissions/matrix-fixture.ts`
   * still builds one flat `target` bag for every policy kind. When it **is** supplied,
   * `evaluatePolicy` demands it match the policy's declared `scope` and `scopeSource` and
   * refuses rather than guesses on a mismatch (finding 4). When it is not, `evaluatePolicy`
   * falls back to selecting the id straight off `target` — still gated by the containment
   * table in `evaluator.ts`'s `GRANT_SCOPES_FOR`, but without the cross-tenant ancestor check a
   * `ResolvedScope`'s own row-sourced fields carry.
   */
  readonly scope?: ResolvedScope;
  /**
   * The answer from `reaches` for the resource this route addresses, or the explicit
   * `NO_SINGLE_RESOURCE` marker when the policy's `reach` says none applies. There is no
   * third, implicit answer: an omitted or malformed value is refused, never allowed, whenever
   * the policy declares `reach: "required"`.
   */
  readonly inReach?: boolean | NoSingleResource;
  /** Facts about the loaded row, for an `orOwner` branch. */
  readonly row?: {
    readonly personId?: string | null;
    readonly createdBy?: string | null;
    readonly requesterId?: string | null;
    readonly createdAt?: Date;
  };
  /** Facts about the parsed body, for an `orSelfTarget` branch. */
  readonly body?: { readonly assigneeId?: string | null };
  /**
   * For a kind-2 policy: the person named by a path or query parameter, or the explicit
   * `NO_PERSON_PARAMETER` marker when the policy's `personParam` says none applies.
   */
  readonly targetPersonId?: string | NoPersonParameter | null;
  /** For a kind-3 policy: whether the portal predicate scoped the query to this caller. A
   *  portal policy names a predicate in every case, so there is no "not applicable" to
   *  declare — an omitted or non-boolean value is refused, never allowed. */
  readonly portalPredicateSatisfied?: boolean;
  /** Now, for an `orOwner` `withinMinutes` window. */
  readonly now?: Date;
  readonly onUnknownCapability?: UnknownCapabilityHandler;
  /** See `RefusedCapabilityHandler` — a stored capability the container's tier refused. */
  readonly onRefusedCapability?: RefusedCapabilityHandler;
};

const DENY_CONTEXT_INCOMPLETE = (
  missing: string,
  reason: string,
): PolicyDecision => ({
  allowed: false,
  status: 500,
  code: "policy_context_incomplete",
  reason,
  missingContext: [missing],
});

const DENY_UNAUTHENTICATED = {
  allowed: false,
  status: 401,
  code: "unauthenticated",
  reason: "No authenticated session",
} as const;

/**
 * A declared flag that cannot be true of the kind that declares it.
 *
 * `PublicElevationFlags` already makes these unrepresentable on a well-typed `Policy` literal,
 * and `validatePolicy` refuses them again at boot. This is the third layer, and the only one
 * still standing when the policy map came from JSON, a plugin, or a downstream consumer that
 * never met the type checker: an incoherent declaration **denies**. It never falls through to
 * the kind's happy path.
 *
 * Returns the reason, or `null` when the declaration is coherent.
 */
function incoherentFlagReason(policy: Policy): string | null {
  if (!isPublicPolicy(policy)) return null;
  // Read through an untyped view deliberately: this check exists precisely for the policy
  // object whose `sessionOnly` and `elevated` were never checked by the compiler.
  const flags = policy as {
    readonly sessionOnly?: unknown;
    readonly elevated?: unknown;
  };
  if (flags.sessionOnly === true) {
    return "A public route cannot be session-only: kind 4 accepts a request with no credential at all, so there is no session to require";
  }
  if (flags.elevated === true) {
    return "A public route cannot be elevated: elevation is a fresh authentication of the caller, and kind 4 has no caller";
  }
  return null;
}

/**
 * Evaluate one route policy.
 *
 * The credential check runs **before** the policy: a `sessionOnly` route refuses an API key,
 * an MCP key or an impersonation session with `403 session_required`, so it never reaches the
 * pending-action layer at all.
 *
 * And it runs before **every** kind. No kind returns a successful decision before its declared
 * `sessionOnly` and `elevated` have been enforced — there is no policy kind on which declared
 * security metadata is silently inert (defect 3). Nor does any kind return a successful
 * decision before every security-relevant context field its policy requires has been supplied
 * as a well-formed value — an absent or malformed one is a denial, never an implicit allow
 * (defect 5).
 */
export function evaluatePolicy(
  policy: Policy,
  context: PolicyContext,
): PolicyDecision {
  const { identity } = context;

  /* -- Declared security metadata, enforced before ANY successful decision returns. --
   *
   * This block used to sit below the public/delegated early returns, which made `sessionOnly`
   * and `elevated` inert on exactly the two kinds whose whole purpose is to be an explicitly
   * reviewed exception — while `sessionOnlyRoutes()` listed the route and
   * `renderElevatedActionsMarkdown()` printed it into rbac.md.
   */

  const incoherent = incoherentFlagReason(policy);
  if (incoherent !== null) {
    return {
      allowed: false,
      status: 403,
      code: "policy_incoherent",
      reason: incoherent,
    };
  }

  if (policy.sessionOnly === true) {
    if (identity === null) return DENY_UNAUTHENTICATED;
    if (identity.credential !== "session") {
      return {
        allowed: false,
        status: 403,
        code: "session_required",
        reason: `This route is session-only; the request arrived on a ${identity.credential}`,
      };
    }
  }

  const requiresElevation = policy.elevated === true;

  if (isPublicPolicy(policy)) {
    return { allowed: true, requiresElevation };
  }

  // A delegated mount is allowlisted, not covered: the surface behind it authenticates itself.
  if (isDelegatedPolicy(policy)) {
    return { allowed: true, requiresElevation };
  }

  if (identity === null) return DENY_UNAUTHENTICATED;

  if (isSelfPolicy(policy)) {
    // A self route names the parameter that identifies a person, or states in writing — via
    // the `no_person_parameter` exemption — that it names none. There is no third, implicit
    // declaration: a missing or malformed `personParam` is a policy that never met the
    // registry's validation (a JSON- or plugin-supplied map), and it is refused here too,
    // defence in depth, rather than treated as "no constraint".
    const personParam = policy.personParam as unknown;
    const personExempt =
      typeof personParam === "object" &&
      personParam !== null &&
      (personParam as { exempt?: unknown }).exempt === "no_person_parameter";

    if (typeof personParam === "string") {
      if (typeof context.targetPersonId !== "string") {
        return DENY_CONTEXT_INCOMPLETE(
          "targetPersonId",
          `This route names "${personParam}" as the person parameter, and the context did not supply a target person id`,
        );
      }
      if (context.targetPersonId !== identity.personId) {
        return {
          allowed: false,
          status: 404,
          code: "not_found",
          reason: "A self route may only address the caller's own records",
        };
      }
    } else if (!personExempt) {
      return DENY_CONTEXT_INCOMPLETE(
        "targetPersonId",
        "This self route does not declare personParam — declare the parameter name or the no_person_parameter exemption",
      );
    }
    return { allowed: true, requiresElevation };
  }

  if (isPortalPolicy(policy)) {
    if (identity.portal !== "customer" || identity.side !== "customer") {
      return {
        allowed: false,
        status: 403,
        code: "portal_required",
        reason: "This route requires a customer portal session",
      };
    }
    // A portal policy names a predicate in every case: there is no "not applicable" to
    // declare, so an omitted or non-boolean answer is refused rather than treated as satisfied.
    if (
      context.portalPredicateSatisfied !== true &&
      context.portalPredicateSatisfied !== false
    ) {
      return DENY_CONTEXT_INCOMPLETE(
        "portalPredicateSatisfied",
        `This route scopes by the ${policy.predicate} predicate, and the context did not supply whether it was satisfied`,
      );
    }
    if (context.portalPredicateSatisfied === false) {
      return {
        allowed: false,
        status: 404,
        code: "not_found",
        reason: `Outside the ${policy.predicate} predicate`,
      };
    }
    return { allowed: true, requiresElevation };
  }

  if (!isCapabilityPolicy(policy)) {
    throw new Error(
      "Policy matches none of the five kinds in rbac.md — there is no sixth kind",
    );
  }

  // Reach first: out of reach is 404, and it must not be distinguishable from "no such row".
  //
  // The route's declared `reach` is authoritative, not the request: when it says "required",
  // the context must supply a genuine boolean — `undefined`, `null`, a non-boolean JSON value,
  // or a caller claiming the `NO_SINGLE_RESOURCE` exemption a "required" route did not declare
  // are all refused rather than treated as "in reach". When the route declares the exemption,
  // no reach question exists and the check is skipped regardless of what the context supplies.
  const reach = policy.reach as unknown;
  const reachExempt =
    typeof reach === "object" &&
    reach !== null &&
    (reach as { exempt?: unknown }).exempt === "no_single_resource";

  if (reach === "required") {
    if (context.inReach !== true && context.inReach !== false) {
      return DENY_CONTEXT_INCOMPLETE(
        "inReach",
        'This route declares reach: "required", and the context did not supply a reach answer',
      );
    }
    if (context.inReach === false) {
      return {
        allowed: false,
        status: 404,
        code: "not_found",
        reason: "Out of reach",
      };
    }
  } else if (!reachExempt) {
    // A capability policy that never met the registry's validation (a JSON- or plugin-supplied
    // map) declares no reach requirement at all. Guessing "no reach question" here is exactly
    // the omission this fix exists to refuse, so it is denied rather than allowed through.
    return DENY_CONTEXT_INCOMPLETE(
      "inReach",
      'This route\'s capability policy does not declare reach — declare reach: "required" or the no_single_resource exemption',
    );
  }

  // Selection and containment: which id on the target is authoritative for this policy's
  // declared scope, and — when the context resolved one explicitly — whether that resolved
  // scope actually matches what the policy declared. Finding 4: `policy.scope` used to select
  // nothing, so a grant of any kind satisfied a policy of any other kind as long as some id on
  // the target bag happened to match.
  const scopeResolution = resolveScopeForPolicy(policy, context);
  if (!scopeResolution.ok) return scopeResolution.decision;
  const scopeTarget = scopeResolution.target;

  const options = {
    onUnknown: context.onUnknownCapability,
    onRefused: context.onRefusedCapability,
  };

  if (can(identity, policy.capability, policy.scope, scopeTarget, options)) {
    return { allowed: true, requiresElevation };
  }

  // The owner branch is a conjunction, not a bypass: the caller must hold the branch's own
  // *_own capability AND the named predicate must hold against the loaded row.
  if (
    policy.orOwner !== undefined &&
    ownerPredicateHolds(policy.orOwner.predicate, context, identity.personId)
  ) {
    const withinWindow = isWithinWindow(policy.orOwner.withinMinutes, context);
    if (
      withinWindow &&
      can(
        identity,
        policy.orOwner.capability,
        policy.scope,
        scopeTarget,
        options,
      )
    ) {
      return { allowed: true, requiresElevation };
    }
  }

  // The self-target branch is the same shape over the request body.
  if (
    policy.orSelfTarget !== undefined &&
    context.body?.assigneeId != null &&
    context.body.assigneeId === identity.personId &&
    can(
      identity,
      policy.orSelfTarget.capability,
      policy.scope,
      scopeTarget,
      options,
    )
  ) {
    return { allowed: true, requiresElevation };
  }

  return {
    allowed: false,
    status: 403,
    code: "forbidden",
    reason: `Missing capability ${policy.capability}`,
    missingCapability: policy.capability,
  };
}

type ScopeResolutionResult =
  | { readonly ok: true; readonly target: ScopeTarget }
  | { readonly ok: false; readonly decision: PolicyDecision };

/**
 * Resolve which flat target this capability policy's authority check runs against, and refuse
 * before authority is even considered when the scope is missing, of the wrong kind, or (when
 * the context resolved one explicitly) sourced the way the policy did not declare.
 *
 * Two paths. When `context.scope` is supplied, it must be a value produced by this module's
 * own constructors (never a hand-built or forged one), its `kind` must match `policy.scope`,
 * and its source must match `policy.scopeSource` — a `RequestScope` never satisfies a
 * `scopeSource: "row"` policy, whatever id it names (closes the cross-tenant case a header
 * masquerading as a row-verified id would otherwise reach). When it is not supplied, the check
 * falls back to `context.target` directly — still gated by `GRANT_SCOPES_FOR`'s containment
 * table, but without the source guarantee, exactly as documented on `PolicyContext.scope`.
 */
function resolveScopeForPolicy(
  policy: CapabilityPolicy,
  context: PolicyContext,
): ScopeResolutionResult {
  if (context.scope !== undefined) {
    if (!isResolvedScope(context.scope)) {
      return {
        ok: false,
        decision: DENY_CONTEXT_INCOMPLETE(
          "scope",
          "context.scope was supplied but is not a value produced by this package's scope constructors — a hand-built, JSON-round-tripped or object-spread copy loses its brand and is refused rather than trusted",
        ),
      };
    }
    if (context.scope.kind !== policy.scope) {
      return {
        ok: false,
        decision: {
          allowed: false,
          status: 403,
          code: "scope_mismatch",
          reason: `This route's policy declares scope "${policy.scope}", and the resolved scope was "${context.scope.kind}"`,
        },
      };
    }
    const source = scopeSourceOf(context.scope);
    if (source !== policy.scopeSource) {
      return {
        ok: false,
        decision: {
          allowed: false,
          status: 403,
          code: "scope_source_mismatch",
          reason: `This route's policy declares scopeSource "${policy.scopeSource}", and the resolved scope came from "${String(source)}"`,
        },
      };
    }
    return { ok: true, target: flattenResolvedScope(context.scope) };
  }

  if (scopeIdFor(policy.scope, context.target) === undefined) {
    return {
      ok: false,
      decision: DENY_CONTEXT_INCOMPLETE(
        "scope",
        `This route's capability policy declares scope "${policy.scope}", and the context did not supply a value for it`,
      ),
    };
  }
  return { ok: true, target: context.target };
}

function ownerPredicateHolds(
  predicate: string,
  context: PolicyContext,
  personId: string,
): boolean {
  switch (predicate) {
    case "row.person_id === identity.personId":
      return context.row?.personId != null && context.row.personId === personId;
    case "row.created_by === identity.personId":
      return (
        context.row?.createdBy != null && context.row.createdBy === personId
      );
    case "row.requester_id === identity.personId":
      return (
        context.row?.requesterId != null && context.row.requesterId === personId
      );
    default:
      return false;
  }
}

function isWithinWindow(
  withinMinutes: number | undefined,
  context: PolicyContext,
): boolean {
  if (withinMinutes === undefined) return true;
  const createdAt = context.row?.createdAt;
  if (createdAt === undefined) return false;
  const now = context.now ?? new Date();
  return now.getTime() - createdAt.getTime() <= withinMinutes * 60_000;
}

/** The scope a capability policy is evaluated against — the route's declared scope source. */
export function scopeIdFor(
  scope: Scope,
  target: ScopeTarget,
): string | undefined {
  switch (scope) {
    case "instance":
      return target.instance === true ? "instance" : undefined;
    case "organisation":
      return target.organisationId;
    case "workspace":
      return target.workspaceId;
    case "project":
      return target.projectId;
    case "work_item":
      return target.workItemId;
    default:
      return undefined;
  }
}
