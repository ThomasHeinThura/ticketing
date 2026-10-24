import type { RoleGrant } from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import {
  callerRank,
  type EffectiveRole,
  roleCapabilitiesMissing,
  roleIsUsableForWorkspace,
  roleMayAct,
  roleWithinCallerAuthority,
  roleWithinCallerRank,
} from "../../../apps/api/src/automation/effective-role";
import {
  isVisibleTo,
  type ReaderVisibility,
} from "../../../apps/api/src/automation/visibility";

/**
 * `AM-3`: a rule acts as its effective role and cannot exceed it; the role may not outrank the
 * person who chose it. These are the pure decisions; the executor and the routes apply them.
 */

const grant = (over: Partial<RoleGrant>): RoleGrant => ({
  roleKey: "r",
  scope: "workspace",
  scopeId: "ws1",
  rank: 10,
  capabilities: [],
  ...over,
});

const role = (over: Partial<EffectiveRole> = {}): EffectiveRole => ({
  id: "role_1",
  key: "automation-agent",
  name: "Automation agent",
  scope: "workspace",
  workspaceId: "ws1",
  rank: 50,
  capabilities: ["work_item:read", "work_item:assign"],
  ...over,
});

describe("callerRank", () => {
  it("counts instance, this workspace and (for a project rule) this project", () => {
    const authority = [
      grant({ scope: "instance", scopeId: null, rank: 1000 }),
      grant({ scope: "workspace", scopeId: "ws1", rank: 60 }),
      grant({ scope: "project", scopeId: "p1", rank: 80 }),
    ];
    expect(callerRank({ authority }, "ws1", null)).toBe(1000);
    expect(callerRank({ authority: authority.slice(1) }, "ws1", null)).toBe(60);
    expect(callerRank({ authority: authority.slice(1) }, "ws1", "p1")).toBe(80);
  });

  it("ignores another workspace and another project", () => {
    const authority = [
      grant({ scope: "workspace", scopeId: "ws2", rank: 90 }),
      grant({ scope: "project", scopeId: "p2", rank: 90 }),
      grant({ scope: "workspace", scopeId: "ws1", rank: 20 }),
    ];
    expect(callerRank({ authority }, "ws1", "p1")).toBe(20);
  });

  it("is zero for someone who holds nothing here", () => {
    expect(callerRank({ authority: [] }, "ws1", null)).toBe(0);
  });
});

describe("roleWithinCallerRank", () => {
  const authority = [grant({ scope: "workspace", scopeId: "ws1", rank: 60 })];

  it("allows a role at or below the caller's own rank, never above", () => {
    expect(
      roleWithinCallerRank(role({ rank: 59 }), { authority }, "ws1", null),
    ).toBe(true);
    expect(
      roleWithinCallerRank(role({ rank: 60 }), { authority }, "ws1", null),
    ).toBe(true);
    expect(
      roleWithinCallerRank(role({ rank: 61 }), { authority }, "ws1", null),
    ).toBe(false);
  });
});

describe("roleIsUsableForWorkspace", () => {
  it("accepts only a workspace-scope role of this workspace", () => {
    expect(roleIsUsableForWorkspace(role(), "ws1")).toBe(true);
    expect(roleIsUsableForWorkspace(role({ workspaceId: "ws2" }), "ws1")).toBe(
      false,
    );
    expect(roleIsUsableForWorkspace(role({ scope: "project" }), "ws1")).toBe(
      false,
    );
    expect(
      roleIsUsableForWorkspace(
        role({ scope: "instance", workspaceId: null }),
        "ws1",
      ),
    ).toBe(false);
  });
});

describe("roleMayAct: the rule never exceeds its role", () => {
  const target = { workspaceId: "ws1", projectId: "p1" };

  it("allows what the role holds and refuses what it does not", () => {
    expect(roleMayAct(role(), "work_item:assign", target)).toBe(true);
    expect(roleMayAct(role(), "work_item:read", target)).toBe(true);
    expect(roleMayAct(role(), "work_item:set_priority", target)).toBe(false);
    expect(roleMayAct(role(), "work_item:update", target)).toBe(false);
  });

  it("refuses everything for a role with no capabilities", () => {
    expect(
      roleMayAct(role({ capabilities: [] }), "work_item:read", target),
    ).toBe(false);
  });

  it("does not carry a role's authority into another workspace", () => {
    expect(
      roleMayAct(role(), "work_item:assign", {
        workspaceId: "ws2",
        projectId: "p9",
      }),
    ).toBe(false);
  });

  it("ignores a capability string this build does not know", () => {
    expect(
      roleMayAct(
        role({ capabilities: ["work_item:teleport"] }),
        "work_item:read",
        target,
      ),
    ).toBe(false);
  });
});

describe("history and dry-run visibility", () => {
  const visibility: ReaderVisibility = {
    projectIds: new Set(["p1"]),
    everything: false,
  };

  it("shows only projects the reader reaches", () => {
    expect(isVisibleTo(visibility, "p1")).toBe(true);
    expect(isVisibleTo(visibility, "p2")).toBe(false);
  });

  it("shows an event with no project only to a reader who sees everything", () => {
    expect(isVisibleTo(visibility, null)).toBe(false);
    expect(isVisibleTo({ projectIds: new Set(), everything: true }, null)).toBe(
      true,
    );
    expect(isVisibleTo({ projectIds: new Set(), everything: true }, "p2")).toBe(
      true,
    );
  });
});

describe("roleWithinCallerAuthority (rank and capability subset)", () => {
  const author = [
    grant({
      rank: 60,
      capabilities: ["work_item:read", "work_item:assign"],
    }),
  ];
  it("allows a role at or below rank holding only what the author holds", () => {
    const r = role({ rank: 40, capabilities: ["work_item:read"] });
    expect(
      roleWithinCallerAuthority(r, { authority: author }, "ws1", null),
    ).toEqual({ ok: true });
  });
  it("refuses a lower-ranked role with a capability the author lacks", () => {
    const r = role({
      rank: 40,
      capabilities: ["work_item:read", "work_item:delete"],
    });
    expect(
      roleWithinCallerAuthority(r, { authority: author }, "ws1", null),
    ).toEqual({ ok: false, reason: "capabilities" });
    expect(
      roleCapabilitiesMissing(r, { authority: author }, "ws1", null),
    ).toContain("work_item:delete");
  });
  it("reports rank first when the role outranks the author", () => {
    const r = role({ rank: 80, capabilities: [] });
    expect(
      roleWithinCallerAuthority(r, { authority: author }, "ws1", null),
    ).toEqual({ ok: false, reason: "rank" });
  });
  it("ignores grants from another workspace", () => {
    const r = role({ rank: 10, capabilities: ["work_item:read"] });
    expect(
      roleWithinCallerAuthority(
        r,
        {
          authority: [
            grant({
              scopeId: "ws2",
              rank: 60,
              capabilities: ["work_item:read"],
            }),
          ],
        },
        "ws1",
        null,
      ).ok,
    ).toBe(false);
  });
});
