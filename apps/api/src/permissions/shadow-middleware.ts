/**
 * Issue #8, Slice 2 — the request-path shadow middleware. Evaluates every request the
 * registry can reach against the declarative policy registry, using `resolveIdentity`
 * (issue #8 Slice 1), and logs any disagreement with the existing hand-written
 * authorization. **Never blocks, never changes a response, never adds unbounded latency.**
 *
 * NOT A SEPARATE `api.use("*", ...)` REGISTRATION. `runNextWithPolicyShadow` (below) is
 * called from WITHIN the body of `apps/api/src/index.ts`'s one existing auth-guard
 * middleware, wrapping the same `next` it already calls — see that function's own doc
 * comment for exactly why: a second registration at the same raw key
 * (`"ALL /api/*"`) would require bumping `packages/permissions/src/route-coverage.ts`'s
 * `DECLARED_ROUTER_MIDDLEWARE` count, which breaks that package's own fixture-based test
 * suite (confirmed empirically) and is out of this lane's scope to edit regardless. Nor is
 * it installed by wrapping `app.fetch` outside Hono's router — this middleware needs the
 * same `Context` the guard and feature routers populate (`c.get("userId")`,
 * `c.get("apiKey")`, `c.get("workspaceId")`), and a `Context` only exists inside Hono's own
 * dispatch, reachable only from inside a real middleware or handler.
 *
 * **Ordering consequence, disclosed, not silently accepted:** a route registered ABOVE the
 * guard's own registration index (in `apps/api/src/index.ts`'s source order) never runs the
 * guard at all — the H2 mechanism — so it never reaches this wrapper either. Every route in
 * that position is `public` or `delegated` in the registry already (`policy-registry.ts`'s
 * own file comment enumerates them: `/api/health`, `/api/openapi`, the avatar route, the
 * auth mount, …) — genuinely public surfaces, so shadow coverage for them adds little, and
 * they are excluded from the per-router summary's coverage expectations for exactly this
 * reason (see the PR body's coverage table).
 *
 * **REPEATABLE READ / same-snapshot residual (#315 S9).** The addendum and the 2026-09-23
 * prerequisites both ask that identity and the legacy checks read from the same snapshot.
 * `resolveIdentity` is called here, AFTER the legacy path (including the auth guard and any
 * feature-router row lookups) has already committed its own separate queries — this
 * middleware does not, and cannot without touching `apps/api/src/database/**` (#308's
 * lane, out of scope here), wrap the whole request in one REPEATABLE READ transaction. The
 * residual is real but bounded: a role or membership change occurring in the handful of
 * milliseconds between the legacy checks and this middleware's own `resolveIdentity` call
 * could produce a spurious disagreement, indistinguishable in the evidence from a genuine
 * one. Documented here and in the PR body, not fixed in this slice.
 *
 * **Legacy authorization is explicit context written by authorization middleware.**
 * Response status is retained as diagnostic evidence, but never decides whether legacy
 * allowed or denied. A route whose authorization path has not recorded a decision is
 * conservatively `legacy_outcome_unknown`.
 */

import {
  type CredentialKind,
  evaluatePolicy,
  isCapabilityPolicy,
  isSelfPolicy,
  normaliseRouteKey,
  type ProjectReachFacts,
} from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import db, { schema } from "../database";
import { policyRegistry } from "../policy-registry";
import {
  type AuthenticatedApiKey,
  resolveRequestIdentity,
} from "./resolve-request-identity";
import { policyShadowEnabled } from "./shadow-config";
import {
  ensurePolicyRequestId,
  type ShadowLegacyAuthorization,
  workspaceIdForShadowEvidence,
} from "./shadow-context";
import {
  buildShadowPolicySide,
  compareShadowOutcome,
  type LegacyOutcome,
  type ShadowPolicySide,
} from "./shadow-evaluation";
import {
  recordShadowDrops,
  recordShadowOutcome,
  utcDateString,
} from "./shadow-store";

/** `c.get("apiKey")`'s shape, as `authenticate-api-request.ts` sets it. */
type ApiKeyContextValue = AuthenticatedApiKey | undefined;

