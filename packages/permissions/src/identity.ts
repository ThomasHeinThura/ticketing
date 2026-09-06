/**
 * The identity and context types the evaluator takes.
 *
 * Shape follows `resolveIdentity` in `docs/01-architecture/auth-and-identity.md`:
 * `{ userId, side, organisationId, memberships, reach, authority }`. Everything about what a
 * person may do is resolved **from the database on every request**, keyed by user id — never
 * from a session claim, a token or a group claim.
 *
 * This is a shared contract (CLAUDE.md § "Shared-contract ownership"): it is changed by a
 * small dedicated pull request, never by a feature agent in passing.
 */

import type { Capability } from "./capabilities";
import type { RoleScope } from "./roles";

/** Which portal a person belongs to. One person, one organisation; a customer is never staff. */
export type Side = "staff" | "customer";

/** Which portal a session was issued for, compared to the request host by the portal boundary. */
export type Portal = "agent" | "customer";

/**
 * How a request is credentialed. `sessionOnly` routes accept `session` alone; an API key, an
 * MCP key or an impersonation session is refused `403 session_required` before the policy runs.
 */
export const CREDENTIAL_KINDS = [
  "session",
  "api_key",
  "mcp_key",
  "impersonation",
] as const;

export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

/**
 * A role attached to a membership, reduced to what evaluation needs.
 *
 * `capabilities` are the **raw stored strings** from `role.capabilities`, which may contain a
 * name this build does not know: an unrecognised string is logged and treated as absent.
 */
export type RoleGrant = {
  readonly roleKey: string;
  readonly scope: RoleScope;
  /** `workspace_id` / `project_id` / `organisation_id`. `null` for an instance-scope role. */
  readonly scopeId: string | null;
  readonly rank: number;
  readonly capabilities: readonly string[];
};

/**
 * A row of `membership`. `sees_all` grants **reach only** — it never grants authority.
 * That is the distinction v1 collapsed.
 */
export type Membership = {
  readonly scope: RoleScope;
  readonly scopeId: string;
  readonly seesAll: boolean;
  /** Set when the membership came from an ancestor project (OpenProject's model). */
  readonly inheritedFrom?: string | null;
};

/** Reach — which organisations, workspaces and projects this person can see. */
export type Reach =
  | { readonly kind: "all" }
  | { readonly kind: "organisation"; readonly ids: readonly string[] }
  | { readonly kind: "membership" };

export type ResolvedIdentity = {
  /** better-auth `user.id`. */
  readonly userId: string;
  /** `person.id` — what every ownership predicate compares against. */
  readonly personId: string;
  readonly side: Side;
  readonly organisationId: string;
  readonly portal: Portal;
  readonly credential: CredentialKind;
  readonly memberships: readonly Membership[];
  /** Teams this person belongs to. A team that **owns** a project grants reach — step 5 — and no authority. */
  readonly teamIds: readonly string[];
  readonly reach: Reach;
  /** The roles attached to those memberships. Authority, and nothing else. */
  readonly authority: readonly RoleGrant[];
  /**
   * The capability subset frozen onto an API key at creation, when the request carries one.
   * Effective authority is the intersection of the owner's RBAC and this set.
   */
  readonly keyCapabilities?: readonly string[];
};

/**
 * The resource a check is evaluated against — the "scope object", resolved from the route's
 * declared scope source: a path parameter, the `X-Workspace-Id` header (or `?workspace=`), or
 * the filter body for `POST /api/work-items/search`.
 */
export type ScopeTarget = {
  readonly instance?: true;
  readonly organisationId?: string;
  readonly workspaceId?: string;
  readonly projectId?: string;
  readonly workItemId?: string;
  /**
   * The project a work item belongs to. A `work_item`-scoped check resolves to its project's
   * authority; the id itself only matters to reach.
   */
  readonly workItemProjectId?: string;
};

/** A `capability` is unknown to this build: log it, treat it as absent, never wildcard-expand it. */
export type UnknownCapabilityHandler = (
  capability: string,
  context: { roleKey?: string; source: "role" | "api_key" },
) => void;

export type { Capability };
