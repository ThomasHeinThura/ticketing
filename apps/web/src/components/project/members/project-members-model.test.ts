import { describe, expect, it } from "vitest";
import {
  assignableRoles,
  isAuthorityReplacingWorkspaceRole,
  projectMemberErrorKey,
  rosterRoleItems,
} from "./project-members-model";

describe("project members model", () => {
  it("turns roles into select items in the order the API sent them", () => {
    expect(
      rosterRoleItems([
        {
          roleKey: "project-viewer",
          roleName: "Project viewer",
          roleRank: 20,
          roleId: null,
        },
        {
          roleKey: "project-lead",
          roleName: "Project lead",
          roleRank: 50,
          roleId: "r1",
        },
      ]),
    ).toEqual([
      { value: "project-viewer", label: "Project viewer" },
      { value: "project-lead", label: "Project lead" },
    ]);
  });

  it("warns for the workspace roles a project role would lower", () => {
    for (const role of ["owner", "admin", "manager"]) {
      expect(isAuthorityReplacingWorkspaceRole(role)).toBe(true);
    }
    for (const role of ["lead", "member", "viewer", "custom"]) {
      expect(isAuthorityReplacingWorkspaceRole(role)).toBe(false);
    }
  });

  const roles = [
    {
      roleKey: "project-viewer",
      roleName: "Viewer",
      roleRank: 20,
      roleId: null,
    },
    {
      roleKey: "project-member",
      roleName: "Member",
      roleRank: 40,
      roleId: null,
    },
    { roleKey: "project-lead", roleName: "Lead", roleRank: 60, roleId: null },
  ];

  it("offers only roles at or below the caller's rank, keeping a held role", () => {
    expect(assignableRoles(roles, 40).map((r) => r.roleKey)).toEqual([
      "project-viewer",
      "project-member",
    ]);
    expect(
      assignableRoles(roles, 20, "project-lead").map((r) => r.roleKey),
    ).toEqual(["project-viewer", "project-lead"]);
    expect(assignableRoles(roles, undefined)).toHaveLength(3);
  });

  it("maps server refusals to i18n keys without exposing server text", () => {
    const fb = "settings:projectMembers.removeError";
    expect(
      projectMemberErrorKey(
        new Error(
          "inherited_membership: inherited from project 0b1f-uuid; remove",
        ),
        fb,
      ),
    ).toBe("settings:projectMembers.errors.inheritedMembership");
    expect(projectMemberErrorKey(new Error("managed_membership: x"), fb)).toBe(
      "settings:projectMembers.errors.managedMembership",
    );
    expect(
      projectMemberErrorKey(new Error("pending_action_target_changed"), fb),
    ).toBe("settings:projectMembers.errors.targetChanged");
    expect(
      projectMemberErrorKey(
        Object.assign(new Error("Forbidden text"), { status: 403 }),
        fb,
      ),
    ).toBe("settings:projectMembers.errors.forbidden");
    expect(
      projectMemberErrorKey(
        Object.assign(new Error("something"), { status: 409 }),
        fb,
      ),
    ).toBe("settings:projectMembers.errors.conflict");
    expect(projectMemberErrorKey(new Error("boom"), fb)).toBe(fb);
  });
});
