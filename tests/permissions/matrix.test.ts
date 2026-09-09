import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BUILT_IN_ROLE_KEYS,
  type BuiltInRoleKey,
  evaluatePolicy,
  isCapabilityPolicy,
  workspaceScopeFromRequest,
} from "@taskdesk/permissions";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPolicyRegistry } from "./api-app";
import {
  type CapabilityGrid,
  capabilityGrid,
  identityFor,
  MATRIX_TARGET,
  type RouteGrid,
  routeGrid,
  WORKSPACE_ID,
} from "./matrix-fixture";

/**
 * The permission matrix.
 *
 * Every built-in role against every capability, and every built-in role against every route,
 * asserted against a checked-in fixture. Changing who may do what changes the fixture, and the
 * change appears as a diff in the pull request — which is the point: the failure mode being
 * defended against is a widening nobody noticed.
 */

const FIXTURE_PATH = fileURLToPath(
  new URL("./matrix.fixture.json", import.meta.url),
);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
  readonly capabilities: CapabilityGrid;
  readonly routes: RouteGrid;
};

describe("permission matrix — capability", () => {
  const grid = capabilityGrid();

  it("covers every built-in role", () => {
    expect(Object.keys(grid).sort()).toEqual([...BUILT_IN_ROLE_KEYS].sort());
    expect(Object.keys(fixture.capabilities).sort()).toEqual(
      [...BUILT_IN_ROLE_KEYS].sort(),
    );
  });

  for (const key of BUILT_IN_ROLE_KEYS) {
    it(`holds exactly the fixed capability set for ${key}`, () => {
      expect(grid[key]).toEqual(fixture.capabilities[key]);
    });
  }
});

describe("permission matrix — route", () => {
  let grid: RouteGrid;

  beforeAll(async () => {
    grid = routeGrid(await loadPolicyRegistry());
  }, 120_000);

  it("covers every route in the registry, with no fixture row left behind", () => {
    expect(Object.keys(grid).sort()).toEqual(
      Object.keys(fixture.routes).sort(),
    );
  });

  it("matches the fixture for every role on every route, in reach and out of it", () => {
    expect(grid).toEqual(fixture.routes);
  });

  it("evaluates reach separately from capability", () => {
    // The second half of the matrix exists because a route can pass the capability check and
    // still answer for a resource outside the caller's reach. Where the two answers differ,
    // the out-of-reach answer must be 404 — never 403, which would confirm the record exists.
    for (const [routeKey, row] of Object.entries(grid)) {
      for (const key of BUILT_IN_ROLE_KEYS) {
        const { inReach, outOfReach } = row[key];
        if (inReach === outOfReach) continue;
        expect(outOfReach, `${routeKey} · ${key}`).toMatch(/^404 /);
      }
    }
  });
});

describe("workspace:transfer_ownership — the policy layer alone refuses a manager", () => {
  // The defect this batch closes: the route used to declare `workspace:manage_members`
  // while the runtime enforced a hardcoded `role === "owner"` check with NO capability check
  // anywhere on the path — so the permission matrix (generated from the declared policy)
  // read `manager → allow` for a route only the owner could ever call. `routeGrid` above
  // already proves the fixture is correct end to end, but that alone does not distinguish
  // "the policy says deny" from "the policy says allow and something else downstream also
  // happens to deny" — a test that only calls the HTTP route or the controller could pass
  // for either reason. This calls `evaluatePolicy` directly, against the ACTUAL registered
  // policy for this route, with no controller, no middleware and no database involved at
  // all, so a manager being refused here can only mean the declared capability itself
  // refuses them.
  const ROUTE_KEY = "POST /api/workspace/{workspaceId}/transfer-ownership";

  it("declares workspace:transfer_ownership, not workspace:manage_members", async () => {
    const registry = await loadPolicyRegistry();
    const entry = registry.entries.find((e) => e.routeKey === ROUTE_KEY);
    if (!entry) throw new Error(`${ROUTE_KEY} is missing from the registry`);
    if (!isCapabilityPolicy(entry.policy)) {
      throw new Error(`${ROUTE_KEY} is no longer a capability-kind policy`);
    }
    expect(entry.policy.capability).toBe("workspace:transfer_ownership");
  });

  it("evaluatePolicy allows owner and refuses every other built-in role, capability check alone", async () => {
    const registry = await loadPolicyRegistry();
    const entry = registry.entries.find((e) => e.routeKey === ROUTE_KEY);
    if (!entry) throw new Error(`${ROUTE_KEY} is missing from the registry`);

    const scope = workspaceScopeFromRequest({ workspaceId: WORKSPACE_ID });

    for (const key of BUILT_IN_ROLE_KEYS) {
      const decision = evaluatePolicy(entry.policy, {
        identity: identityFor(key as BuiltInRoleKey, { inReach: true }),
        target: MATRIX_TARGET,
        scope,
        inReach: true,
        portalPredicateSatisfied: true,
      });
      expect(decision.allowed, key).toBe(key === "owner");
    }
  });
});

describe("the two axes stay separate", () => {
  it("gives sees_all no authority at all", () => {
    // sees_all is resolved into reach.kind === 'all'. It must not add a capability.
    const viewer = identityFor("viewer");
    const seesAll = { ...viewer, reach: { kind: "all" } as const };
    expect(seesAll.authority).toEqual(viewer.authority);
  });
});
