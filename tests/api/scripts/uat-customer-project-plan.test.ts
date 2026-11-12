import { describe, expect, it } from "vitest";
import {
  UAT_ACCOUNTS,
  uatCustomerEngagementSeedPlan,
  uatCustomerProjectSeedPlan,
} from "../../../apps/api/scripts/seed-uat-users";
import {
  customerProjectSeedPlan,
  UAT_SECOND_CONTOSO_PROJECT_ID,
} from "../../../apps/api/scripts/uat-customer-project-plan";

describe("UAT customer project seed plan", () => {
  it("assigns the intended engagements and retains the explicit shared Support assignment", () => {
    const plan = uatCustomerProjectSeedPlan();
    const engagements = uatCustomerEngagementSeedPlan();
    const person = (key: string) =>
      UAT_ACCOUNTS.find((row) => row.key === key)?.personId;
    expect(plan).toEqual([
      { personId: person("contoso1"), projectId: "uat-proj-support" },
      { personId: person("contoso2"), projectId: "uat-proj-support" },
      {
        personId: person("contoso2"),
        projectId: UAT_SECOND_CONTOSO_PROJECT_ID,
      },
      { personId: person("fabrikam1"), projectId: "uat-proj-web" },
    ]);
    expect(person("contoso1")).toBeTruthy();
    expect(person("contoso2")).not.toBe(person("contoso1"));
    expect(
      engagements
        .filter((row) => row.organisation === "contoso")
        .map((row) => row.projectId),
    ).toEqual(["uat-proj-support", UAT_SECOND_CONTOSO_PROJECT_ID]);
    for (const grant of plan) {
      const account = UAT_ACCOUNTS.find(
        (row) => row.personId === grant.personId,
      );
      const engagement = engagements.find(
        (row) => row.projectId === grant.projectId,
      );
      expect(account?.org).toBe(engagement?.organisation);
    }
    expect(
      new Set(plan.map((row) => `${row.personId}:${row.projectId}`)).size,
    ).toBe(plan.length);
  });
  it("rejects a customer account from the wrong organisation", () => {
    expect(() =>
      customerProjectSeedPlan({
        accounts: UAT_ACCOUNTS.map((row) =>
          row.key === "contoso1" ? { ...row, org: "fabrikam" } : row,
        ),
        supportProjectId: "p1",
        secondContosoProjectId: "p2",
        fabrikamProjectId: "p3",
      }),
    ).toThrow("Invalid UAT customer contoso1");
  });
});
