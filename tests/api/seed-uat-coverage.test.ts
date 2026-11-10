import { reaches } from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import {
  UAT_ACCOUNTS,
  uatPasswordReadiness,
  uatProjectRosterIncludes,
} from "../../apps/api/scripts/seed-uat-users";

describe("UAT seed coverage", () => {
  it("leaves the viewer out of WEB while retaining the other project rosters", () => {
    const roster = (project: "SUP" | "OPS" | "WEB") =>
      UAT_ACCOUNTS.filter(
        (account) =>
          account.projectRole && uatProjectRosterIncludes(account.key, project),
      ).map((account) => account.key);
    expect(roster("SUP")).toEqual(["lead", "agent1", "agent2", "viewer"]);
    expect(roster("OPS")).toEqual(["lead", "agent1", "agent2", "viewer"]);
    expect(roster("WEB")).toEqual(["lead", "agent1", "agent2"]);
    const identity = {
      personId: "viewer",
      reach: { kind: "membership" as const },
      teamIds: [],
      memberships: (["SUP", "OPS", "WEB"] as const)
        .filter((project) => uatProjectRosterIncludes("viewer", project))
        .map((scopeId) => ({
          scope: "project" as const,
          scopeId,
          seesAll: false,
        })),
    };
    expect(
      reaches(identity, {
        projectId: "SUP",
        workspaceId: "uat",
        organisationId: "contoso",
      }),
    ).toBe(true);
    expect(
      reaches(identity, {
        projectId: "WEB",
        workspaceId: "uat",
        organisationId: "fabrikam",
      }),
    ).toBe(false);
  });

  it("reports agent and customer password configuration separately", () => {
    const row = (portalScope: string, enabled = true, scope = "instance") => ({
      pluginId: "auth.password",
      portalScope,
      enabled,
      scope,
    });
    expect(uatPasswordReadiness([])).toEqual({ agent: true, customer: false });
    expect(uatPasswordReadiness([row("agent")])).toEqual({
      agent: true,
      customer: false,
    });
    expect(uatPasswordReadiness([row("customer")])).toEqual({
      agent: true,
      customer: true,
    });
    expect(uatPasswordReadiness([row("both")])).toEqual({
      agent: true,
      customer: true,
    });
    expect(uatPasswordReadiness([row("both", false)])).toEqual({
      agent: false,
      customer: false,
    });
    expect(uatPasswordReadiness([row("customer", true, "workspace")])).toEqual({
      agent: true,
      customer: false,
    });
    expect(uatPasswordReadiness([row("none")])).toEqual({
      agent: true,
      customer: false,
    });
  });
});
