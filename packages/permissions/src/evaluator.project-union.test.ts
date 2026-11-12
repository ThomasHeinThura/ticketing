import { describe, expect, it } from "vitest";
import { authorityFor, can } from "./evaluator";
import type { ResolvedIdentity, RoleGrant } from "./identity";
import { BUILT_IN_ROLES } from "./roles";

const target = { workspaceId: "w", projectId: "p" };
function workspace(roleKey: string, scopeId = "w"): RoleGrant {
  return {
    roleKey,
    scope: "workspace",
    scopeId,
    rank: 50,
    capabilities: ["project:archive"],
  };
}
const project: RoleGrant = {
  roleKey: "project-viewer",
  scope: "project",
  scopeId: "p",
  rank: 30,
  capabilities: ["project:read"],
};
describe("Thomas 12 Nov: project roles only add for workspace owner/admin/manager", () => {
  for (const role of [
    "owner",
    "admin",
    "manager",
    "lead",
    "member",
    "viewer",
    "custom",
  ]) {
    it(`${role} follows the selected scope rule in both directions`, () => {
      const additive = ["owner", "admin", "manager"].includes(role);
      const held = authorityFor(
        { side: "staff", authority: [workspace(role), project] },
        "project",
        target,
      );
      expect(held.has("project:read")).toBe(true);
      expect(held.has("project:archive")).toBe(additive);
      const reverse = authorityFor(
        {
          authority: [
            { ...workspace(role), capabilities: ["project:read"] },
            { ...project, capabilities: ["project:archive"] },
          ],
        },
        "project",
        target,
      );
      expect(reverse.has("project:archive")).toBe(true);
    });
  }
  for (const role of ["owner", "admin", "manager"] as const) {
    it(`${role} keeps its complete capabilities after joining with the default member role`, () => {
      const grant = {
        ...workspace(role),
        capabilities: BUILT_IN_ROLES[role].capabilities,
      };
      const before = authorityFor({ authority: [grant] }, "project", target);
      const after = authorityFor(
        {
          authority: [
            grant,
            { ...project, capabilities: BUILT_IN_ROLES.member.capabilities },
          ],
        },
        "project",
        target,
      );
      expect([...after].sort()).toEqual([...before].sort());
    });
    it(`${role} in another workspace does not enable union here`, () => {
      const held = authorityFor(
        { authority: [workspace(role, "other"), workspace("member"), project] },
        "project",
        target,
      );
      expect(held.has("project:archive")).toBe(false);
    });
  }
  it("customers and removed members gain nothing from the exception", () => {
    expect(
      authorityFor(
        { side: "customer", authority: [workspace("manager"), project] },
        "project",
        target,
      ).has("project:archive"),
    ).toBe(false);
    expect(authorityFor({ authority: [] }, "project", target).size).toBe(0);
  });
  for (const credential of ["api_key", "mcp_key"] as const) {
    it(`${credential} retains the owner union but is clamped to its own subset`, () => {
      const identity: ResolvedIdentity = {
        userId: "u",
        personId: "person",
        side: "staff",
        organisationId: "o",
        portal: "agent",
        credential,
        memberships: [],
        teamIds: [],
        reach: { kind: "all" },
        authority: [workspace("manager"), project],
        keyCapabilities: ["project:read"],
      };
      expect(can(identity, "project:archive", "project", target)).toBe(false);
      expect(can(identity, "project:read", "project", target)).toBe(true);
    });
  }
});
