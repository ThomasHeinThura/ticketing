import { describe, expect, it, vi } from "vitest";
import {
  type ConditionFacts,
  evaluateCondition,
} from "../../../apps/api/src/automation/conditions";
import {
  scheduleDue,
  scheduleOccurrence,
} from "../../../apps/api/src/automation/schedule";
import {
  scheduleMinimumGap,
  validateRuleDefinition,
} from "../../../apps/api/src/automation/validation";

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
  it("catches up once when the tick misses the exact minute", () => {
    expect(scheduleDue("0 * * * *", new Date("2026-11-12T12:00:32Z"))).toBe(
      true,
    );
    expect(scheduleDue("0 * * * *", new Date("2026-11-12T12:01:00Z"))).toBe(
      true,
    );
    expect(scheduleDue("*/5 * * * *", new Date("2026-11-12T12:05:00Z"))).toBe(
      true,
    );
  });
  it("refuses frequent expressions and accepts the presets", () => {
    for (const [scheduleCron, expected] of [
      ["* * * * *", false],
      ["0 0 30 2 *", false],
      ["0 0 31 2 *", false],
      ["0 0 29 2 *", true],
      ["0,59 0,23 1 1 *", true],
      ["58,0 * * * *", false],
      ["0,59 0,23 1,31 1,12 *", false],
      ["1,4 * * * *", false],
      ["*/5 * * * *", true],
      ["0 * * * *", true],
      ["0 0 * * *", true],
    ] as const) {
      expect(
        validateRuleDefinition(
          {
            trigger: "schedule",
            scheduleCron,
            conditions: [],
            actions: [{ type: "transition", toStateTemplateId: "closed" }],
          },
          { scheduleAvailable: true },
        ).ok,
      ).toBe(expected);
    }
  });
  it.each([1, 2, 5])(
    "250 daily rules remain due with %i minute ticks",
    (cadence) => {
      const last = Array<Date | undefined>(250).fill(undefined);
      const counts = Array<number>(250).fill(0);
      for (let tick = 0; tick < 9; tick++) {
        const now = new Date(Date.UTC(2026, 10, 12, 0, 1 + tick * cadence));
        for (
          let i = (tick % 3) * 100;
          i < Math.min(((tick % 3) + 1) * 100, 250);
          i++
        ) {
          if (scheduleDue("0 0 * * *", now, last[i])) {
            counts[i] = (counts[i] ?? 0) + 1;
            last[i] = scheduleOccurrence("0 0 * * *", now) ?? undefined;
          }
        }
      }
      expect(counts.every((c) => c === 1)).toBe(true);
    },
  );
});

it("due computation never throws for impossible dates", () => {
  expect(scheduleOccurrence("0 0 31 2 *", new Date())).toBeNull();
  expect(scheduleOccurrence("invalid", new Date())).toBeNull();
});

it("interval validation has a fixed bound independent of occurrence count", () => {
  let reads = 0;
  const field = new Proxy(Array<number>(100000).fill(1), {
    get(target, key, receiver) {
      reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  expect(scheduleMinimumGap({ hour: field, minute: field })).toBe(1);
  expect(reads).toBeLessThanOrEqual(2880);
});

it("finds the last leap-day occurrence with a bounded forward fallback", () => {
  expect(
    scheduleOccurrence(
      "0 0 29 2 *",
      new Date("2030-01-01T00:00:00Z"),
    )?.toISOString(),
  ).toBe("2028-02-29T00:00:00.000Z");
});

it.each(["0 * 29 2 *", "0 0 31 */2 *"])(
  "refuses a cron unavailable within the shared occurrence search bound: %s",
  (scheduleCron) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
      expect(scheduleOccurrence(scheduleCron, new Date())).toBeNull();
      expect(scheduleDue(scheduleCron, new Date())).toBe(false);
      const result = validateRuleDefinition(
        {
          trigger: "schedule",
          scheduleCron,
          conditions: [],
          actions: [{ type: "transition", toStateTemplateId: "closed" }],
        },
        { scheduleAvailable: true },
      );
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.problems).toContainEqual({
          code: "invalid",
          path: "scheduleCron",
          message:
            "a valid five-field cron expression is required for the schedule trigger",
        });
    } finally {
      vi.useRealTimers();
    }
  },
);
