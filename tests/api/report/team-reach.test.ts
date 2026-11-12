import { type ResolvedIdentity, reaches } from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import { canReadAllTeams } from "../../../apps/api/src/report/team-reach";

const identity: ResolvedIdentity = {
  userId: "reporter",
  personId: "person",
  organisationId: "org",
  side: "staff",
  portal: "agent",
  credential: "session",
  memberships: [{ scope: "workspace", scopeId: "workspace-a", seesAll: true }],
  teamIds: [],
  reach: { kind: "membership_with_workspaces", workspaceIds: ["workspace-a"] },
  authority: [
    {
      roleKey: "admin",
      scope: "workspace",
      scopeId: "workspace-a",
      rank: 50,
      capabilities: ["workspace:read", "report:read", "report:read_all"],
    },
  ],
};

describe("workspace report team visibility (R6-06)", () => {
  it.each(["owner", "admin", "manager"])(
    "retains %s workspace team rights in the matching workspace only",
    (roleKey) => {
      const holder: ResolvedIdentity = {
        ...identity,
        authority: identity.authority.map((grant) => ({ ...grant, roleKey })),
      };
      expect(
        canReadAllTeams({ identity: holder, workspaceId: "workspace-a" }),
      ).toBe(true);
      expect(
        canReadAllTeams({ identity: holder, workspaceId: "workspace-b" }),
      ).toBe(false);
    },
  );
  it("keeps an ordinary read_all holder on project reach without granting metadata bypass", () => {
    const reader: ResolvedIdentity = {
      ...identity,
      reach: { kind: "membership" },
      memberships: [
        { scope: "workspace", scopeId: "workspace-a", seesAll: false },
      ],
      authority: identity.authority.map((grant) => ({
        ...grant,
        roleKey: "reporter",
      })),
    };
    expect(
      canReadAllTeams({ identity: reader, workspaceId: "workspace-a" }),
    ).toBe(false);
    expect(
      reaches(reader, {
        projectId: "hidden",
        workspaceId: "workspace-a",
        organisationId: null,
      }),
    ).toBe(false);
  });
  it("retains an explicit workspace see-all grant independently of the role name", () => {
    const holder: ResolvedIdentity = {
      ...identity,
      authority: identity.authority.map((grant) => ({
        ...grant,
        roleKey: "reporter",
      })),
    };
    expect(
      canReadAllTeams({ identity: holder, workspaceId: "workspace-a" }),
    ).toBe(true);
    expect(
      canReadAllTeams({ identity: holder, workspaceId: "workspace-b" }),
    ).toBe(false);
  });
  it("intersects an API key with its owner instead of inheriting unscoped read_all", () => {
    const key: ResolvedIdentity = {
      ...identity,
      credential: "api_key",
      keyCapabilities: ["report:read"],
    };
    expect(canReadAllTeams({ identity: key, workspaceId: "workspace-a" })).toBe(
      false,
    );
    expect(
      canReadAllTeams({
        identity: { ...key, keyCapabilities: ["report:read_all"] },
        workspaceId: "workspace-a",
      }),
    ).toBe(true);
  });
  it("keeps ordinary readers on the membership/project team filter", () => {
    expect(
      canReadAllTeams({
        identity: {
          ...identity,
          authority: identity.authority.map((grant) => ({
            ...grant,
            capabilities: ["workspace:read", "report:read"],
          })),
        },
        workspaceId: "workspace-a",
      }),
    ).toBe(false);
  });
});
