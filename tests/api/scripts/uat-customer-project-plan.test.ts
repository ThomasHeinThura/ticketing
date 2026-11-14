import { describe, expect, it } from "vitest";
import { customerProjectSeedPlan } from "../../../apps/api/scripts/uat-customer-project-plan";
import {
  G1_ACCOUNTS,
  G1_AUTOMATIONS,
  G1_PROJECT_IDS,
  G1_PROJECT_MANAGERS,
  G1_SERVICE_STATES,
  g1StaffProjects,
} from "../../../apps/api/scripts/uat-seed-plan";

describe("clean-install demo plan", () => {
  it("covers every staff role and assigns one PM to each project", () => {
    expect(
      new Set(
        G1_ACCOUNTS.flatMap((a) => (a.workspaceRole ? [a.workspaceRole] : [])),
      ),
    ).toEqual(
      new Set(["owner", "admin", "manager", "lead", "member", "viewer"]),
    );
    expect(G1_PROJECT_MANAGERS.map((p) => p.projectId)).toEqual([
      ...G1_PROJECT_IDS,
    ]);
    for (const id of G1_PROJECT_IDS)
      expect(
        G1_PROJECT_MANAGERS.filter((p) => p.projectId === id),
      ).toHaveLength(1);
    expect(g1StaffProjects("viewer")).toEqual(["uat-proj-web"]);
    expect(g1StaffProjects("lead")).not.toContain("uat-proj-contoso-managed");
    expect(g1StaffProjects("agent1")).not.toContain("uat-proj-itops");
  });
  it("separates customer engagements and organisations", () => {
    const grants = customerProjectSeedPlan({
      accounts: G1_ACCOUNTS.map((row) => ({
        ...row,
        personId: `uat-person-${row.key}`,
      })),
      supportProjectId: "uat-proj-support",
      secondContosoProjectId: "uat-proj-contoso-managed",
      fabrikamProjectId: "uat-proj-web",
    });
    const projects = (key: string) =>
      grants
        .filter((g) => g.personId === `uat-person-${key}`)
        .map((g) => g.projectId);
    expect(projects("contoso1")).toEqual(["uat-proj-support"]);
    expect(projects("contoso2")).toEqual(["uat-proj-contoso-managed"]);
    expect(projects("contoso3")).toEqual([
      "uat-proj-support",
      "uat-proj-contoso-managed",
    ]);
    expect(projects("fabrikam1")).toEqual(["uat-proj-web"]);
    expect(projects("pending")).toEqual([]);
    expect(
      new Set(grants.map((g) => `${g.personId}:${g.projectId}`)).size,
    ).toBe(grants.length);
  });
  it("rejects a customer belonging to the wrong organisation", () => {
    expect(() =>
      customerProjectSeedPlan({
        accounts: G1_ACCOUNTS.map((row) => ({
          ...row,
          personId: `uat-person-${row.key}`,
          org: row.key === "contoso1" ? "fabrikam" : row.org,
        })),
        supportProjectId: "uat-proj-support",
        secondContosoProjectId: "uat-proj-contoso-managed",
        fabrikamProjectId: "uat-proj-web",
      }),
    ).toThrow("Invalid UAT customer contoso1");
  });
  it("declares the exact service statuses and both target automations", () => {
    expect(G1_SERVICE_STATES.map((s) => s.name)).toEqual([
      "New",
      "Open",
      "Waiting on customer",
      "On hold",
      "Resolved",
      "Closed",
    ]);
    expect(G1_AUTOMATIONS.map((a) => [a.name, a.requires])).toEqual([
      [
        "A customer reply reopens a resolved item",
        "customer comment author condition",
      ],
      [
        "Resolved items close after 3 days",
        "time-based automation trigger and resolved timestamp age condition",
      ],
    ]);
    expect(G1_AUTOMATIONS[0].definition.conditions).toContainEqual({
      field: "actor_role",
      op: "eq",
      value: "customer",
    });
    expect(G1_AUTOMATIONS[1].definition.conditions).toContainEqual({
      field: "age",
      op: "gte",
      value: 4320,
      basis: "resolved_at",
    });
  });
});
