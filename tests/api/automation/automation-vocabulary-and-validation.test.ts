import { describe, expect, it } from "vitest";
import {
  BUILTIN_ACTION_TYPES,
  FORBIDDEN_ACTION_PATTERN,
  parseAction,
  requiredCapability,
  UNAVAILABLE_ACTION_TYPES,
} from "../../../apps/api/src/automation/actions";
import {
  DRY_RUN_CANDIDATE_CAP,
  DRY_RUN_DEFAULT_WINDOW_DAYS,
  DRY_RUN_MAX_WINDOW_DAYS,
} from "../../../apps/api/src/automation/constants";
import {
  clampWindowDays,
  ruleCoversProject,
} from "../../../apps/api/src/automation/dry-run";
import {
  expandPlaceholders,
  REDACTED,
  validatePlaceholders,
} from "../../../apps/api/src/automation/placeholders";
import { validateRuleDefinition } from "../../../apps/api/src/automation/validation";

const AVAILABLE = new Set<string>(BUILTIN_ACTION_TYPES);

describe("AM-13 there is no delete action", () => {
  it("has no delete, purge or archive member in either vocabulary", () => {
    for (const type of [...BUILTIN_ACTION_TYPES, ...UNAVAILABLE_ACTION_TYPES])
      expect(FORBIDDEN_ACTION_PATTERN.test(type), type).toBe(false);
  });

  it.each([
    "delete",
    "delete_work_item",
    "purge",
    "archive",
    "archive_and_purge",
    "destroy",
    "remove_work_item",
    "erase",
    "wipe",
  ])("refuses %s as invalid, never as 'not available yet'", (type) => {
    const parsed = parseAction({ type }, 0, AVAILABLE);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.problem.code).toBe("invalid");
  });

  it("refuses a delete action even if an executor claimed to handle it", () => {
    const parsed = parseAction(
      { type: "delete_work_item" },
      0,
      new Set(["delete_work_item"]),
    );
    expect(parsed.ok).toBe(false);
  });

  it("rejects it through the rule validator too", () => {
    const result = validateRuleDefinition({
      trigger: "work_item.created",
      conditions: [],
      actions: [{ type: "delete" }],
    });
    expect(result.ok).toBe(false);
  });
});

describe("action parsing", () => {
  it("accepts the supported actions with their parameters", () => {
    expect(
      parseAction({ type: "assign", assigneeId: "p1" }, 0, AVAILABLE).ok,
    ).toBe(true);
    expect(
      parseAction({ type: "set_priority", priority: "high" }, 0, AVAILABLE).ok,
    ).toBe(true);
    expect(
      parseAction({ type: "set_priority", priority: null }, 0, AVAILABLE).ok,
    ).toBe(true);
    expect(
      parseAction({ type: "set_due_date", dueInDays: 3 }, 0, AVAILABLE).ok,
    ).toBe(true);
    expect(
      parseAction({ type: "add_label", labelId: "l1" }, 0, AVAILABLE).ok,
    ).toBe(true);
    expect(
      parseAction({ type: "add_watcher", personId: "p1" }, 0, AVAILABLE).ok,
    ).toBe(true);
    expect(
      parseAction({ type: "call_webhook", webhookId: "w1" }, 0, AVAILABLE).ok,
    ).toBe(true);
  });

  it("refuses unknown fields, bad values and a missing type", () => {
    expect(
      parseAction({ type: "assign", assigneeId: "p1", extra: 1 }, 0, AVAILABLE)
        .ok,
    ).toBe(false);
    expect(
      parseAction({ type: "set_priority", priority: "critical" }, 0, AVAILABLE)
        .ok,
    ).toBe(false);
    expect(
      parseAction({ type: "set_due_date", dueInDays: -1 }, 0, AVAILABLE).ok,
    ).toBe(false);
    expect(parseAction({ type: "assign" }, 0, AVAILABLE).ok).toBe(false);
    expect(parseAction({}, 0, AVAILABLE).ok).toBe(false);
    expect(parseAction("assign", 0, AVAILABLE).ok).toBe(false);
  });

  it("names a contract action with no executor as unavailable (422), not invalid", () => {
    for (const type of UNAVAILABLE_ACTION_TYPES) {
      const parsed = parseAction({ type }, 2, AVAILABLE);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok)
        expect(parsed.problem).toMatchObject({ code: "unavailable", index: 2 });
    }
  });

  it("maps every action to the capability the effective role needs", () => {
    expect(requiredCapability({ type: "assign", assigneeId: "p" })).toBe(
      "work_item:assign",
    );
    expect(requiredCapability({ type: "set_priority", priority: null })).toBe(
      "work_item:set_priority",
    );
    expect(requiredCapability({ type: "add_label", labelId: "l" })).toBe(
      "work_item:update",
    );
    expect(requiredCapability({ type: "call_webhook", webhookId: "w" })).toBe(
      "work_item:read",
    );
  });
});

