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
  capabilitiesInGroup,
  isCapability,
} from "./capabilities";
import type {
  Membership,
  ResolvedIdentity,
  RoleGrant,
  ScopeTarget,
  UnknownCapabilityHandler,
} from "./identity";
import {
  isCapabilityPolicy,
  isDelegatedPolicy,
  isPortalPolicy,
  isPublicPolicy,
  isSelfPolicy,
  type Policy,
  type Scope,
} from "./policy";

/* ------------------------------------------------------------------ *
 * Capability expansion
 * ------------------------------------------------------------------ */

/**
 * Expand a stored capability list through its implications, transitively.
 *
 * Implication is expanded **at evaluation time as well as at grant time**, so a role stored
 * without an implied entry still behaves correctly (RL-5). An unrecognised string is reported
 * to `onUnknown` and treated as absent — it is never expanded by a wildcard implication.
 */
export function expandCapabilities(
  stored: readonly string[],
  options: {
    onUnknown?: UnknownCapabilityHandler;
    roleKey?: string;
    source?: "role" | "api_key";
  } = {},
): Set<Capability> {
  const { onUnknown, roleKey, source = "role" } = options;
  const expanded = new Set<Capability>();
  const queue: Capability[] = [];

  for (const name of stored) {
    if (isCapability(name)) {
      queue.push(name);
    } else {
      onUnknown?.(name, { roleKey, source });
    }
  }

  while (queue.length > 0) {
    const capability = queue.pop() as Capability;
    if (expanded.has(capability)) continue;
    expanded.add(capability);

    for (const implied of CAPABILITIES[capability].implies) {
      if (implied === "instance:*") {
        for (const instanceCapability of capabilitiesInGroup("Instance")) {
          if (!expanded.has(instanceCapability)) queue.push(instanceCapability);
        }
        continue;
      }
      if (!expanded.has(implied)) queue.push(implied);
    }
  }

  return expanded;
}

/* ------------------------------------------------------------------ *
 * Authority
 * ------------------------------------------------------------------ */

function grantAppliesTo(grant: RoleGrant, target: ScopeTarget): boolean {
  switch (grant.scope) {
    case "instance":
      return true;
    case "organisation":
      return grant.scopeId !== null && grant.scopeId === target.organisationId;
    case "workspace":
      return grant.scopeId !== null && grant.scopeId === target.workspaceId;
    case "project":
      return grant.scopeId !== null && grant.scopeId === target.projectId;
    default:
      return false;
  }
}

/**
 * The capabilities this identity holds against `target`, implications expanded.
 *
 * **Scopes narrow.** A project-scope role attached to the target project *overrides* the
 * workspace roles for that project — it is a per-project override on the project Members
 * screen, not an addition — so a role that removes a capability actually removes it. Instance
 * roles always apply.
 */
export function authorityFor(
  identity: Pick<ResolvedIdentity, "authority">,
  target: ScopeTarget,
  options: { onUnknown?: UnknownCapabilityHandler } = {},
): Set<Capability> {
  const applicable = identity.authority.filter((grant) =>
    grantAppliesTo(grant, target),
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
      onUnknown: options.onUnknown,
      roleKey: grant.roleKey,
      source: "role",
    })) {
      held.add(capability);
    }
  }
  return held;
}

/**
 * Does this identity hold `capability` against `target`?
 *
 * `can(identity, 'work_item:assign', { projectId })`. Authority only — this function does not
 * know what reach is, and it never will.
 */
export function can(
  identity: Pick<ResolvedIdentity, "authority" | "keyCapabilities">,
  capability: Capability,
  target: ScopeTarget,
  options: { onUnknown?: UnknownCapabilityHandler } = {},
): boolean {
  if (!authorityFor(identity, target, options).has(capability)) return false;

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

  const options = { onUnknown: context.onUnknownCapability };

  if (can(identity, policy.capability, context.target, options)) {
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
      can(identity, policy.orOwner.capability, context.target, options)
    ) {
      return { allowed: true, requiresElevation };
    }
  }

  // The self-target branch is the same shape over the request body.
  if (
    policy.orSelfTarget !== undefined &&
    context.body?.assigneeId != null &&
    context.body.assigneeId === identity.personId &&
    can(identity, policy.orSelfTarget.capability, context.target, options)
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
