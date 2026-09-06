/**
 * Route policies — the anti-v1 mechanism.
 *
 * Every route declares its policy at definition time. A policy is one of **exactly five
 * kinds**; the specs may use no other form and the route-coverage test rejects any other
 * (`docs/01-architecture/rbac.md` § "Route policies", ADR 0010).
 *
 * Position is untrusted. v1 — and the inherited kaneo tree — enforced authentication by
 * source-code ordering: `api.use("*")` gates only what is registered below it, and sixteen
 * routes sat above it. A policy is therefore a property of the **route**, never of where it
 * happens to be declared.
 */

import type { Capability } from "./capabilities";

/** What a capability check is evaluated against. */
export const SCOPES = [
  "instance",
  "workspace",
  "project",
  "work_item",
  "organisation",
] as const;

export type Scope = (typeof SCOPES)[number];

/**
 * Predicates over the **loaded row**. Closed set: a new predicate is a change to rbac.md,
 * not an edit at the keyboard.
 */
export const OWNER_PREDICATES = [
  "row.person_id === identity.personId",
  "row.created_by === identity.personId",
  "row.requester_id === identity.personId",
] as const;

export type OwnerPredicate = (typeof OWNER_PREDICATES)[number];

/** Predicates over the **request body**, evaluated after Zod parsing and before the handler. */
export const BODY_PREDICATES = [
  "body.assigneeId === identity.personId",
] as const;

export type BodyPredicate = (typeof BODY_PREDICATES)[number];

/** How a customer-portal policy scopes the query. */
export const PORTAL_PREDICATES = [
  "own_request",
  "own_organisation",
  "addressed_approval",
  "own_submission",
] as const;

export type PortalPredicate = (typeof PORTAL_PREDICATES)[number];

/**
 * The mounts that sit outside the session model.
 *
 * **This union is closed.** Adding a member is a decision-log entry, not an edit — the whole
 * point of kind 5 is that a delegated mount is an explicitly allowlisted exception.
 */
export const DELEGATED_SURFACES = [
  "better-auth",
  "websocket",
  "metrics",
  "scim",
] as const;

export type DelegatedSurface = (typeof DELEGATED_SURFACES)[number];

/**
 * The owner branch of a capability policy.
 *
 * It is a **conjunction, not a bypass**: the primary capability is checked first, and if it
 * is absent the request is allowed only when the caller holds this branch's own `*_own`
 * capability **and** the predicate evaluates true against the loaded row.
 */
export type OwnerBranch = {
  readonly predicate: OwnerPredicate;
  readonly capability: Capability;
  /** Time bound relative to the row's `created_at` — the comment edit window, in the registry. */
  readonly withinMinutes?: number;
};

/**
 * The self-target branch of a capability policy — the request body names the actor.
 *
 * Like `orOwner` it is a **conjunction**: the caller must still hold `capability`. rbac.md's
 * type block writes this branch as a bare predicate, but its own roles table settles what the
 * conjunction is — "self-assignment by a `member` is `work_item:update` on an item where the
 * new assignee is the actor" — and a bare predicate would let a `viewer` self-assign, which is
 * the exact class of hole this registry exists to refuse.
 */
export type SelfTargetBranch = {
  readonly predicate: BodyPredicate;
  readonly capability: Capability;
};

/** Kind 1 — the normal case. */
export type CapabilityPolicy = {
  readonly capability: Capability;
  readonly scope: Scope;
  readonly orOwner?: OwnerBranch;
  readonly orSelfTarget?: SelfTargetBranch;
};

/** Kind 2 — the caller's own records only (`/api/me/*`). Replaces every `(self)` in the specs. */
export type SelfPolicy = {
  readonly authenticated: true;
  readonly self: true;
};

/** Kind 3 — a customer session on `/api/portal/*`, scoped by predicate. */
export type PortalPolicy = {
  readonly portal: "customer";
  readonly predicate: PortalPredicate;
};

/** Kind 4 — unauthenticated, with a stated reason, so "public" is a deliberate, reviewable act. */
export type PublicPolicy = {
  readonly public: true;
  readonly reason: string;
};

/** Kind 5 — a mount outside the session model, allowlisted explicitly. */
export type DelegatedPolicy = {
  readonly delegated: DelegatedSurface;
  readonly reason: string;
};

