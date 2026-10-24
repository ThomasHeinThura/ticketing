import { can } from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import {
  isServicePrincipalId,
  serviceKeyCapabilities,
  servicePrincipalFromFacts,
  servicePrincipalId,
} from "../../../apps/api/src/permissions/service-principal";

const facts = (
  over: Partial<Parameters<typeof servicePrincipalFromFacts>[0]> = {},
) => ({
  apiKeyId: "key-1",
  workspaceId: "ws-1",
  capabilities: ["work_item:read", "work_item:update"],
  organisationId: "org-1",
  ...over,
});

describe("workspace service-key principal (AK-7)", () => {
  it("is a staff api_key identity anchored to its own workspace, with no person behind it", () => {
    const identity = servicePrincipalFromFacts(facts());
    expect(identity).toMatchObject({
      side: "staff",
      portal: "agent",
      credential: "api_key",
      organisationId: "org-1",
      reach: { kind: "membership" },
      teamIds: [],
    });
    expect(identity?.userId).toBe(servicePrincipalId("key-1"));
    expect(identity?.personId).toBe(identity?.userId);
    expect(isServicePrincipalId(identity?.personId ?? "")).toBe(true);
    // No project membership and no sees_all: reach beyond the workspace is never inferred.
    expect(identity?.memberships).toEqual([
      { scope: "workspace", scopeId: "ws-1", seesAll: false },
    ]);
    // Never an instance grant.
    expect(
      identity?.authority.some((grant) => grant.scope === "instance"),
    ).toBe(false);
  });

  it("holds exactly its stored subset in its own workspace and nothing in another", () => {
    const identity = servicePrincipalFromFacts(facts());
    if (!identity) throw new Error("expected an identity");
    const own = {
      workspaceId: "ws-1",
      projectId: "p-1",
      workItemProjectId: "p-1",
      ancestorProjectIds: [],
    };
    expect(can(identity, "work_item:update", "work_item", own)).toBe(true);
    expect(can(identity, "work_item:read", "work_item", own)).toBe(true);
    expect(can(identity, "work_item:delete", "work_item", own)).toBe(false);
    expect(
      can(identity, "work_item:update", "work_item", {
        ...own,
        workspaceId: "ws-2",
      }),
    ).toBe(false);
  });

  it("never holds an instance capability, even if one was stored", () => {
    expect(
      serviceKeyCapabilities(["instance:admin", "work_item:read", "made:up"]),
    ).toEqual(["work_item:read"]);
    const identity = servicePrincipalFromFacts(
      facts({ capabilities: ["instance:admin"] }),
    );
    expect(identity?.keyCapabilities).toEqual([]);
  });

  it("holds nothing when no subset was stored", () => {
    const identity = servicePrincipalFromFacts(facts({ capabilities: null }));
    expect(identity?.keyCapabilities).toEqual([]);
    expect(identity?.authority[0]?.capabilities).toEqual([]);
  });

  it("ranks below every built-in role", () => {
    expect(servicePrincipalFromFacts(facts())?.authority[0]?.rank).toBe(0);
  });

  it("fails closed when the workspace no longer exists", () => {
    expect(
      servicePrincipalFromFacts(facts({ organisationId: null })),
    ).toBeNull();
    expect(servicePrincipalFromFacts(facts({ workspaceId: "" }))).toBeNull();
  });

  it("uses an id no real person id can equal", () => {
    expect(servicePrincipalId("abc")).toBe("service-key:abc");
    expect(isServicePrincipalId("clxyz123")).toBe(false);
  });
});
