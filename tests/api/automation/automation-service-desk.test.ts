import { describe, expect, it } from "vitest";
import {
  type ConditionFacts,
  evaluateCondition,
} from "../../../apps/api/src/automation/conditions";
import { scheduleDue } from "../../../apps/api/src/automation/schedule";
import { validateRuleDefinition } from "../../../apps/api/src/automation/validation";

describe("service desk automation vocabulary", () => {
  it("accepts both target rules and fails closed without the scheduler", () => {
    const scheduled = {
      trigger: "schedule",
      scheduleCron: "0 * * * *",
      conditions: [
        { field: "state.group", op: "eq", value: "completed" },
        { field: "age", op: "gte", value: 4320, basis: "resolved_at" },
      ],
      actions: [{ type: "transition", toStateTemplateId: "closed" }],
    };
    expect(validateRuleDefinition(scheduled).ok).toBe(false);
    expect(
      validateRuleDefinition(scheduled, { scheduleAvailable: true }).ok,
    ).toBe(true);
    const reply = {
      trigger: "work_item.commented",
      conditions: [{ field: "actor_role", op: "eq", value: "customer" }],
      actions: [{ type: "transition", toStateTemplateId: "open" }],
    };
    expect(validateRuleDefinition(reply).ok).toBe(true);
    expect(
      validateRuleDefinition({ ...reply, trigger: "work_item.updated" }).ok,
    ).toBe(false);
    expect(
      validateRuleDefinition({
        ...reply,
        conditions: [{ field: "actor_role", op: "eq", value: "admin" }],
      }).ok,
    ).toBe(false);
  });
  it("requires an authoritative customer fact", () => {
    for (const fact of [undefined, false, true])
      expect(
        evaluateCondition(
          { field: "actor_role", op: "eq", value: "customer" },
          {
            now: new Date(),
            customerAuthoredComment: fact,
            commentVisibility: "public",
          },
        ),
      ).toBe(fact === true);
  });
  it("uses resolved entry time, independent of updated time, failing closed when absent", () => {
    const now = new Date("2026-11-12T12:00:00Z");
    const item: NonNullable<ConditionFacts["workItem"]> = {
      typeKey: "task",
      stateKey: "resolved",
      stateGroup: "completed",
      priority: null,
      assigneeId: null,
      requesterId: null,
      organisationId: null,
      projectKey: "svc",
      labels: [],
      createdAt: new Date("2026-11-01T12:00:00Z"),
      updatedAt: now,
    };
    for (const days of [undefined, 2, 3])
      expect(
        evaluateCondition(
          { field: "age", op: "gte", value: 4320, basis: "resolved_at" },
          {
            now,
            workItem: {
              ...item,
              resolvedAt: days
                ? new Date(now.getTime() - days * 86400000)
                : null,
            },
          },
        ),
      ).toBe(days === 3);
  });
  it("checks only the current UTC minute without downtime catch-up", () => {
    expect(scheduleDue("0 * * * *", new Date("2026-11-12T12:00:32Z"))).toBe(
      true,
    );
    expect(scheduleDue("0 * * * *", new Date("2026-11-12T12:01:00Z"))).toBe(
      false,
    );
    expect(scheduleDue("*/5 * * * *", new Date("2026-11-12T12:05:00Z"))).toBe(
      true,
    );
  });
});