describe("rule validation", () => {
  const ok = {
    trigger: "work_item.created",
    conditions: [{ field: "type", op: "eq", value: "incident" }],
    actions: [{ type: "assign", assigneeId: "p1" }],
  };

  it("accepts a valid rule", () => {
    const result = validateRuleDefinition(ok);
    expect(result.ok).toBe(true);
  });

  it("refuses an unknown trigger, naming the choices", () => {
    const result = validateRuleDefinition({
      ...ok,
      trigger: "work_item.deleted",
    });
    expect(result).toMatchObject({ ok: false });
  });

  it("answers 'unavailable' for the schedule trigger and for keys with no loader", () => {
    const schedule = validateRuleDefinition({
      ...ok,
      trigger: "schedule",
      scheduleCron: "* * * * *",
    });
    expect(schedule.ok).toBe(false);
    if (!schedule.ok) expect(schedule.problems[0]?.code).toBe("unavailable");
    const sla = validateRuleDefinition({
      ...ok,
      conditions: [{ field: "actor_role", op: "eq", value: "customer" }],
    });
    expect(sla.ok).toBe(false);
    if (!sla.ok)
      expect(sla.problems[0]).toMatchObject({
        code: "unavailable",
        path: "conditions[0].field",
      });
  });

  it("validates the schedule cron when the trigger is available", () => {
    expect(
      validateRuleDefinition(
        { ...ok, trigger: "schedule", scheduleCron: "*/5 * * * *" },
        { scheduleAvailable: true },
      ).ok,
    ).toBe(true);
    expect(
      validateRuleDefinition(
        { ...ok, trigger: "schedule", scheduleCron: "not a cron" },
        { scheduleAvailable: true },
      ).ok,
    ).toBe(false);
    expect(
      validateRuleDefinition({ ...ok, scheduleCron: "* * * * *" }).ok,
    ).toBe(false);
  });

  it("checks operators and values per field", () => {
    for (const bad of [
      { field: "priority", op: "gt", value: "critical" },
      { field: "type", op: "gt", value: "x" },
      { field: "age", op: "gte", value: -1 },
      { field: "state.group", op: "eq", value: "doing" },
      { field: "assignee", op: "in", value: [] },
      { field: "comment_visibility", op: "eq", value: "secret" },
      { field: "type", op: "eq", value: "x", surprise: true },
    ]) {
      expect(
        validateRuleDefinition({ ...ok, conditions: [bad] }).ok,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it("requires at least one action and bounds the lists", () => {
    expect(validateRuleDefinition({ ...ok, actions: [] }).ok).toBe(false);
    expect(
      validateRuleDefinition({
        ...ok,
        actions: Array.from({ length: 11 }, () => ({
          type: "assign",
          assigneeId: "p",
        })),
      }).ok,
    ).toBe(false);
  });

  it("de-duplicates a project filter and refuses an empty one", () => {
    const filtered = validateRuleDefinition({
      ...ok,
      projectFilter: ["a", "a", "b"],
    });
    expect(filtered.ok && filtered.value.projectFilter).toEqual(["a", "b"]);
    expect(validateRuleDefinition({ ...ok, projectFilter: [] }).ok).toBe(false);
  });
});

describe("AM-9 dry-run bounds", () => {
  it("defaults to 7 days and clamps to 1..30", () => {
    expect(DRY_RUN_DEFAULT_WINDOW_DAYS).toBe(7);
    expect(DRY_RUN_MAX_WINDOW_DAYS).toBe(30);
    expect(DRY_RUN_CANDIDATE_CAP).toBe(1_000);
    expect(clampWindowDays(undefined)).toBe(7);
    expect(clampWindowDays(0)).toBe(1);
    expect(clampWindowDays(-5)).toBe(1);
    expect(clampWindowDays(45)).toBe(30);
    expect(clampWindowDays(12.9)).toBe(12);
    expect(clampWindowDays(Number.NaN)).toBe(7);
  });

  it("applies the project rule and the workspace rule's project filter", () => {
    expect(
      ruleCoversProject({ projectId: "p1", projectFilter: null }, "p1"),
    ).toBe(true);
    expect(
      ruleCoversProject({ projectId: "p1", projectFilter: null }, "p2"),
    ).toBe(false);
    expect(
      ruleCoversProject({ projectId: null, projectFilter: null }, null),
    ).toBe(true);
    expect(
      ruleCoversProject({ projectId: null, projectFilter: ["p1"] }, "p1"),
    ).toBe(true);
    expect(
      ruleCoversProject({ projectId: null, projectFilter: ["p1"] }, "p2"),
    ).toBe(false);
    expect(
      ruleCoversProject({ projectId: null, projectFilter: ["p1"] }, null),
    ).toBe(false);
  });
});

describe("AM-11 placeholder visibility", () => {
  it("refuses a staff-only placeholder in a customer-visible destination, naming it", () => {
    const { problems, placeholders } = validatePlaceholders(
      "Hi {{requester.name}}, assigned to {{assignee.email}}",
      "customer",
    );
    expect(problems).toEqual([
      {
        path: "assignee.email",
        reason: "staff-only value in a customer-visible destination",
      },
    ]);
    expect(placeholders.map((p) => p.visibility)).toEqual(["public", "staff"]);
  });

  it("allows the same placeholder in a staff-only destination", () => {
    expect(
      validatePlaceholders("{{assignee.email}}", "staff").problems,
    ).toEqual([]);
  });

  it("refuses an unknown placeholder rather than rendering it empty", () => {
    expect(
      validatePlaceholders("{{work_item.secret}}", "staff").problems[0]?.path,
    ).toBe("work_item.secret");
    expect(validatePlaceholders("{{cf.cost}}", "staff").problems).toHaveLength(
      1,
    );
  });

  it("redacts at execution a value that is staff-only for the destination", () => {
    const values = { "work_item.key": "SUP-1", "assignee.email": "a@x.test" };
    expect(
      expandPlaceholders(
        "{{work_item.key}} {{assignee.email}}",
        values,
        "customer",
      ),
    ).toBe(`SUP-1 ${REDACTED}`);
    expect(
      expandPlaceholders(
        "{{work_item.key}} {{assignee.email}}",
        values,
        "staff",
      ),
    ).toBe("SUP-1 a@x.test");
    expect(expandPlaceholders("{{unknown.path}}", values, "staff")).toBe(
      REDACTED,
    );
    expect(expandPlaceholders("{{work_item.title}}", values, "staff")).toBe("");
  });
});