/**
 * Declared on the route, not in a prose table.
 *
 * - `elevated` — requires a fresh authentication regardless of capability. The single
 *   elevated-action table in rbac.md is **generated** from these entries.
 * - `sessionOnly` — accepted only from a browser session; an API key, an `is_mcp` key or an
 *   impersonation session is refused `403 session_required` **before** the policy runs.
 * - `elevated: false` is not a no-op: it is the explicit, reasoned opt-out that the elevation
 *   coverage test demands of an `/api/instance/*` route or an authority-granting capability.
 */
export type ElevationFlags = {
  readonly elevated?: boolean;
  readonly sessionOnly?: true;
  /** Required when `elevated: false` is declared on a route the elevation rule would otherwise catch. */
  readonly elevationExemptionReason?: string;
};

export type Policy = (
  | CapabilityPolicy
  | SelfPolicy
  | PortalPolicy
  | PublicPolicy
  | DelegatedPolicy
) &
  ElevationFlags;

export const POLICY_KINDS = [
  "capability",
  "self",
  "portal",
  "public",
  "delegated",
] as const;

export type PolicyKind = (typeof POLICY_KINDS)[number];

export function isCapabilityPolicy(
  policy: Policy,
): policy is CapabilityPolicy & ElevationFlags {
  return "capability" in policy;
}

export function isSelfPolicy(
  policy: Policy,
): policy is SelfPolicy & ElevationFlags {
  return "self" in policy;
}

export function isPortalPolicy(
  policy: Policy,
): policy is PortalPolicy & ElevationFlags {
  return "portal" in policy;
}

export function isPublicPolicy(
  policy: Policy,
): policy is PublicPolicy & ElevationFlags {
  return "public" in policy;
}

export function isDelegatedPolicy(
  policy: Policy,
): policy is DelegatedPolicy & ElevationFlags {
  return "delegated" in policy;
}

/** Which of the five kinds this is. Throws for anything that is not one of them. */
export function policyKind(policy: Policy): PolicyKind {
  if (isCapabilityPolicy(policy)) return "capability";
  if (isSelfPolicy(policy)) return "self";
  if (isPortalPolicy(policy)) return "portal";
  if (isPublicPolicy(policy)) return "public";
  if (isDelegatedPolicy(policy)) return "delegated";
  throw new Error(
    "Policy matches none of the five kinds in rbac.md — there is no sixth kind",
  );
}

export const HTTP_METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "ALL",
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * A route key: `METHOD path`, with path parameters in braces —
 * `"POST /api/projects/{projectId}/work-items"`.
 *
 * rbac.md writes them padded for readability (`'POST  /api/…'`); `normaliseRouteKey`
 * collapses that, and converts Hono's `:param` syntax to braces, so one route has exactly
 * one key however it was written.
 */
export type RouteKey = string;

export type PolicyMap = Readonly<Record<RouteKey, Policy>>;

const METHOD_SET: ReadonlySet<string> = new Set(HTTP_METHODS);

/**
 * Canonicalise a route key.
 *
 * `"POST  /api/projects/:projectId/work-items"` and
 * `"post /api/projects/{projectId}/work-items"` both become
 * `"POST /api/projects/{projectId}/work-items"`.
 *
 * A trailing slash is significant to Hono and is preserved.
 */
export function normaliseRouteKey(key: string): RouteKey {
  const trimmed = key.trim().replace(/\s+/, " ");
  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace === -1) {
    throw new Error(`Route key must be "METHOD path", got: ${key}`);
  }
  const method = trimmed.slice(0, firstSpace).toUpperCase();
  if (!METHOD_SET.has(method)) {
    throw new Error(`Unknown HTTP method in route key: ${key}`);
  }
  const path = normaliseRoutePath(trimmed.slice(firstSpace + 1).trim());
  return `${method} ${path}`;
}

/** Hono `:param` (and `:param?`, `:param{regex}`) become `{param}`; everything else is left alone. */
export function normaliseRoutePath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)(\{[^}]*\})?(\?)?/g, "{$1}");
}

export function routeKeyParts(key: RouteKey): {
  method: HttpMethod;
  path: string;
} {
  const normalised = normaliseRouteKey(key);
  const firstSpace = normalised.indexOf(" ");
  return {
    method: normalised.slice(0, firstSpace) as HttpMethod,
    path: normalised.slice(firstSpace + 1),
  };
}
