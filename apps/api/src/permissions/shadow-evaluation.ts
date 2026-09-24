/**
 * Issue #8, Slice 2 — pure shadow-mode comparison logic.
 *
 * Everything in this file is pure: no I/O, no database, no Hono `Context`. It takes
 * already-resolved facts (the registry entry, the already-resolved identity, whatever row
 * scope the existing middleware already exposed, and the legacy outcome the shadow
 * middleware observed) and answers two questions: (1) do we have enough evidence to call
 * `evaluatePolicy` honestly at all, and if not, why not; (2) given both sides' answers, what
 * outcome category does the addendum's vocabulary assign. `shadow-middleware.ts` is the only
 * caller, and it is the one place that does I/O (`resolveIdentity`, the Hono context, the
 * evidence store).
 *
 * Exhaustively unit-tested in `tests/api/permissions-shadow-evaluation.test.ts` — every
 * branch here is reachable with a plain object, no database.
 */

import type {
  CredentialKind,
  RegistryEntry,
  ResolvedIdentity,
} from "@taskdesk/permissions";
import {
  instanceScope,
  isCapabilityPolicy,
  NO_PERSON_PARAMETER,
  NO_SINGLE_RESOURCE,
  type PolicyContext,
  type PolicyDecision,
  projectScopeFromRequest,
  projectScopeFromRow,
  type ResolvedScope,
  workItemScopeFromRequest,
  workItemScopeFromRow,
  workspaceScopeFromRequest,
  workspaceScopeFromRow,
} from "@taskdesk/permissions";
import type { ShadowOutcome } from "./shadow-schema";

/** What the shadow middleware observed about the hand-written path, after `next()` settled. */
export type LegacyOutcome =
  | { readonly known: true; readonly allowed: boolean; readonly status: number }
  /**
   * `next()` threw something other than an `HTTPException` — an application bug unrelated
   * to authorization. The shadow comparison cannot honestly call this "allowed" or "denied",
   * so it is folded into `unevaluated` rather than guessed at either way. The original error
   * is rethrown by the middleware unchanged; this file never sees or touches it.
   */
  | { readonly known: false };

/**
 * Every reason Slice 2 can fail to construct a full `PolicyContext` and so cannot honestly
 * call `evaluatePolicy` at all. Each is a **known, disclosed** gap, not a guess — see
 * `docs/01-architecture/rbac.md` and issue #8's own comments for the ones inherited from
 * #315 (`missing_identity` covers S7's post-boot-signup case) and #8's slicing plan
 * (`row_scope_unavailable` covers "RowScope only from rows the existing middleware already
 * loaded" — a project/work-item/organisation-scope policy has no such row today).
 */
export const UNEVALUATED_REASON_CODES = [
  "no_policy_registered",
  "missing_identity",
  "row_scope_unavailable",
  "self_target_unavailable",
  "portal_predicate_unavailable",
  "legacy_outcome_unknown",
  "reach_unavailable",
  /**
   * The shadow's OWN construction produced a scope whose provenance the policy does not
   * declare (`scope_mismatch`/`scope_source_mismatch` from the evaluator) — a Slice 2
   * artifact, never a disagreement, so it is filed `unevaluated` rather than counted
   * against either side (#323 Opus S1).
   */
  "scope_source_unavailable",
  /** The handler owns authorization, so its result is not comparable to a declarative allow. */
  "delegated_to_handler",
] as const;

export type UnevaluatedReasonCode = (typeof UNEVALUATED_REASON_CODES)[number];

/** What Slice 2 could determine about the declarative side of this request. */
export type ShadowPolicySide =
  | {
      readonly evaluated: true;
      readonly errored: false;
      readonly decision: PolicyDecision;
    }
  | {
      readonly evaluated: false;
      readonly errored: false;
      readonly reasonCode: UnevaluatedReasonCode;
    }
  /** The evaluator itself threw. Caught by the middleware; never lets the request fail. */
  | {
      readonly evaluated: false;
      readonly errored: true;
      readonly message: string;
    };

export type ShadowComparisonInput = {
  readonly routeKey: string;
  readonly routerGroup: string;
  readonly policyKind: string | null;
  readonly policyCapability: string | null;
  readonly identityKind: CredentialKind | null;
  readonly workspaceId: string | null;
  readonly traceId: string | null;
  readonly legacy: LegacyOutcome;
  readonly policy: ShadowPolicySide;
};

export type ShadowComparisonResult = {
  readonly outcome: ShadowOutcome;
  /** Non-null on every outcome except `agree`, always present for `unevaluated`. */
  readonly reasonCode: string | null;
};

/**
 * Given an already-resolved identity and whatever `RowScope` the existing middleware
 * already exposed, decide whether Slice 2 can honestly build a full `PolicyContext` for
 * this `RegistryEntry` — and if it can, build it. Never does I/O and never guesses at a
 * value the caller did not supply: absence is `evaluated: false`, with a specific reason,
 * exactly the way `evaluatePolicy` itself treats an absent security-relevant field.
 */
