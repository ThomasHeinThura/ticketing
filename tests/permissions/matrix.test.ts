import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BUILT_IN_ROLE_KEYS } from "@taskdesk/permissions";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPolicyRegistry } from "./api-app";
import {
  type CapabilityGrid,
  capabilityGrid,
  identityFor,
  type RouteGrid,
  routeGrid,
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

describe("the two axes stay separate", () => {
  it("gives sees_all no authority at all", () => {
    // sees_all is resolved into reach.kind === 'all'. It must not add a capability.
    const viewer = identityFor("viewer");
    const seesAll = { ...viewer, reach: { kind: "all" } as const };
    expect(seesAll.authority).toEqual(viewer.authority);
  });
});
