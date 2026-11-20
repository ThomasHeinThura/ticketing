import { describe, expect, it } from "vitest";
import { resolveRosterActorAuthority } from "../../../apps/api/src/project/members/actor";
import {
  buildRoster,
  callerRankInProject,
  decideRosterRemoval,
  previewReparentAccess,
  type RosterRow,
} from "../../../apps/api/src/project/members/roster";
import { projectMembersResponseSchema } from "../../../apps/api/src/project/members/schema";

const LEAD = {
  roleId: "r-lead",
  roleKey: "project-lead",
  roleName: "Project lead",
  roleRank: 50,
};
const MEMBER = {
  roleId: "r-member",
  roleKey: "project-member",
  roleName: "Project member",
  roleRank: 40,
};
const VIEWER = {
  roleId: "r-viewer",
  roleKey: "project-viewer",
  roleName: "Project viewer",
  roleRank: 20,
};

function row(
  personId: string,
  role: typeof LEAD,
  hasDirectGrant = true,
): RosterRow {
  return {
    membershipId: `membership-${personId}`,
    hasCurrentDirectGrant: hasDirectGrant,
    personId,
    displayName: personId.toUpperCase(),
    active: true,
    jobTitle: null,
    hasDirectGrant,
    ...role,
  };
}

describe("buildRoster (PR-2, PR-3, PR-4)", () => {
  it("shows ancestor members as inherited, read-only rows naming the ancestor", () => {
    const roster = buildRoster({
      direct: [row("ann", LEAD)],
      ancestors: [
        {
          projectId: "parent",
          projectName: "Parent",
          rows: [row("bob", MEMBER)],
        },
        { projectId: "root", projectName: "Root", rows: [row("cy", VIEWER)] },
      ],
    });
    const bob = roster.find((e) => e.personId === "bob");
    expect(bob).toMatchObject({
      source: "inherited",
      membershipId: null,
      removable: false,
      inheritedFrom: { projectId: "parent", projectName: "Parent" },
    });
    expect(
      roster.find((e) => e.personId === "cy")?.inheritedFrom?.projectId,
    ).toBe("root");
    expect(roster.find((e) => e.personId === "ann")).toMatchObject({
      source: "direct",
      membershipId: "membership-ann",
      removable: true,
      inheritedFrom: null,
    });
  });

  it("an explicit child row overrides the inherited role and remembers what it overrides", () => {
    const roster = buildRoster({
      direct: [row("bob", LEAD)],
      ancestors: [
        {
          projectId: "parent",
          projectName: "Parent",
          rows: [row("bob", VIEWER)],
        },
      ],
    });
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({
      source: "direct",
      roleKey: "project-lead",
      overridesInherited: { roleKey: "project-viewer" },
      inheritedFrom: { projectId: "parent" },
    });
  });

  it("uses the nearest ancestor when several hold the same person", () => {
    const roster = buildRoster({
      direct: [],
      ancestors: [
        { projectId: "near", projectName: "Near", rows: [row("bob", MEMBER)] },
        { projectId: "far", projectName: "Far", rows: [row("bob", LEAD)] },
      ],
    });
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({
      roleKey: "project-member",
      inheritedFrom: { projectId: "near" },
    });
  });

  it("marks a row held only by an identity-provider mapping as not removable here", () => {
    const [entry] = buildRoster({
      direct: [row("dee", MEMBER, false)],
      ancestors: [],
    });
    expect(entry).toMatchObject({
      managedExternally: true,
      removable: false,
      membershipId: null,
    });
  });

  it("exposes only the winning current direct-grant row ID", () => {
    const staleDirect = { ...row("ann", LEAD), hasCurrentDirectGrant: false };
    const [entry] = buildRoster({ direct: [staleDirect], ancestors: [] });
    expect(entry?.membershipId).toBeNull();
    expect(entry?.source).toBe("direct");
  });
});

