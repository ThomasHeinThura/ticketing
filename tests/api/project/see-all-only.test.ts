import {
  authorityFor,
  BUILT_IN_ROLES,
  type ResolvedIdentity,
} from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import { projectSeenOnlyViaWorkspaceRole } from "../../../apps/api/src/project/see-all-only";

const project = {
  id: "project",
  workspaceId: "workspace",
  organisationId: null,
  deleted: false,
  archived: false,
  ancestorProjectIds: ["parent"],
  ownerTeamId: "team",
};
function identity(
  role: "owner" | "admin" | "manager" | "lead" | "member" | "viewer",
): ResolvedIdentity {
  const builtIn = BUILT_IN_ROLES[role];
  return {
    userId: "user",
    personId: "person",
    side: "staff",
    organisationId: "org",
    portal: "agent",
    credential: "session",
    memberships: [],
    teamIds: [],
    reach: { kind: "membership_with_workspaces", workspaceIds: ["workspace"] },
    authority: [
      {
        roleKey: role,
        scope: "workspace",
        scopeId: "workspace",
        rank: builtIn.rank,
        capabilities: builtIn.capabilities,
      },
    ],
  };
}
describe("see-all membership hint", () => {
  for (const role of ["owner", "admin", "manager"] as const) {
    it(`${role}: only shows when no project, ancestor or owning-team membership exists`, () => {
      const caller = identity(role);
      expect(projectSeenOnlyViaWorkspaceRole(caller, project)).toBe(true);
      for (const id of ["project", "parent"]) {
        expect(
          projectSeenOnlyViaWorkspaceRole(
            {
              ...caller,
              memberships: [{ scope: "project", scopeId: id, seesAll: false }],
            },
            project,
          ),
        ).toBe(false);
      }
      expect(
        projectSeenOnlyViaWorkspaceRole(
          { ...caller, teamIds: ["team"] },
          project,
        ),
      ).toBe(false);
      expect(
        projectSeenOnlyViaWorkspaceRole(caller, {
          ...project,
          workspaceId: "another",
        }),
      ).toBe(false);
    });
  }
  for (const role of ["lead", "member", "viewer"] as const) {
    it(`${role}: never shows the see-all hint`, () => {
      expect(projectSeenOnlyViaWorkspaceRole(identity(role), project)).toBe(
        false,
      );
    });
  }
  it("fails closed without an identity", () => {
    expect(projectSeenOnlyViaWorkspaceRole(null, project)).toBe(false);
  });
});

describe("candidate same-role project grants", () => {
  for (const role of ["owner", "admin", "manager"] as const) {
    it(`${role}: an identical role definition would preserve the evaluator capability set`, () => {
      const caller = identity(role);
      const workspaceRole = caller.authority[0];
      if (!workspaceRole) throw new Error("workspace role missing");
      const before = authorityFor(caller, "project", {
        workspaceId: "workspace",
        projectId: "project",
      });
      const after = authorityFor(
        {
          ...caller,
          authority: [
            ...caller.authority,
            { ...workspaceRole, scope: "project", scopeId: "project" },
          ],
        },
        "project",
        { workspaceId: "workspace", projectId: "project" },
      );
      expect([...after].sort()).toEqual([...before].sort());
    });
  }
});
