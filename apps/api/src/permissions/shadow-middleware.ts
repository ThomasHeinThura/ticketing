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
  normaliseRouteKey,
} from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import db, { schema } from "../database";
import { policyRegistry } from "../policy-registry";
import { resolveIdentity } from "./resolve-identity";
import { policyShadowEnabled } from "./shadow-config";
import {
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
type ApiKeyContextValue =
  | { readonly id: string; readonly userId: string }
  | undefined;

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
 * traffic" rather than "never measured").
 *
 * Selection: the FIRST matched entry whose method is not `ALL` (Hono records middleware —
 * the guard, compress — as `method: "ALL"`, and route-level middleware share their route's
 * path/method, so the first non-`ALL` entry carries the dispatched route's path). This is
 * the fix's final form after live probing on all three problem routes: `c.req.routePath`
 * was tried as the primary signal and REJECTED — for `GET /api/ws/user` it reported
 * `/api/ws/:projectId` (the param form) while `matchedRoutes` listed `GET /api/ws/user`
 * first, and Opus's own probe established Hono dispatches the first match. Instrumented
 * evidence, not theory: `matchedRoutes` for these three paths all put the literal before
 * the parameter.
 */
function attributedRouteKey(c: Context): string | null {
  const matched = c.req.matchedRoutes.find((r) => r.method !== "ALL");
  if (!matched) {
    return null;
  }
  try {
    return normaliseRouteKey(`${c.req.method} ${matched.path}`);
  } catch {
    return null;
  }
}

/**
 * #323 Opus S3: the `x-request-id` header is caller-controlled and unbounded (an 8,007-
 * character probe value landed verbatim) and correlates with nothing server-side, so it
 * cannot serve as attribution the addendum treats it as. Accept the header only when it
 * matches `^[A-Za-z0-9._-]{1,128}$`; otherwise (including when absent) generate a
 * server-side id. **The trace id is untrusted even when it passes** — a well-formed forged
 * value still passes — it identifies a request within this evidence store and joins no
 * server log.
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
  const traceId = normaliseTraceId(c.req.header("x-request-id"));
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
  const apiKey = c.get("apiKey") as ApiKeyContextValue;
  const userId = (c.get("userId") as string | undefined) || undefined;
  const credential = credentialKindFor(apiKey);
  const identityKind: string | null = userId ? credential : null;
  const evidenceWorkspaceId = () =>
    workspaceIdForShadowEvidence(
      workspaceId,
      workspaceIdSource,
      legacy.known ? legacy.allowed : null,
    );

  let policySide: ReturnType<typeof buildShadowPolicySide>;
  try {
    // Some workspace routes declare row provenance because their handler reads the
    // workspace row, while the reach middleware starts from a path/query value. On
    // denied requests that handler never runs, so resolve the declared target after
    // the response (inside the bounded shadow queue) before deciding its provenance.
    // A missing row stays unevaluated; a caller-supplied id is never promoted to row
    // evidence without this authoritative lookup.
    if (
      workspaceId !== null &&
      workspaceIdSource === "request" &&
      entry !== undefined &&
      isCapabilityPolicy(entry.policy) &&
      entry.policy.scope === "workspace" &&
      entry.policy.scopeSource === "row"
    ) {
      const [workspace] = await db
        .select({ id: schema.workspaceTable.id })
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId))
        .limit(1);
      if (workspace) {
        workspaceIdSource = "row";
      }
    }

    const identity = userId
      ? await resolveIdentity({
          userId,
          credential,
          apiKey: apiKey
            ? { enabled: true, ownerUserId: apiKey.userId }
            : undefined,
        })
      : null;

    policySide = buildShadowPolicySide({
      entry,
      identity,
      workspaceId,
      workspaceIdSource,
      projectId,
      projectIdFromRequest,
      workItemId,
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
