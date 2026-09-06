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
  const trimmed = key.trim();

  // First whitespace run separates method from path. Scanned rather than
  // matched, for the same reason as normaliseRoutePath below.
  let split = 0;
  while (split < trimmed.length && !isWhitespace(trimmed[split])) {
    split += 1;
  }
  if (split === trimmed.length) {
    throw new Error(`Route key must be "METHOD path", got: ${key}`);
  }

  const method = trimmed.slice(0, split).toUpperCase();
  if (!METHOD_SET.has(method)) {
    throw new Error(`Unknown HTTP method in route key: ${key}`);
  }
  const path = normaliseRoutePath(trimmed.slice(split).trim());
  return `${method} ${path}`;
}

/**
 * True for exactly the characters JavaScript's `\s` matches.
 *
 * `String.prototype.trim` strips the same WhiteSpace + LineTerminator set that
 * `\s` matches, so for a single character the two agree — including the awkward
 * members, U+00A0 and U+FEFF.
 */
function isWhitespace(char: string): boolean {
  return char.trim() === "";
}

/** `A-Z`, `a-z`, `0-9`, `_` — the character class Hono allows in a `:param` name. */
function isParamNameChar(code: number): boolean {
  return (
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    (code >= 48 && code <= 57) || // 0-9
    code === 95 // _
  );
}

/**
 * Hono `:param` (and `:param?`, `:param{regex}`) become `{param}`; everything
 * else is left alone.
 *
 * Parsed by hand, in one left-to-right pass, deliberately.
 *
 * This was `path.replace(/:([A-Za-z0-9_]+)(\{[^}]*\})?(\?)?/g, "{$1}")`, which
 * CodeQL flagged as `js/polynomial-redos` (HIGH) and which was genuinely
 * quadratic: on `":0{{"` repeated, every `:` opens the optional `(\{[^}]*\})?`
 * group, `[^}]*` runs greedily to the end of the string hunting a `}` that is
 * never there, then gives the characters back one at a time. O(n) wasted per
 * `:`, and the `g` flag supplies O(n) of them. Measured on Node 24: 2 000 chars
 * 0.9 ms, 4 000 chars 3.3 ms, 8 000 chars 13.5 ms, 16 000 chars 50.8 ms,
 * 32 000 chars 202.5 ms — four times the work for twice the input, all the way
 * up. Route keys reach here from the route scanner, so the input is not a
 * constant this module controls.
 *
 * The trap in rewriting it is that the obvious hand-parse is *also* quadratic:
 * calling `path.indexOf("}", cursor)` for each `:` re-scans to the end of the
 * string every time. So the closing-brace search uses one cursor that only ever
 * moves forward across the whole call — every character of `path` is examined a
 * bounded number of times, and the whole function is O(n).
 *
 * Output is byte-identical to the regex for every input, quirks included: a
 * `{...}` constraint ends at the FIRST `}` (so `:id{[0-9]{3}}` yields `{id}}`,
 * exactly as before), an unterminated `{` is left in place as a literal, and a
 * `:` with no name character after it is not a parameter. `registry.test.ts`
 * proves the equivalence differentially rather than asserting it.
 */
export function normaliseRoutePath(path: string): string {
  const out: string[] = [];
  let literalFrom = 0;
  let i = 0;

  // Monotone cursor: the next `}` at or after the last position we needed one.
  // Only ever advances, which is what keeps this linear.
  let nextClose = path.indexOf("}");

  while (i < path.length) {
    if (path[i] !== ":") {
      i += 1;
      continue;
    }

    let end = i + 1;
    while (end < path.length && isParamNameChar(path.charCodeAt(end))) {
      end += 1;
    }
    if (end === i + 1) {
      i += 1; // a bare ":" is not a parameter
      continue;
    }

    const name = path.slice(i + 1, end);

    // Optional Hono regex constraint `{...}`, consumed and discarded.
    if (path[end] === "{") {
      while (nextClose !== -1 && nextClose <= end) {
        nextClose = path.indexOf("}", nextClose + 1);
      }
      if (nextClose !== -1) {
        end = nextClose + 1;
      }
      // No closing brace anywhere ahead: the optional group matches empty and
      // the "{" stays a literal, which is what the regex did too.
    }

    // Optional "?" marker, consumed and discarded.
    if (path[end] === "?") {
      end += 1;
    }

    out.push(path.slice(literalFrom, i), "{", name, "}");
    i = end;
    literalFrom = end;
  }

  out.push(path.slice(literalFrom));
  return out.join("");
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