export function buildShadowPolicySide(args: {
  readonly entry: RegistryEntry | undefined;
  readonly identity: ResolvedIdentity | null;
  readonly workspaceId: string | null;
  /** Provenance from the middleware that supplied workspaceId; never inferred here. */
  readonly workspaceIdSource: "row" | "request" | null;
  /** Project id read from a resolved project row by existing middleware. */
  readonly projectId?: string | null;
  /** Project id taken from a route parameter before its lookup. Kept separate from the
   *  workspace id's provenance: a project can be request-scoped while its workspace is
   *  derived from the confirmed project row. */
  readonly projectIdFromRequest?: string | null;
  /** Set only on routes whose existing middleware already resolved a work-item row (today:
   *  `requireWorkItemReach`). See `require-work-item-reach.ts`. */
  readonly workItemId?: string | null;
}):
  | { readonly context: PolicyContext; readonly entry: RegistryEntry }
  | UnevaluatedReasonCode {
  const {
    entry,
    identity,
    workspaceId,
    workspaceIdSource,
    projectId = null,
    projectIdFromRequest = null,
    workItemId = null,
  } = args;

  if (entry === undefined) {
    return "no_policy_registered";
  }

  const { policy } = entry;

  // public/delegated need no identity and no scope — evaluatePolicy itself never consults
  // either for these two kinds (see evaluator.ts's early returns). `entry.kind` is the
  // registry's own discriminant (`RegistryEntry.kind`) — `Policy` itself is a structural
  // union with no shared `kind` field, so this reads the registry's classification rather
  // than re-deriving it.
  if (entry.kind === "delegated") {
    return "delegated_to_handler";
  }

  if (entry.kind === "public") {
    return {
      entry,
      context: { identity, target: {} },
    };
  }

  // Every other kind requires a resolved identity (evaluatePolicy denies 401 without one,
  // and the S7 "signed up after boot" gap is exactly this: resolveIdentity returning null
  // for a real, active user because the person backfill only ran at boot).
  if (identity === null) {
    return "missing_identity";
  }

  if (entry.kind === "self") {
    // An explicit no-parameter declaration is sufficient to use the evaluator's sentinel.
    // Named person parameters remain unevaluated until a route-specific mapping supplies
    // the actual path/query value; this global middleware does not guess.
    if (
      "personParam" in policy &&
      typeof policy.personParam === "object" &&
      policy.personParam !== null &&
      "exempt" in policy.personParam &&
      policy.personParam.exempt === "no_person_parameter"
    ) {
      return {
        entry,
        context: { identity, target: {}, targetPersonId: NO_PERSON_PARAMETER },
      };
    }
    return "self_target_unavailable";
  }

  if (entry.kind === "portal") {
    return "portal_predicate_unavailable";
  }

  if (!isCapabilityPolicy(policy)) {
    return "row_scope_unavailable";
  }

  // Capability policy: needs a ResolvedScope of the exact kind AND provenance the policy
  // declares. The provenance branch is #323 Opus S1's blocking fix: 16 registry entries
  // declare `scope: "workspace", scopeSource: "request"` (capabilities, members, roles,
  // invitations, labels, search, project list/create/reorder) — their workspace id comes
  // from `fromQuery`/`fromBody`/`fromParam`, already membership-checked by
  // `validateWorkspaceAccess`, but it is NOT a loaded row. Labeling it `row` made the
  // evaluator refuse at the source check (`scope_source_mismatch`) before ever looking at
  // the capability, and every allowed request on those routes was then filed as a false
  // `legacy_allow_policy_deny` — no capability comparison ran at all. `request`-sourced
  // Workspace, project, and work-item scope IDs each retain their own provenance. A
  // request-scoped project may coexist with a workspace ID derived from the confirmed
  // project row; comparing workspaceIdSource to the policy would reject that valid shape.
  // `workspace-access-middleware.ts` exposes workspace provenance, the project request
  // ID, and any project row ID separately, while `require-work-item-reach.ts` supplies
  // row-derived work-item facts.
  let scope: ResolvedScope;
  let scopeIdSource: "row" | "request" | "instance" | null = null;
  if (policy.scope === "instance") {
    scope = instanceScope();
    scopeIdSource = "instance";
  } else if (policy.scope === "workspace") {
    if (workspaceId === null || workspaceId === "") {
      return "row_scope_unavailable";
    }
    scopeIdSource = workspaceIdSource;
    scope =
      policy.scopeSource === "request"
        ? workspaceScopeFromRequest({ workspaceId })
        : workspaceScopeFromRow({ workspaceId });
  } else if (policy.scope === "project") {
    const resolvedProjectId =
      policy.scopeSource === "request" ? projectIdFromRequest : projectId;
    if (!resolvedProjectId || !workspaceId) {
      return "row_scope_unavailable";
    }
    scopeIdSource = policy.scopeSource;
    scope =
      policy.scopeSource === "request"
        ? projectScopeFromRequest({
            projectId: resolvedProjectId,
            workspaceId,
          })
        : projectScopeFromRow({
            projectId: resolvedProjectId,
            workspaceId,
          });
  } else if (policy.scope === "work_item") {
    if (!workItemId || !projectId || !workspaceId) {
      return "row_scope_unavailable";
    }
    scopeIdSource = "row";
    scope =
      policy.scopeSource === "request"
        ? workItemScopeFromRequest({ workItemId, projectId, workspaceId })
        : workItemScopeFromRow({ workItemId, projectId, workspaceId });
  } else {
    return "row_scope_unavailable";
  }

  if (
    policy.scope !== "instance" &&
    (scopeIdSource === null || scopeIdSource !== policy.scopeSource)
  ) {
    return "scope_source_unavailable";
  }

  // `reach: "required"` makes `context.inReach` mandatory — `evaluatePolicy` denies
  // (`policy_context_incomplete`) rather than guess when it is absent (defect 5). Slice 2
  // can only answer this honestly for `workspace` scope, from data already inside the
  // resolved `identity` (no extra I/O) — see `workspaceInReach` below. `project`/`work_item`
  // reach needs ancestor-project and team-ownership facts (`reaches()`,
  // `packages/permissions/src/evaluator.ts`) that no file this slice may touch loads, so
  // those are disclosed as `reach_unavailable` rather than guessed at.
  const reach = policy.reach;
  const reachExempt =
    typeof reach === "object" &&
    reach !== null &&
    reach.exempt === "no_single_resource";

  let inReach: PolicyContext["inReach"];
  if (reachExempt) {
    inReach = NO_SINGLE_RESOURCE;
  } else if (reach === "required") {
    if (policy.scope === "workspace") {
      inReach = workspaceInReach(identity, workspaceId as string);
    } else if (identity.reach.kind === "all") {
      // Instance-wide reach is sufficient for any concrete scope and needs no
      // project hierarchy or team-owner facts. Other non-workspace cases remain
      // unevaluated until their full reach facts can be loaded safely.
      inReach = true;
    } else {
      return "reach_unavailable";
    }
  }

  return {
    entry,
    context: { identity, target: {}, scope, inReach },
  };
}

