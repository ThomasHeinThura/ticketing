import { describe, expect, it } from "vitest";
import {
  authorityFor,
  can,
  evaluatePolicy,
  workItemScopeFromRow,
} from "./evaluator";
import type { ResolvedIdentity, RoleGrant } from "./identity";
import type { Policy } from "./policy";

/**
 * PR-2 / PR-3 (P1-1): authority on a child project when the caller holds a project-scope
 * grant only on an ancestor. grandparent -> parent -> child.
 */
const WS = "ws-1";
const GRANDPARENT = "prj-gp";
const PARENT = "prj-parent";
const CHILD = "prj-child";
const ANCESTORS = [PARENT, GRANDPARENT];

const workspaceMember: RoleGrant = {
  roleKey: "member",
  scope: "workspace",
  scopeId: WS,
  rank: 40,
  capabilities: [
    "work_item:read",
    "work_item:create",
    "work_item:update",
    "work_item:transition",
  ],
};
const viewerOn = (projectId: string): RoleGrant => ({
  roleKey: "viewer",
  scope: "project",
  scopeId: projectId,
  rank: 10,
  capabilities: ["work_item:read"],
});
const leadOn = (projectId: string): RoleGrant => ({
  roleKey: "lead",
  scope: "project",
  scopeId: projectId,
  rank: 60,
  capabilities: [
    "work_item:read",
    "work_item:create",
    "work_item:update",
    "work_item:transition",
    "work_item:delete",
  ],
});

function who(
  authority: RoleGrant[],
  overrides: Partial<ResolvedIdentity> = {},
): ResolvedIdentity {
  return {
    userId: "u",
    personId: "p",
    side: "staff",
    organisationId: "org",
    portal: "agent",
    credential: "session",
    memberships: [],
    teamIds: [],
    reach: { kind: "membership" },
    authority,
    ...overrides,
  };
}

const childTarget = {
  workspaceId: WS,
  projectId: CHILD,
  workItemProjectId: CHILD,
  workItemId: "wi-1",
  ancestorProjectIds: ANCESTORS,
};

describe("inherited project authority", () => {
  it("a viewer on the parent is a viewer, not a member, on the child", () => {
    const person = who([workspaceMember, viewerOn(PARENT)]);
    expect(can(person, "work_item:read", "work_item", childTarget)).toBe(true);
    for (const capability of [
      "work_item:create",
      "work_item:update",
      "work_item:transition",
    ] as const) {
      expect(can(person, capability, "work_item", childTarget)).toBe(false);
      expect(can(person, capability, "project", { ...childTarget })).toBe(
        false,
      );
    }
  });

  it("uses the nearest ancestor that carries a grant", () => {
    const person = who([
      workspaceMember,
      viewerOn(PARENT),
      leadOn(GRANDPARENT),
    ]);
    expect(can(person, "work_item:update", "work_item", childTarget)).toBe(
      false,
    );
    const skipParent = who([workspaceMember, leadOn(GRANDPARENT)]);
    expect(can(skipParent, "work_item:update", "work_item", childTarget)).toBe(
      true,
    );
  });

  it("an explicit child grant overrides the inherited one (PR-3)", () => {
    const widened = who([workspaceMember, viewerOn(PARENT), leadOn(CHILD)]);
    expect(can(widened, "work_item:update", "work_item", childTarget)).toBe(
      true,
    );
    const narrowed = who([workspaceMember, leadOn(PARENT), viewerOn(CHILD)]);
    expect(can(narrowed, "work_item:update", "work_item", childTarget)).toBe(
      false,
    );
  });

  it("a parent lead acts with lead authority on the child", () => {
    const person = who([workspaceMember, leadOn(PARENT)]);
    expect(can(person, "work_item:delete", "work_item", childTarget)).toBe(
      true,
    );
  });

  it("with no grant on the child or any ancestor the workspace role applies", () => {
    const person = who([workspaceMember]);
    expect(can(person, "work_item:update", "work_item", childTarget)).toBe(
      true,
    );
    const unrelated = who([workspaceMember, viewerOn("prj-other")]);
    expect(can(unrelated, "work_item:update", "work_item", childTarget)).toBe(
      true,
    );
  });

  it("without ancestor ids nothing is inherited (the evaluator never loads any)", () => {
    const person = who([workspaceMember, viewerOn(PARENT)]);
    expect(
      can(person, "work_item:update", "work_item", {
        ...childTarget,
        ancestorProjectIds: undefined,
      }),
    ).toBe(true);
  });

  it("a customer never inherits", () => {
    const customer = who([viewerOn(PARENT)], { side: "customer" });
    expect(
      authorityFor(customer, "work_item", childTarget).has("work_item:read"),
    ).toBe(false);
  });

  it("an ancestor grant is ignored for workspace and organisation policies", () => {
    const person = who([workspaceMember, viewerOn(PARENT)]);
    expect(
      authorityFor(person, "workspace", {
        workspaceId: WS,
        ancestorProjectIds: ANCESTORS,
      }).has("work_item:update"),
    ).toBe(true);
  });

  it("an ancestor grant that is not in the ancestor list is ignored", () => {
    const person = who([workspaceMember, viewerOn("prj-foreign-parent")]);
    expect(can(person, "work_item:update", "work_item", childTarget)).toBe(
      true,
    );
  });

  it("the project policy path (evaluatePolicy) honours context.ancestorProjectIds", () => {
    const policy: Policy = {
      capability: "work_item:update",
      scope: "work_item",
      scopeSource: "row",
      reach: "required",
    };
    const person = who([workspaceMember, viewerOn(PARENT)]);
    const scope = workItemScopeFromRow({
      workItemId: "wi-1",
      projectId: CHILD,
      workspaceId: WS,
    });
    const denied = evaluatePolicy(policy, {
      identity: person,
      target: {},
      scope,
      inReach: true,
      ancestorProjectIds: ANCESTORS,
    });
    expect(denied.allowed).toBe(false);
    const flat = evaluatePolicy(policy, {
      identity: person,
      target: {},
      scope,
      inReach: true,
    });
    expect(flat.allowed).toBe(true);
  });
});
