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
 * **Legacy outcome is read from the final response status alone**, not from a try/catch
 * around `next()`: `apps/api/src/index.ts`'s `app.onError` already converts every thrown
 * `HTTPException` (and every other error) into a `Response` before `next()` here ever
 * resolves, so `next()` never throws — see `shadow-evaluation.ts`'s `isLegacyDenialStatus`
 * for the 401/403/404 heuristic this relies on.
 */

import {
  type CredentialKind,
  evaluatePolicy,
  isCapabilityPolicy,
  normaliseRouteKey,
} from "@taskdesk/permissions";
import type { Context, Next } from "hono";
import { policyRegistry } from "../policy-registry";
import { resolveIdentity } from "./resolve-identity";
import { policyShadowEnabled } from "./shadow-config";
import {
  buildShadowPolicySide,
  compareShadowOutcome,
  isLegacyDenialStatus,
  type LegacyOutcome,
  type ShadowPolicySide,
} from "./shadow-evaluation";
import { recordShadowOutcome, utcDateString } from "./shadow-store";

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

async function runShadowEvaluation(
  c: Context,
  legacy: LegacyOutcome,
): Promise<void> {
  // The DEEPEST matched entry, not `c.req.routePath` (whose backing `routeIndex` freezes at
  // whichever middleware last threw, e.g. the auth guard on a 401 — see this file's own
  // header comment). `matchedRoutes` is registration-order, and this codebase always
  // registers global wildcards before feature routers/routes, so the last entry is the real
  // terminal match in every case this middleware is mounted for.
  const matched = c.req.matchedRoutes.at(-1);
  if (!matched) {
    return;
  }

  let routeKey: string;
  try {
    routeKey = normaliseRouteKey(`${c.req.method} ${matched.path}`);
  } catch {
    return;
  }

  const traceId = c.req.header("x-request-id") ?? null;
  const entry = policyRegistry.get(routeKey);
  const policy = policyFactsFor(entry);
  const routerGroup = routerGroupFor(entry?.source);
  const workspaceId = (c.get("workspaceId") as string | undefined) ?? null;
  const projectId = (c.get("projectId") as string | undefined) ?? null;
  const workItemId = (c.get("workItemId") as string | undefined) ?? null;
  const apiKey = c.get("apiKey") as ApiKeyContextValue;
  const userId = (c.get("userId") as string | undefined) || undefined;
  const credential = credentialKindFor(apiKey);
  const identityKind: string | null = userId ? credential : null;

  let policySide: ReturnType<typeof buildShadowPolicySide>;
  try {
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
      projectId,
      workItemId,
    });
  } catch (error) {
    await writeErrorRecord({
      routeKey,
      routerGroup,
      policy,
      legacy,
      identityKind,
      workspaceId,
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
        workspaceId,
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
    workspaceId,
    traceId,
  });
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
  const legacy: LegacyOutcome = {
    known: true,
    allowed: !isLegacyDenialStatus(status),
    status,
  };

  // Fire-and-forget, deliberately: the response has already been produced by the time we
  // get here (`await next()` has resolved), so nothing below can change it. Errors are
  // caught inside `runShadowEvaluation`/`recordShadowOutcome` themselves; this catch is
  // defence in depth against a bug in the wiring above those, not the expected path.
  void runShadowEvaluation(c, legacy).catch((error) => {
    console.error("policy shadow: evaluation failed", error);
  });
}
