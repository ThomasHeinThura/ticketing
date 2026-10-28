import type { ResolvedIdentity } from "@taskdesk/permissions";
import { reaches } from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import {
  decideMemberRemoval,
  reachAncestorIds,
} from "../../../apps/api/src/project/hierarchy";

/** a -> b -> c -> d; x is a separate root. */
const parents = new Map<string, string | null>([
  ["a", null],
  ["b", "a"],
  ["c", "b"],
  ["d", "c"],
  ["x", null],
]);
const none = new Set<string>();

function staff(projectIds: string[], overrides = {}): ResolvedIdentity {
  return {
    userId: "u",
    personId: "p",
    side: "staff",
    organisationId: "org",
    portal: "agent",
    credential: "session",
    memberships: projectIds.map((scopeId) => ({
      scope: "project" as const,
      scopeId,
      seesAll: false,
    })),
    teamIds: [],
    reach: { kind: "membership" },
    authority: [],
    ...overrides,
  };
}

function facts(projectId: string, deleted = none, map = parents) {
  return {
    projectId,
    workspaceId: "ws",
    organisationId: null,
    ancestorProjectIds: reachAncestorIds(map, deleted, projectId),
  };
}

describe("reachAncestorIds (PR-2 evaluator input)", () => {
  it("lists ancestors nearest first and never the project itself", () => {
    expect(reachAncestorIds(parents, none, "d")).toEqual(["c", "b", "a"]);
    expect(reachAncestorIds(parents, none, "a")).toEqual([]);
    expect(reachAncestorIds(parents, none, "x")).toEqual([]);
  });

  it("stops at a soft-deleted ancestor and grants nothing above it", () => {
    expect(reachAncestorIds(parents, new Set(["b"]), "d")).toEqual(["c"]);
  });

  it("never returns a parent that is not a row of this workspace", () => {
    const foreign = new Map<string, string | null>([["a", "other-ws-project"]]);
    expect(reachAncestorIds(foreign, none, "a")).toEqual([]);
  });

  it("terminates on a stored cycle", () => {
    const cyc = new Map<string, string | null>([
      ["a", "b"],
      ["b", "a"],
    ]);
    expect(reachAncestorIds(cyc, none, "a")).toEqual(["b"]);
  });
});

describe("reaches() with inherited membership (PR-2..PR-3)", () => {
  it("a parent member reaches the child and grandchild, not siblings of the parent", () => {
    const member = staff(["b"]);
    expect(reaches(member, facts("c"))).toBe(true);
    expect(reaches(member, facts("d"))).toBe(true);
    expect(reaches(member, facts("b"))).toBe(true);
    expect(reaches(member, facts("a"))).toBe(false); // inheritance flows down only
    expect(reaches(member, facts("x"))).toBe(false);
  });

  it("an explicit child membership still reaches (override keeps reach)", () => {
    expect(reaches(staff(["a", "c"]), facts("c"))).toBe(true);
  });

  it("an outsider is still denied", () => {
    expect(reaches(staff(["x"]), facts("d"))).toBe(false);
    expect(reaches(staff([]), facts("d"))).toBe(false);
  });

  it("a deleted intermediate project cuts inheritance", () => {
    expect(reaches(staff(["a"]), facts("d", new Set(["c"])))).toBe(false);
  });

  it("customer-side callers never inherit", () => {
    const customer = staff(["a"], {
      side: "customer",
      reach: { kind: "organisation", ids: ["org-customer"] },
    });
    expect(reaches(customer, { ...facts("d"), organisationId: null })).toBe(
      false,
    );
    expect(
      reaches(customer, { ...facts("d"), organisationId: "org-other" }),
    ).toBe(false);
  });
});

describe("decideMemberRemoval (PR-3, PR-4)", () => {
  const ancestors = ["b", "a"];

  it("refuses removing an inherited membership on the child, naming the source", () => {
    expect(
      decideMemberRemoval({
        hasExplicitRow: false,
        ancestorIdsNearestFirst: ancestors,
        ancestorMemberOf: new Set(["a"]),
      }),
    ).toEqual({
      removable: false,
      code: "inherited_membership",
      inheritedFrom: "a",
    });
  });

  it("allows removing an explicit override row, and a person with no membership", () => {
    expect(
      decideMemberRemoval({
        hasExplicitRow: true,
        ancestorIdsNearestFirst: ancestors,
        ancestorMemberOf: new Set(["a"]),
      }),
    ).toEqual({ removable: true });
    expect(
      decideMemberRemoval({
        hasExplicitRow: false,
        ancestorIdsNearestFirst: ancestors,
        ancestorMemberOf: new Set(),
      }),
    ).toEqual({ removable: true });
  });
});