/**
 * Whether `identity` reaches `workspaceId` — computed purely from the already-resolved
 * `ResolvedIdentity` (its `reach` and `memberships`), no extra I/O. Mirrors the same three
 * cases `reaches()` (`packages/permissions/src/evaluator.ts`) applies for project reach:
 * `"all"` (instance:admin or an explicit sees_all grant) always reaches; a customer's
 * organisation-scoped reach never reaches a workspace (workspaces are a staff/agent-side
 * concept); otherwise, reach is exactly workspace membership.
 */
function workspaceInReach(
  identity: ResolvedIdentity,
  workspaceId: string,
): boolean {
  if (identity.reach.kind === "all") {
    return true;
  }
  if (identity.reach.kind === "organisation") {
    return false;
  }
  return identity.memberships.some(
    (membership) =>
      membership.scope === "workspace" && membership.scopeId === workspaceId,
  );
}

/**
 * The addendum's own outcome vocabulary, applied. `evaluator_error` and `unevaluated` never
 * consult `legacy` at all — an evaluator exception or a missing-evidence gap is what it is
 * regardless of what the hand-written path did, and the addendum's coverage rule ("never
 * silently skipped") is why every one of these still gets counted rather than dropped.
 */
export function compareShadowOutcome(
  input: ShadowComparisonInput,
): ShadowComparisonResult {
  if (input.policy.errored) {
    return { outcome: "evaluator_error", reasonCode: "evaluator_threw" };
  }

  if (!input.policy.evaluated) {
    return { outcome: "unevaluated", reasonCode: input.policy.reasonCode };
  }

  if (!input.legacy.known) {
    return { outcome: "unevaluated", reasonCode: "legacy_outcome_unknown" };
  }

  // #323 Opus S1 (defence in depth): `scope_mismatch`/`scope_source_mismatch` mean the
  // SHADOW built a scope whose kind/provenance the policy does not declare — a Slice 2
  // construction artifact, never a legacy-vs-policy disagreement. Filing one as
  // `legacy_allow_policy_deny` would put a real disagreement and a shadow bug in the same
  // bucket, and "zero unexplained disagreements" could then wave the real one through.
  // `buildShadowPolicySide` no longer produces this shape (it branches on scopeSource),
  // so reaching this line is a bug — disclosed as `unevaluated`, not counted either way.
  if (input.policy.evaluated && input.policy.decision.allowed === false) {
    const artifactCode = input.policy.decision.code;
    if (
      artifactCode === "scope_mismatch" ||
      artifactCode === "scope_source_mismatch"
    ) {
      return { outcome: "unevaluated", reasonCode: "scope_source_unavailable" };
    }
  }

  const legacyAllowed = input.legacy.allowed;
  const policyAllowed = input.policy.decision.allowed;

  if (legacyAllowed === policyAllowed) {
    return { outcome: "agree", reasonCode: null };
  }

  if (legacyAllowed && !policyAllowed) {
    const denial = input.policy.decision as Extract<
      PolicyDecision,
      { allowed: false }
    >;
    return {
      outcome: "legacy_allow_policy_deny",
      reasonCode: denial.code,
    };
  }

  // legacy denied, policy allowed.
  return { outcome: "legacy_deny_policy_allow", reasonCode: null };
}
