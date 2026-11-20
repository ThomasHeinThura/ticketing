import { describe, expect, it } from "vitest";
import { settingsHistoryResponseSchema } from "../../../apps/api/src/audit/response";
import { entityHistoryRow } from "../../../apps/api/src/audit/settings-history";

const at = "2026-11-17T00:00:00.000Z";
function project(action: string, before: unknown, after: unknown) {
  return entityHistoryRow(
    { createdAt: at, actorType: "person", action, before, after },
    "Ada",
  );
}

describe("P1 closed settings history projection", () => {
  it("shows only effective automation snapshot field names", () => {
    const row = project(
      "automation.updated",
      {
        name: "old",
        conditions: { b: 2, a: 1 },
        effectiveRoleId: "role-1",
        secret: "old",
      },
      {
        name: "new",
        conditions: { a: 1, b: 2 },
        effectiveRoleId: "role-1",
        secret: "new",
      },
    );
    expect(row.changedFields).toEqual(["name"]);
    expect(JSON.stringify(row)).not.toContain("new");
    expect(JSON.stringify(row)).not.toContain("secret");
    expect(
      project("automation.created", null, { name: "private", enabled: false })
        .changedFields,
    ).toEqual([]);
    expect(
      project("automation.enabled", null, { enabled: true, url: "private" })
        .changedFields,
    ).toEqual(["enabled"]);
    expect(
      project("automation.disabled", null, { reason: "private" }).changedFields,
    ).toEqual([]);
  });

  it("uses WIP, activity and cost labels only where snapshots prove them", () => {
    expect(
      project("state.wip_limit_changed", { wipLimit: 2 }, { wipLimit: 3 })
        .changedFields,
    ).toEqual(["wipLimit"]);
    expect(
      project("state.wip_limit_changed", { wipLimit: 2 }, { wipLimit: 2 })
        .changedFields,
    ).toEqual([]);
    expect(
      project("time_activity.created", null, { name: "Private" }).changedFields,
    ).toEqual(["name"]);
    expect(
      project(
        "time_activity.updated",
        { name: "Same", archived: false },
        { name: "Same", archived: false },
      ).changedFields,
    ).toEqual([]);
    expect(
      project(
        "time_activity.updated",
        { name: "Same", archived: false },
        { name: "Same", archived: true, position: 3 },
      ).changedFields,
    ).toEqual(["archived"]);
    expect(
      project("cost_type.created", null, {
        name: "Private",
        unit: "h",
        currency: "USD",
        billable: true,
        hasDefaultRate: false,
        rate: 123,
      }).changedFields,
    ).toEqual(["name", "unit", "currency", "billable", "hasDefaultRate"]);
    expect(
      project(
        "cost_type.updated",
        { name: "Same", archived: false },
        { name: "Same", archived: false, defaultRateChanged: true },
      ).changedFields,
    ).toEqual([]);
  });

  it("never emits rate, budget, person or date values", () => {
    const rate = project("hourly_rate.created", null, {
      rateSet: true,
      personId: "private",
      effectiveFrom: "private",
      currency: "USD",
    });
    const budget = project("budget.created", null, {
      name: "private",
      plannedAmountMinor: 123,
      currency: "USD",
    });
    expect(rate.changedFields).toEqual(["rateSet"]);
    expect(budget.changedFields).toEqual([]);
    expect(
      settingsHistoryResponseSchema.safeParse({
        entityType: "hourly_rate",
        entityId: "r1",
        lastChanged: { at, actor: rate.actor },
        rows: [rate],
      }).success,
    ).toBe(true);
    expect(
      settingsHistoryResponseSchema.safeParse({
        entityType: "budget",
        entityId: "b1",
        lastChanged: { at, actor: budget.actor },
        rows: [budget],
      }).success,
    ).toBe(true);
    expect(JSON.stringify({ rate, budget })).not.toContain("private");
    expect(JSON.stringify({ rate, budget })).not.toContain("123");
  });
});