function credentialKindFor(apiKey: ApiKeyContextValue): CredentialKind {
  // Known gap (resolve-identity.ts KNOWN GAP 2, S315): `mcp_key` cannot be distinguished
  // from `api_key` yet — no schema column carries `is_mcp`. Every key-credentialed request
  // resolves to `"api_key"` here, the same limitation Slice 1's own loader documents.
  return apiKey ? "api_key" : "session";
}

/** Best-effort router group for the per-router summary: the registry's own source label. */
function routerGroupFor(source: string | undefined): string {
  return source ?? "unregistered";
}

type PolicyFacts = {
  readonly kind: string | null;
  readonly capability: string | null;
};

function policyFactsFor(
  entry: ReturnType<typeof policyRegistry.get>,
): PolicyFacts {
  if (!entry) {
    return { kind: null, capability: null };
  }
  return {
    kind: entry.kind,
    capability: isCapabilityPolicy(entry.policy)
      ? entry.policy.capability
      : null,
  };
}

async function writeErrorRecord(args: {
  readonly routeKey: string;
  readonly routerGroup: string;
  readonly policy: PolicyFacts;
  readonly legacy: LegacyOutcome;
  readonly identityKind: string | null;
  readonly workspaceId: string | null;
  readonly traceId: string | null;
  readonly message: string;
}): Promise<void> {
  await recordShadowOutcome({
    day: utcDateString(),
    routeKey: args.routeKey,
    routerGroup: args.routerGroup,
    outcome: "evaluator_error",
    reasonCode: "evaluator_threw",
    policyKind: args.policy.kind,
    policyCapability: args.policy.capability,
    legacyAllowed: args.legacy.known ? args.legacy.allowed : null,
    legacyStatus: args.legacy.known ? args.legacy.status : null,
    policyAllowed: null,
    policyStatus: null,
    policyCode: null,
    diagnostic: args.message,
    identityKind: args.identityKind,
    workspaceId: args.workspaceId,
    traceId: args.traceId,
  });
}

/**
 * The route Hono actually dispatched, as a registry key — never a middleware entry.
 *
 * #323 Opus S2: `matchedRoutes.at(-1)` (the old answer) assumed the last match is the
 * route that ran, but when a literal route and a parameter route both match a path, Hono
 * dispatches the FIRST such match while `at(-1)` returns the LAST — `PUT /api/project/
 * reorder`, `GET /api/invitation/pending` and `GET /api/ws/user` were all attributed to
 * another route's bucket, and their own keys never got a tally row (readable as "no
 * traffic" rather than "never measured"). `c.req.routePath` was tried as the primary
 * signal and REJECTED — for `GET /api/ws/user` it reported `/api/ws/:projectId` (the
 * param form) while `matchedRoutes` listed `GET /api/ws/user` first, and Opus's own probe
 * established Hono dispatches the first match. Instrumented evidence, not theory:
 * `matchedRoutes` for these three paths all put the literal before the parameter.
 *
 * The matched entry's OWN registered method is used to build the key, never
 * `c.req.method` (Opus B2 delta): Hono dispatches a HEAD request through its matching GET
 * route, so `c.req.method` stays `"HEAD"` while the matched route's own `method` is
 * `"GET"` — the method the registry and route-coverage actually classified.
 *
 * See the catch-all-exemption doc comment above `attributedRoutesToClassify` below for
 * how a matched entry is told apart from reviewed infrastructure middleware — that
 * mechanism has its own, more recent history (B1, B3, F4, F5) and is documented there,
 * not duplicated here.
 */