describe("decideRosterRemoval (PR-4)", () => {
  it("refuses an inherited-only person with the nearest ancestor id", () => {
    expect(
      decideRosterRemoval({
        directRow: undefined,
        ancestorIdsNearestFirst: ["near", "far"],
        ancestorMemberOf: new Set(["far"]),
      }),
    ).toEqual({
      allowed: false,
      status: 409,
      code: "inherited_membership",
      inheritedFrom: "far",
    });
  });

  it("allows removing an explicit override even when an ancestor also holds the person", () => {
    expect(
      decideRosterRemoval({
        directRow: { hasDirectGrant: true },
        ancestorIdsNearestFirst: ["near"],
        ancestorMemberOf: new Set(["near"]),
      }),
    ).toEqual({ allowed: true });
  });

  it("answers not-on-roster for a stranger and managed for an IdP-only row", () => {
    expect(
      decideRosterRemoval({
        directRow: undefined,
        ancestorIdsNearestFirst: ["near"],
        ancestorMemberOf: new Set(),
      }),
    ).toMatchObject({ allowed: false, status: 404 });
    expect(
      decideRosterRemoval({
        directRow: { hasDirectGrant: false },
        ancestorIdsNearestFirst: [],
        ancestorMemberOf: new Set(),
      }),
    ).toMatchObject({
      allowed: false,
      status: 409,
      code: "managed_membership",
    });
  });
});

describe("callerRankInProject", () => {
  const grants = [
    { scope: "workspace", scopeId: "w1", rank: 80 },
    { scope: "workspace", scopeId: "w2", rank: 100 },
    { scope: "project", scopeId: "p1", rank: 50 },
  ];
  it("a project role overrides the workspace role on that project", () => {
    expect(callerRankInProject(grants, "p1", "w1")).toBe(50);
  });
  it("falls back to this workspace's role, never another workspace's", () => {
    expect(callerRankInProject(grants, "p2", "w1")).toBe(80);
    expect(callerRankInProject([], "p2", "w1")).toBe(0);
  });
});

describe("previewReparentAccess", () => {
  // a -> b ; c is a separate root with its own members ; x is the moving project (under b)
  const parents = new Map<string, string | null>([
    ["a", null],
    ["b", "a"],
    ["c", null],
    ["x", "b"],
    ["y", "x"],
  ]);
  const rowsByProject = new Map<string, RosterRow[]>([
    ["a", [row("ann", LEAD)]],
    ["b", [row("bob", MEMBER)]],
    ["c", [row("cy", VIEWER), row("bob", VIEWER)]],
    ["x", [row("dee", MEMBER)]],
  ]);
  const projectNames = new Map([
    ["a", "A"],
    ["b", "B"],
    ["c", "C"],
    ["x", "X"],
  ]);
  const base = {
    parents,
    deleted: new Set<string>(),
    projectId: "x",
    directPersonIds: new Set(["dee"]),
    rowsByProject,
    projectNames,
  };

  it("lists who gains, who loses and whose inherited role changes", () => {
    const preview = previewReparentAccess({ ...base, newParentId: "c" });
    expect(preview.refusal).toBeNull();
    expect(preview.gains.map((g) => g.personId)).toEqual(["cy"]);
    expect(preview.gains[0]?.via.projectName).toBe("C");
    expect(preview.losses.map((l) => l.personId)).toEqual(["ann"]);
    expect(preview.roleChanges.map((r) => r.personId)).toEqual(["bob"]);
    expect(preview.roleChanges[0]).toMatchObject({
      from: { roleKey: "project-member", projectName: "B" },
      to: { roleKey: "project-viewer", projectName: "C" },
    });
  });

  it("moving to the root loses every inherited member and gains nobody", () => {
    const preview = previewReparentAccess({ ...base, newParentId: null });
    expect(preview.gains).toEqual([]);
    expect(preview.losses.map((l) => l.personId).sort()).toEqual([
      "ann",
      "bob",
    ]);
  });

  it("a person with a direct row on the project keeps access either way", () => {
    const preview = previewReparentAccess({
      ...base,
      directPersonIds: new Set(["dee", "ann"]),
      newParentId: null,
    });
    expect(preview.losses.map((l) => l.personId)).toEqual(["bob"]);
  });

  it("reports a refused move and changes nothing", () => {
    const preview = previewReparentAccess({ ...base, newParentId: "y" });
    expect(preview.refusal).toBe("parent_is_descendant");
    expect(preview.gains).toEqual([]);
    expect(preview.losses).toEqual([]);
  });

  it("a soft-deleted new ancestor grants nothing", () => {
    const preview = previewReparentAccess({
      ...base,
      deleted: new Set(["c"]),
      newParentId: "c",
    });
    expect(preview.gains).toEqual([]);
  });
});

