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
  isCapabilityPolicy,
  NO_SINGLE_RESOURCE,
  type PolicyContext,
  type PolicyDecision,
  projectScopeFromRow,
  type ResolvedScope,
  workItemScopeFromRow,
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
  /** Set only on routes whose existing middleware already resolved a project row (today:
   *  `workspaceAccess.fromProject`'s lookup source). See `workspace-access-middleware.ts`. */
  readonly projectId?: string | null;
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
    projectId = null,
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
  if (entry.kind === "public" || entry.kind === "delegated") {
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
    // Slice 2 does not attempt to resolve an arbitrary route's person-identifying path/query
    // parameter generically — that is route-specific knowledge this middleware, mounted
    // once globally, does not have. Disclosed as its own reason code rather than guessed at
    // (a wrong guess here would silently manufacture disagreements that are Slice 2's own
    // fault, not a real legacy-vs-policy gap).
    return "self_target_unavailable";
  }

  if (entry.kind === "portal") {
    return "portal_predicate_unavailable";
  }

  if (!isCapabilityPolicy(policy)) {
    return "row_scope_unavailable";
  }

  // Capability policy: needs a ResolvedScope of the exact kind/source the policy declares.
  // Slice 2 can only build the kinds whose row is already exposed on context by the two
  // files this slice may touch (`workspace-access-middleware.ts`,
  // `require-work-item-reach.ts`) — `workspace` from `c.get("workspaceId")` everywhere those
  // run, and `project`/`work_item` only on the specific routes that also expose
  // `c.get("projectId")`/`c.get("workItemId")`. `organisation`/`instance`-scope policies, and
  // any `project`/`work_item`-scope policy on a route those two files don't cover, have no
  // row on context at all today.
  let scope: ResolvedScope;
  if (policy.scope === "workspace") {
    if (workspaceId === null || workspaceId === "") {
      return "row_scope_unavailable";
    }
    scope = workspaceScopeFromRow({ workspaceId });
  } else if (policy.scope === "project") {
    if (!projectId || !workspaceId) {
      return "row_scope_unavailable";
    }
    scope = projectScopeFromRow({ projectId, workspaceId });
  } else if (policy.scope === "work_item") {
    if (!workItemId || !projectId || !workspaceId) {
      return "row_scope_unavailable";
    }
    scope = workItemScopeFromRow({ workItemId, projectId, workspaceId });
  } else {
    return "row_scope_unavailable";
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
    if (policy.scope !== "workspace") {
      return "reach_unavailable";
    }
    inReach = workspaceInReach(identity, workspaceId as string);
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

/**
 * Whether an HTTP status the shadow middleware observed from the legacy path represents an
 * authorization-shaped denial (401/403), or a reach denial this codebase deliberately masks
 * as a 404 indistinguishable from "genuinely does not exist" (#256, #290, #261 F2 — the
 * whole reason those routes 404 rather than 403 for an out-of-reach row). Any other status —
 * 2xx, a validation 400, or a 500 unrelated bug — means the legacy path let the request
 * reach its handler; the shadow comparison is about the AUTHORIZATION decision, not about
 * whether the handler itself later succeeded.
 *
 * This is a deliberate, documented heuristic, not a certainty: a plain business 404 (an id
 * that never existed, from a route with no reach ambiguity at all) and a masked-reach 404
 * are genuinely indistinguishable from outside the handler, by this codebase's own design.
 * Treating both as "legacy denied" is the same answer the codebase already gives a real
 * caller, so it cannot manufacture a disagreement the caller wouldn't also see.
 */
export function isLegacyDenialStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 404;
}