/**
 * **Consolidated history** (this mechanism has been fixed four times in a row for the
 * same recurring class of gap — B1, B3, F4, F5 — each closing one way a matched entry
 * could be mistaken for infrastructure that doesn't need its own classification):
 *
 * `assertRouteIsClassified` (the guard) runs FROM INSIDE the auth guard's own middleware
 * body, so `c.req.matchedRoutes` always includes at least the guard's own entry, plus
 * host routing, CORS, compression and origin-selected static serving — none of these is a feature route, and none should ever need
 * a policy-registry entry of its own. Something has to tell "real feature route" apart
 * from "reviewed infrastructure middleware" — B1/B3/F4 each tried a different PREDICTION
 * (method is not `ALL`; stop at the first non-`ALL` entry; …) and each prediction had a
 * hole an adversarial registration could exploit. F5 found the last one: exempting by KEY
 * STRING (`ALL /*` / `ALL /api/*`) assumes the key identifies the handler, but the key
 * only identifies where something is mounted — a stray `app.all("/api/*", …)` fallback, a
 * `.use("*")` that itself answers a request, a `.mount()`, or a sub-router's own
 * `.all("*")` at the same key would be exempted the same way the two real middlewares are.
 *
 * **Fix: identity, not prediction.** `createApp()` (`apps/api/src/index.ts`) calls
 * `declareCatchAllMiddleware` on the EXACT function reference for each of its five
 * reviewed catch-all registrations (Host guard, CORS, compression, origin-selected static
 * serving, and the auth guard itself) at the moment it creates each one, before passing it to
 * `.use()`. A matched entry is exempted only when `r.handler` is one of those exact
 * function references — identity, which `app.route("/api", api)` preserves (the mounted
 * sub-app has its own `onError` but the middleware function objects themselves are never
 * wrapped or copied) — never a string, a method, or a position anything else could
 * coincidentally share. `attributedRoutesToClassify`'s unbounded walk (the guard's own
 * caller) and `attributedMatchedRoute`'s bounded first-match (shadow-mode telemetry's
 * caller, a different, non-enforcing use) both use this same `declaredCatchAllHandlers`
 * set — the difference between them is how far each one walks matched entries, never how
 * a single entry is judged exempt.
 */
const declaredCatchAllHandlers = new Set<unknown>();

/**
 * Called once per catch-all middleware, at its own registration call site in
 * `apps/api/src/index.ts`, immediately before that middleware is passed to `.use()`.
 * Never called for anything route-specific or added after this module has
 * already started serving requests -- there are exactly five call sites, all inside
 * `createApp()`, all matching the `DECLARED_ROUTER_MIDDLEWARE` declarations.
 * Takes `unknown`, not Hono's own handler type: this is an identity token, never invoked
 * here, and matched against `RouterRoute["handler"]`, whose exact generic shape depends on
 * the router instance's own type parameters -- coupling to it would make this module
 * depend on every feature router's own `Env` type for no behavioural benefit.
 */
export function declareCatchAllMiddleware(handler: unknown): void {
  declaredCatchAllHandlers.add(handler);
}

/** The dispatched route's own `{ method, path }`, or `null` when nothing matched at all. */
export type AttributedRoute = {
  readonly method: string;
  readonly path: string;
};

/**
 * Opus delta pass B3 (live-reproduced): the previous "first matched entry that isn't a
 * DECLARED catch-all" rule fails open for a route-scoped `.use()` middleware registered
 * before the real handler (e.g. `app.use("/api/foo/*", next)`) -- that middleware's own
 * key is not one of the two DECLARED_CATCH_ALL_KEYS, so it was itself returned as "the"
 * attributed route, and its own (possibly permissive) registry entry gated every
 * unclassified route behind it instead of the real handler's.
 *
 * **Opus delta pass F4 (live-reproduced): stopping the walk at the first non-`ALL` entry
 * was ITSELF still a prediction, and the prediction had a hole.** A GET/POST/other
 * specific-method handler can call `next()` and hand the request on, exactly like
 * `.use()` does -- Hono does not require a route to be the terminal handler just because
 * its own method matches. Three shapes proved this live: a GET pass-through handler, a
 * multi-method (`app.on(["GET","POST"], ...)`) pass-through, and a parameter route that
 * conditionally calls `next()` -- each classified, each fronting an unclassified route
 * that then served 200 with a leak. This guard cannot correctly PREDICT which matched
 * entry Hono will end up running (this is the third time trying has produced a hole), so
 * it stops predicting: every matched entry except the two declared catch-alls must be
 * classified, full stop, no early exit. `route-classification-guard.ts`'s
 * `assertRouteIsClassified` is the only caller of this unbounded form -- see
 * `attributedMatchedRoute` below for the (deliberately still-bounded) single-route
 * prediction shadow-mode attribution needs instead.
 */
export function attributedRoutesToClassify(c: Context): AttributedRoute[] {
  const result: AttributedRoute[] = [];
  for (const r of c.req.matchedRoutes) {
    if (declaredCatchAllHandlers.has(r.handler)) {
      continue;
    }
    result.push({ method: r.method, path: r.path });
  }
  return result;
}

