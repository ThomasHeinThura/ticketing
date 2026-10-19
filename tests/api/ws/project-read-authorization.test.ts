import type { ResolvedIdentity } from "@taskdesk/permissions";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ workspaceId: string; organisationId: string | null }>,
  resolveIdentity: vi.fn(),
  evaluateProjectRead: vi.fn(),
  findReachableLiveProject: vi.fn(),
}));

vi.mock("../../../apps/api/src/permissions/resolve-identity", () => ({
  resolveIdentity: mocks.resolveIdentity,
}));
vi.mock("../../../apps/api/src/utils/has-project-reach", () => ({
  evaluateProjectRead: mocks.evaluateProjectRead,
}));
vi.mock("../../../apps/api/src/ws/repository", () => ({
  findReachableLiveProject: mocks.findReachableLiveProject,
}));

import { authorizeProjectSocketRead } from "../../../apps/api/src/ws/project-read-authorization";

const identity: ResolvedIdentity = {
  userId: "u1",
  personId: "person-1",
  side: "staff",
  organisationId: "org-staff",
  portal: "agent",
  credential: "session",
  memberships: [{ scope: "workspace", scopeId: "ws-1", seesAll: false }],
  teamIds: [],
  reach: { kind: "membership" },
  authority: [
    {
      roleKey: "member",
      scope: "workspace",
      scopeId: "ws-1",
      rank: 40,
      capabilities: ["project:read"],
    },
  ],
};

describe("authorizeProjectSocketRead decision inputs (#748)", () => {
  beforeEach(() => {
    mocks.rows = [{ workspaceId: "ws-1", organisationId: "org-customer" }];
    mocks.resolveIdentity.mockReset().mockResolvedValue(identity);
    mocks.findReachableLiveProject
      .mockReset()
      .mockImplementation(async () => mocks.rows[0]);
    mocks.evaluateProjectRead
      .mockReset()
      .mockReturnValue({ reachable: true, capable: true });
  });

  it("asks the read check about the PROJECT row's organisation, workspace and project id", async () => {
    await expect(
      authorizeProjectSocketRead({ userId: "u1" }, "p1"),
    ).resolves.toEqual({ projectId: "p1", workspaceId: "ws-1" });
    expect(mocks.findReachableLiveProject).toHaveBeenCalledWith(identity, "p1");
    expect(mocks.evaluateProjectRead).toHaveBeenCalledWith(
      identity,
      "project:read",
      "project",
      {
        projectId: "p1",
        workspaceId: "ws-1",
        organisationId: "org-customer",
        ancestorProjectIds: [],
        ownerTeamId: null,
      },
    );
  });

  it("passes a project with no customer organisation as null, never a guessed value", async () => {
    mocks.rows = [{ workspaceId: "ws-1", organisationId: null }];
    await authorizeProjectSocketRead({ userId: "u1" }, "p1");
    expect(mocks.evaluateProjectRead.mock.calls[0]?.[3]).toMatchObject({
      organisationId: null,
    });
  });

  it("refuses when either reach or capability is missing", async () => {
    for (const decision of [
      { reachable: false, capable: true },
      { reachable: true, capable: false },
      null,
    ]) {
      mocks.evaluateProjectRead.mockReturnValue(decision);
      await expect(
        authorizeProjectSocketRead({ userId: "u1" }, "p1"),
      ).resolves.toBeNull();
    }
  });

  it("resolves a session, an impersonation and a key credential as their own kinds", async () => {
    await authorizeProjectSocketRead({ userId: "u1" }, "p1");
    await authorizeProjectSocketRead(
      { userId: "u1", impersonated: true },
      "p1",
    );
    await authorizeProjectSocketRead(
      {
        userId: "u1",
        apiKeyId: "k1",
        apiKeyEnabled: true,
        apiKeyOwnerUserId: "u1",
        apiKeyPermissions: { project: ["read"], work_item: ["read"] },
      },
      "p1",
    );
    const calls = mocks.resolveIdentity.mock.calls.map(([input]) => input);
    expect(calls[0]).toEqual({ userId: "u1", credential: "session" });
    expect(calls[1]).toEqual({ userId: "u1", credential: "impersonation" });
    expect(calls[2]).toMatchObject({
      credential: "api_key",
      apiKey: {
        enabled: true,
        ownerUserId: "u1",
        capabilities: ["project:read", "work_item:read"],
      },
    });
    expect(mocks.findReachableLiveProject).toHaveBeenCalledWith(identity, "p1");
  });

  it("never reaches the capability check for a missing project or identity", async () => {
    mocks.rows = [];
    await expect(
      authorizeProjectSocketRead({ userId: "u1" }, "p1"),
    ).resolves.toBeNull();
    mocks.rows = [{ workspaceId: "ws-1", organisationId: null }];
    mocks.resolveIdentity.mockResolvedValue(null);
    mocks.findReachableLiveProject.mockClear();
    await expect(
      authorizeProjectSocketRead({ userId: "u1" }, "p1"),
    ).resolves.toBeNull();
    expect(mocks.evaluateProjectRead).not.toHaveBeenCalled();
    expect(mocks.findReachableLiveProject).not.toHaveBeenCalled();
  });
});