describe("roster response carries callerRank", () => {
  it("requires an integer callerRank", () => {
    const base = { members: [], roles: [] };
    expect(projectMembersResponseSchema.safeParse(base).success).toBe(false);
    expect(
      projectMembersResponseSchema.safeParse({ ...base, callerRank: 50 })
        .success,
    ).toBe(true);
    expect(
      projectMembersResponseSchema.safeParse({ ...base, callerRank: 1.5 })
        .success,
    ).toBe(false);
  });

  it("callerRank is the same value the write ceiling uses", () => {
    const grants = [
      { scope: "project", scopeId: "p1", rank: 50 },
      { scope: "workspace", scopeId: "w1", rank: 80 },
    ];
    expect(callerRankInProject(grants, "p1", "w1")).toBe(50);
  });

  it("accepts optional boolean canManageMembers", () => {
    const base = { members: [], roles: [], callerRank: 30 };
    expect(projectMembersResponseSchema.safeParse(base).success).toBe(true);
    expect(
      projectMembersResponseSchema.safeParse({
        ...base,
        canManageMembers: true,
      }).success,
    ).toBe(true);
    expect(
      projectMembersResponseSchema.safeParse({
        ...base,
        canManageMembers: "yes",
      }).success,
    ).toBe(false);
  });
});

describe("resolveRosterActorAuthority (PR-2 ancestor inheritance, RL-3, instance admin)", () => {
  it("inherits an ancestor project-lead grant when the child project has no direct grant", () => {
    const authority = resolveRosterActorAuthority(
      {
        side: "staff",
        credential: "session",
        authority: [
          {
            roleKey: "member",
            scope: "workspace",
            scopeId: "w1",
            rank: 40,
            capabilities: ["project:read"],
          },
          {
            roleKey: "project-lead",
            scope: "project",
            scopeId: "p-parent",
            rank: 50,
            capabilities: ["project:read", "project:manage_members"],
          },
        ],
      },
      {
        workspaceId: "w1",
        projectId: "p-child",
        ancestorProjectIds: ["p-parent"],
        isInstanceAdmin: false,
      },
    );
    expect(authority.rank).toBe(50);
    expect(authority.canManageMembers).toBe(true);
    expect(authority.held?.has("project:manage_members")).toBe(true);
  });

  it("respects RL-3 decoupling: rank 30 with project:manage_members can manage, rank 60 without cannot", () => {
    const lowRankManager = resolveRosterActorAuthority(
      {
        side: "staff",
        credential: "session",
        authority: [
          {
            roleKey: "custom-roster-admin",
            scope: "project",
            scopeId: "p1",
            rank: 30,
            capabilities: ["project:manage_members"],
          },
        ],
      },
      {
        workspaceId: "w1",
        projectId: "p1",
        ancestorProjectIds: [],
        isInstanceAdmin: false,
      },
    );
    expect(lowRankManager.rank).toBe(30);
    expect(lowRankManager.canManageMembers).toBe(true);

    const highRankReader = resolveRosterActorAuthority(
      {
        side: "staff",
        credential: "session",
        authority: [
          {
            roleKey: "custom-executive",
            scope: "project",
            scopeId: "p1",
            rank: 60,
            capabilities: ["project:read"],
          },
        ],
      },
      {
        workspaceId: "w1",
        projectId: "p1",
        ancestorProjectIds: [],
        isInstanceAdmin: false,
      },
    );
    expect(highRankReader.rank).toBe(60);
    expect(highRankReader.canManageMembers).toBe(false);
  });

  it("grants un-keyed instance admins full rank and capability, while clamping keyed admins", () => {
    const instanceAuthority = [
      {
        roleKey: "instance-admin",
        scope: "instance" as const,
        scopeId: null,
        rank: 100,
        capabilities: ["instance:admin"],
      },
    ];
    const unkeyed = resolveRosterActorAuthority(
      {
        side: "staff",
        credential: "session",
        authority: instanceAuthority,
      },
      {
        workspaceId: "w1",
        projectId: "p1",
        ancestorProjectIds: [],
        isInstanceAdmin: true,
      },
    );
    expect(unkeyed.held).toBeNull();
    expect(unkeyed.rank).toBe(100);
    expect(unkeyed.canManageMembers).toBe(true);

    const keyed = resolveRosterActorAuthority(
      {
        side: "staff",
        credential: "api_key",
        keyCapabilities: ["project:read"],
        authority: instanceAuthority,
      },
      {
        workspaceId: "w1",
        projectId: "p1",
        ancestorProjectIds: [],
        isInstanceAdmin: true,
      },
    );
    expect(keyed.held?.has("project:manage_members")).toBe(false);
    expect(keyed.canManageMembers).toBe(false);
  });
});