/**
 * The FIRST matched entry that is not one of the framework's own declared catch-all
 * middleware registrations (`DECLARED_CATCH_ALL_KEYS`). `null` only for a genuinely
 * unmatched request.
 *
 * **Deliberately NOT the unbounded walk `attributedRoutesToClassify` uses** (F4's own
 * finding): shadow-mode attribution predicts the single route a request's outcome should
 * be compared against, and the LAST entry of an unbounded walk can be a sibling parameter
 * route that never actually runs -- `GET /api/invitation/pending` also matches
 * `GET /api/invitation/{id}`'s parameter pattern, and taking the last (parameter) entry
 * would misattribute every `/pending` request to the wrong policy. The first non-catch-all
 * entry is Hono's own literal-before-parameter dispatch order (#323's S2 finding) and
 * remains the correct single-route prediction for telemetry, even though it is not a safe
 * enforcement boundary (that's exactly why the guard itself no longer uses it).
 *
 * Exported separately from `attributedRouteKey` so a caller that needs to distinguish "no
 * route matched" (a real 404, nothing to check) from "a route matched but its key could not
 * be normalised" (`route-classification-guard.ts`'s B1 fix: that case must still refuse, not
 * be swallowed into the same `null` as an unmatched request) can tell them apart.
 */
export function attributedMatchedRoute(c: Context): AttributedRoute | null {
  const matched = c.req.matchedRoutes.find(
    (r) => !declaredCatchAllHandlers.has(r.handler),
  );
  return matched ? { method: matched.method, path: matched.path } : null;
}

export function attributedRouteKey(c: Context): string | null {
  const matched = attributedMatchedRoute(c);
  if (!matched) {
    return null;
  }
  try {
    return normaliseRouteKey(`${matched.method} ${matched.path}`);
  } catch {
    return null;
  }
}

/**
 * Legacy correlation helper for consumers outside policy shadow. Strict witness and
 * shadow-event correlation use `ensurePolicyRequestId`: one server-generated value shared
 * with the request log and response header, never an inbound header.
 */
export function normaliseTraceId(header: string | undefined): string {
  if (header !== undefined && /^[A-Za-z0-9._-]{1,128}$/.test(header)) {
    return header;
  }
  return crypto.randomUUID();
}

