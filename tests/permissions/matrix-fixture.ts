/**
 * The permission matrix, computed.
 *
 * Every built-in role against every capability, and every built-in role against every route in
 * the registry — twice, once for **capability** and once for **reach**. A route can pass the
 * first and still leak through the second, which is the shape of several of v1's eleven holes.
 *
 * `matrix.test.ts` compares what this produces against `matrix.fixture.json`. Widening access
 * therefore shows up as a fixture diff in the pull request, which is exactly where a reviewer's
 * attention should be drawn.
 */

import {
  BUILT_IN_ROLE_KEYS,
  BUILT_IN_ROLES,
  type BuiltInRoleKey,
  CAPABILITY_NAMES,
  type Capability,
  evaluatePolicy,
  expandCapabilities,
  isCapabilityPolicy,
  type PolicyRegistry,
  type ResolvedIdentity,
  type RoleGrant,
  type ScopeTarget,
} from "@taskdesk/permissions";

export const WORKSPACE_ID = "ws-matrix";
export const PROJECT_ID = "prj-matrix";
export const ORGANISATION_ID = "org-matrix";
export const PERSON_ID = "person-matrix";

export const MATRIX_TARGET: ScopeTarget = {
  instance: true,
  organisationId: ORGANISATION_ID,
  workspaceId: WORKSPACE_ID,
  projectId: PROJECT_ID,
  workItemId: "wi-matrix",
};

function grantFor(key: BuiltInRoleKey): RoleGrant {
  const role = BUILT_IN_ROLES[key];
  const scopeId =
    role.scope === "instance"
      ? null
      : role.scope === "organisation"
        ? ORGANISATION_ID
        : WORKSPACE_ID;
  return {
    roleKey: role.key,
    scope: role.scope,
    scopeId,
    rank: role.rank,
    capabilities: [...role.capabilities],
  };
}

/** An identity holding exactly one built-in role, in reach of the target project or not. */
export function identityFor(
  key: BuiltInRoleKey,
  options: { inReach?: boolean } = {},
): ResolvedIdentity {
  const isCustomer = key === "customer";
  const inReach = options.inReach ?? true;

  return {
    userId: `user-${key}`,
    personId: PERSON_ID,
    side: isCustomer ? "customer" : "staff",
    organisationId: ORGANISATION_ID,
    portal: isCustomer ? "customer" : "agent",
    credential: "session",
    memberships: inReach
      ? [{ scope: "project", scopeId: PROJECT_ID, seesAll: false }]
      : [],
    teamIds: [],
    reach:
      key === "instance_admin"
        ? { kind: "all" }
        : isCustomer
          ? { kind: "organisation", ids: inReach ? [ORGANISATION_ID] : [] }
          : { kind: "membership" },
    authority: [grantFor(key)],
  };
}

export type CapabilityGrid = Record<BuiltInRoleKey, Capability[]>;

/** Role × capability: what each built-in role actually holds, implications expanded. */
export function capabilityGrid(): CapabilityGrid {
  const grid = {} as CapabilityGrid;
  for (const key of BUILT_IN_ROLE_KEYS) {
    const held = expandCapabilities(BUILT_IN_ROLES[key].capabilities);
    grid[key] = CAPABILITY_NAMES.filter((name) => held.has(name));
  }
  return grid;
}

/** `allow`, `403 forbidden`, `404 not_found`, `401 unauthenticated`, `403 session_required`… */
export type MatrixOutcome = string;

export type RouteGrid = Record<
  string,
  Record<BuiltInRoleKey, { inReach: MatrixOutcome; outOfReach: MatrixOutcome }>
>;

function outcome(
  registryPolicy: Parameters<typeof evaluatePolicy>[0],
  identity: ResolvedIdentity,
  inReach: boolean,
): MatrixOutcome {
  const decision = evaluatePolicy(registryPolicy, {
    identity,
    target: MATRIX_TARGET,
    inReach: isCapabilityPolicy(registryPolicy) ? inReach : undefined,
    portalPredicateSatisfied: inReach,
  });
  if (decision.allowed) {
    return decision.requiresElevation ? "allow (step-up)" : "allow";
  }
  return `${decision.status} ${decision.code}`;
}

/** Role × route, evaluated twice: in reach and out of reach. */
export function routeGrid(registry: PolicyRegistry): RouteGrid {
  const grid: RouteGrid = {};
  for (const entry of registry.entries) {
    const row = {} as RouteGrid[string];
    for (const key of BUILT_IN_ROLE_KEYS) {
      row[key] = {
        inReach: outcome(
          entry.policy,
          identityFor(key, { inReach: true }),
          true,
        ),
        outOfReach: outcome(
          entry.policy,
          identityFor(key, { inReach: false }),
          false,
        ),
      };
    }
    grid[entry.routeKey] = row;
  }
  return grid;
}