async function runShadowEvaluation(
  c: Context,
  legacy: LegacyOutcome,
  routeKey: string,
): Promise<void> {
  const traceId = ensurePolicyRequestId(c);
  const entry = policyRegistry.get(routeKey);
  const policy = policyFactsFor(entry);
  const routerGroup = routerGroupFor(entry?.source);
  const workspaceId = (c.get("workspaceId") as string | undefined) ?? null;
  let workspaceIdSource =
    (c.get("workspaceIdSource") as "row" | "request" | undefined) ?? null;
  const projectId = (c.get("projectId") as string | undefined) ?? null;
  const projectIdFromRequest =
    (c.get("projectIdFromRequest") as string | undefined) ?? null;
  const workItemId = (c.get("workItemId") as string | undefined) ?? null;
  const projectReachFacts = c.get("projectReachFacts") as
    | ProjectReachFacts
    | undefined;
  const apiKey = c.get("apiKey") as ApiKeyContextValue;
  const userId = (c.get("userId") as string | undefined) || undefined;
  const credential = credentialKindFor(apiKey);
  const identityKind: string | null = userId ? credential : null;
  // Evidence-only, deliberately decoupled from `workspaceIdSource` above (#400, Opus R1 on
  // #381): that variable also feeds `buildShadowPolicySide`'s policy-side comparison below,
  // where promoting it to "row" for a `scopeSource: "request"` policy would turn a correct
  // agreement into a false `scope_source_mismatch` disagreement (#323 Opus S1). This flag
  // answers a narrower question — "is this exact id backed by a real workspace row" — and is
  // the only thing shadow evidence trusts. A legacy path saying "allowed" is never treated as
  // proof by itself: an instance-admin bypass (`validateWorkspaceAccess`'s admin early
  // return, `hasWorkspacePermission`'s `isInstanceAdmin` shortcut, and any future one) says
  // "allowed" without ever checking the workspace exists.
  let workspaceIdVerified = workspaceIdSource === "row";
  const evidenceWorkspaceId = () =>
    workspaceIdForShadowEvidence(workspaceId, workspaceIdVerified);

  let policySide: ReturnType<typeof buildShadowPolicySide>;
  try {
    // A request-sourced id (query/body/param) is never itself a loaded row. Confirm it
    // against a real `workspace` row before trusting it as evidence, for EVERY
    // request-sourced id, regardless of the route's own policy shape and regardless of
    // whether legacy authorization allowed or denied the request (#400 widens this beyond
    // the `scopeSource: "row"`-only check #381 shipped). A missing row stays unverified;
    // nothing here ever substitutes "some legacy path allowed it" for this check.
    if (workspaceId !== null && workspaceIdSource === "request") {
      const [workspace] = await db
        .select({ id: schema.workspaceTable.id })
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId))
        .limit(1);
      if (workspace) {
        workspaceIdVerified = true;
        // Only promote the POLICY-side source when the route's own policy declares row
        // provenance — promoting it for a `scopeSource: "request"` policy would make the
        // evaluator refuse a correct agreement as `scope_source_mismatch` (#323 Opus S1).
        if (
          entry !== undefined &&
          isCapabilityPolicy(entry.policy) &&
          entry.policy.scope === "workspace" &&
          entry.policy.scopeSource === "row"
        ) {
          workspaceIdSource = "row";
        }
      }
    }

    const identity = userId
      ? await resolveRequestIdentity({
          userId,
          apiKey,
          impersonatedBy: (
            c.get("session") as { impersonatedBy?: string | null } | null
          )?.impersonatedBy,
        })
      : null;

    let workspaceMembership: boolean | undefined;
    if (
      userId &&
      workspaceId &&
      entry !== undefined &&
      isSelfPolicy(entry.policy) &&
      entry.policy.workspaceMembership === true
    ) {
      const memberships = await db
        .select({ userId: schema.workspaceUserTable.userId })
        .from(schema.workspaceUserTable)
        .innerJoin(
          schema.workspaceTable,
          eq(schema.workspaceTable.id, schema.workspaceUserTable.workspaceId),
        )
        .where(
          and(
            eq(schema.workspaceUserTable.userId, userId),
            eq(schema.workspaceUserTable.workspaceId, workspaceId),
          ),
        )
        .limit(2);
      // Membership is an active row in an existing workspace. Duplicate rows are
      // ambiguous and do not satisfy this self-policy condition.
      workspaceMembership = memberships.length === 1;
    }

    policySide = buildShadowPolicySide({
      entry,
      identity,
      workspaceId,
      workspaceIdSource,
      projectId,
      projectIdFromRequest,
      workItemId,
      workspaceMembership,
      projectReachFacts,
    });
  } catch (error) {
    await writeErrorRecord({
      routeKey,
      routerGroup,
      policy,
      legacy,
      identityKind,
      workspaceId: evidenceWorkspaceId(),
      traceId,
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  let policyForCompare: ShadowPolicySide;
  let decision: ReturnType<typeof evaluatePolicy> | undefined;

  if (typeof policySide === "string") {
    policyForCompare = {
      evaluated: false,
      errored: false,
      reasonCode: policySide,
    };
  } else {
    try {
      decision = evaluatePolicy(policySide.entry.policy, policySide.context);
      policyForCompare = { evaluated: true, errored: false, decision };
    } catch (error) {
      await writeErrorRecord({
        routeKey,
        routerGroup,
        policy,
        legacy,
        identityKind,
        workspaceId: evidenceWorkspaceId(),
        traceId,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }

  const comparison = compareShadowOutcome({
    routeKey,
    routerGroup,
    policyKind: policy.kind,
    policyCapability: policy.capability,
    identityKind: credential,
    workspaceId,
    traceId,
    legacy,
    policy: policyForCompare,
  });

  await recordShadowOutcome({
    day: utcDateString(),
    routeKey,
    routerGroup,
    outcome: comparison.outcome,
    reasonCode: comparison.reasonCode,
    policyKind: policy.kind,
    policyCapability: policy.capability,
    legacyAllowed: legacy.known ? legacy.allowed : null,
    legacyStatus: legacy.known ? legacy.status : null,
    policyAllowed: decision?.allowed ?? null,
    policyStatus:
      decision && decision.allowed === false ? decision.status : null,
    policyCode: decision && decision.allowed === false ? decision.code : null,
    diagnostic:
      decision && decision.allowed === false
        ? (decision.diagnostic ?? null)
        : null,
    identityKind,
    workspaceId: evidenceWorkspaceId(),
    traceId,
  });
}

/**
 * #323 Opus S5: shadow work (3 identity queries + tally upsert + event insert per
 * disagreement) shares the 10-connection pool with legacy queries, previously unbounded —
 * a 2,000-request burst pushed legacy p50 from 131 ms to 594 ms and left ~1,990 pool
 * waiters queued. These limits bound it: at most `maxInflight` evaluations run
 * concurrently, at most `maxPending` more wait in queue, and anything beyond that is
 * DROPPED and COUNTED — persisted as `unevaluated: shadow_saturated` so a saturated router
 * stays not-clean (coverage stays honest) instead of silently losing evidence. The flush
 * timer is `.unref()`'d so it never holds a process (or test run) open. Test hooks below
 * shrink the limits the way `resetShadowPruneGuardForTests` re-arms the prune.
 */
const SHADOW_LIMITS = { maxInflight: 8, maxPending: 128 } as const;
const SHADOW_DROP_FLUSH_MS = 5_000;

type ShadowLimits = {
  maxInflight: number;
  maxPending: number;
};

let shadowLimits: ShadowLimits = { ...SHADOW_LIMITS };
let shadowInflight = 0;
let shadowPending = 0;
let shadowDrops = 0;
const shadowQueue: Array<() => Promise<void>> = [];
// D1 (Opus delta): entries carry the route's REAL router group — drops must file under
// the same group the evaluated rows use, or a saturated router reads as clean in the
// per-router summary the cut-over PR cites.
const shadowDropCounts = new Map<
  string,
  { readonly routerGroup: string; count: number }
>();
let shadowFlushTimer: ReturnType<typeof setInterval> | null = null;

/** Test hook: shrink the concurrency limits to force saturation deterministically. */
export function setShadowLimitsForTests(limits: Partial<ShadowLimits>): void {
  shadowLimits = { ...SHADOW_LIMITS, ...limits };
}

/** Test hook: flush accumulated drops immediately (the 5s timer is too slow for tests). */
export async function flushShadowDropsForTests(): Promise<void> {
  await flushShadowDrops();
}

/** Test hook: current queue depths + dropped-evaluation count. */
export function shadowConcurrencySnapshot(): {
  inflight: number;
  pending: number;
  dropped: number;
} {
  return {
    inflight: shadowInflight,
    pending: shadowPending,
    dropped: shadowDrops,
  };
}

function ensureDropFlush(): void {
  if (shadowFlushTimer === null) {
    shadowFlushTimer = setInterval(() => {
      void flushShadowDrops();
    }, SHADOW_DROP_FLUSH_MS);
    shadowFlushTimer.unref?.();
  }
}

/** Flushes accumulated drops into one tally row per route key (`shadow_saturated`). */
async function flushShadowDrops(): Promise<void> {
  if (shadowDropCounts.size === 0) {
    if (
      shadowInflight === 0 &&
      shadowPending === 0 &&
      shadowQueue.length === 0 &&
      shadowFlushTimer !== null
    ) {
      clearInterval(shadowFlushTimer);
      shadowFlushTimer = null;
    }
    return;
  }
  const entries = [...shadowDropCounts.entries()];
  shadowDropCounts.clear();
  for (const [routeKey, value] of entries) {
    await recordShadowDrops(routeKey, value.routerGroup, value.count);
  }
}

function noteShadowDrop(routeKey: string, routerGroup: string): void {
  shadowDrops += 1;
  const existing = shadowDropCounts.get(routeKey);
  if (existing === undefined) {
    shadowDropCounts.set(routeKey, { routerGroup, count: 1 });
  } else {
    existing.count += 1;
  }
  ensureDropFlush();
}

function pumpShadowQueue(): void {
  while (shadowInflight < shadowLimits.maxInflight && shadowQueue.length > 0) {
    const task = shadowQueue.shift();
    if (!task) {
      break;
    }
    shadowPending -= 1;
    shadowInflight += 1;
    void task().finally(() => {
      shadowInflight -= 1;
      pumpShadowQueue();
    });
  }
}

/**
 * Wraps the existing `next()` call **inside** `apps/api/src/index.ts`'s one existing
 * `api.use("*", ...)` auth guard — it is not a second `.use()` registration.
 *
 * `packages/permissions/src/route-coverage.ts`'s `DECLARED_ROUTER_MIDDLEWARE` hard-codes an
 * exact count of Hono registrations at the raw key `"ALL /api/*"` (today: 1, the guard
 * itself), and `packages/permissions/src/route-coverage.test.ts` builds fixture routers
 * against that exact declared count — a second real registration at that key, even a
 * correct one, makes every one of those fixture tests disagree with reality (confirmed
 * empirically: adding a second `api.use("*", ...)` and bumping the declared count to 2 broke
 * 10 tests in that file, which builds its own single-registration fixtures and does not
 * expect two). Editing that file at all is also out of this lane's scope — it is shared,
 * security-review-scope package code, not owned here. So instead of a second registration,
 * this function is called from WITHIN the guard's own handler, wrapping the same `next`
 * reference the guard already calls — the registration count at `"ALL /api/*"` never
 * changes, and `packages/permissions` is untouched by this slice.
 *
 * When `TASKDESK_POLICY_SHADOW` is `off` (the default), this is a true no-op: it calls
 * `next()` directly, with no branch, no query and no measurable overhead beyond one function
 * call — the requirement that shadow mode add "zero queries" when off.
 */
export async function runNextWithPolicyShadow(
  c: Context,
  next: Next,
): Promise<void> {
  if (!policyShadowEnabled) {
    await next();
    return;
  }

  await next();

  const status = c.res?.status ?? 0;
  const authorization = c.get("legacyAuthorization") as
    | ShadowLegacyAuthorization
    | undefined;
  // A later route/controller layer can still reject a request after an earlier
  // authorization middleware passed. Status never decides allow/deny here, but a
  // 401/403 contradicts a surviving `allowed` marker, so downgrade that incomplete
  // evidence instead of recording a false authorization result. Known post-gate
  // decisions (for example bulk workspace membership) overwrite the marker directly.
  const markerConflictsWithResponse =
    (authorization === "allowed" && (status === 401 || status === 403)) ||
    (authorization === "denied" && status >= 200 && status < 400);
  const legacy: LegacyOutcome =
    authorization === undefined ||
    authorization === "unknown" ||
    markerConflictsWithResponse
      ? { known: false }
      : { known: true, allowed: authorization === "allowed", status };

  const routeKey = attributedRouteKey(c);
  if (routeKey === null) {
    return;
  }

  // Fire-and-forget inside an S5-bounded slot, deliberately: the response has already been
  // produced by the time we get here (`await next()` has resolved), so nothing below can
  // change it. Errors are caught inside `runShadowEvaluation`/`recordShadowOutcome`
  // themselves; the outer catch is defence in depth against a bug in the wiring above
  // those, not the expected path.
  const task = () =>
    runShadowEvaluation(c, legacy, routeKey).catch((error) => {
      console.error("policy shadow: evaluation failed", error);
    });

  if (shadowInflight < shadowLimits.maxInflight) {
    shadowInflight += 1;
    void task().finally(() => {
      shadowInflight -= 1;
      pumpShadowQueue();
    });
    return;
  }
  if (shadowPending < shadowLimits.maxPending) {
    shadowPending += 1;
    shadowQueue.push(task);
    return;
  }
  // Both bounded queues full: drop this evaluation and count it per route key, flushed as
  // `unevaluated: shadow_saturated` UNDER THIS ROUTE'S OWN ROUTER GROUP (D1) — the router
  // stays not-clean in the per-router summary rather than evidence vanishing or hiding
  // in a fake group (#323 Opus S5, delta D1).
  noteShadowDrop(
    routeKey,
    routerGroupFor(policyRegistry.get(routeKey)?.source),
  );
}
