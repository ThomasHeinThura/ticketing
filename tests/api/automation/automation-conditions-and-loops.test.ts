import { describe, expect, it } from "vitest";
import {
  type AutomationCondition,
  type ConditionFacts,
  conditionFieldAvailability,
  evaluateCondition,
  evaluateConditions,
} from "../../../apps/api/src/automation/conditions";
import {
  AUTOMATION_MAX_DEPTH,
  guardAutomationTrigger,
  runAsAutomation,
} from "../../../apps/api/src/events/automation-context";
import { withAutomationContext } from "../../../apps/api/src/events/outbox";

const NOW = new Date("2026-10-23T12:00:00.000Z");

function facts(over: Partial<NonNullable<ConditionFacts["workItem"]>> = {}) {
  return {
    now: NOW,
    workItem: {
      typeKey: "incident",
      stateKey: "in_progress",
      stateGroup: "started",
      priority: "urgent",
      assigneeId: null,
      requesterId: "p_req",
      labels: ["vip"],
      organisationId: "org_1",
      projectKey: "SUP",
      createdAt: new Date(NOW.getTime() - 90 * 60_000),
      updatedAt: new Date(NOW.getTime() - 10 * 60_000),
      ...over,
    },
  } satisfies ConditionFacts;
}

const c = (condition: AutomationCondition) => condition;

describe("AM-1 conditions combine with AND", () => {
  it("matches only when every condition matches", () => {
    const f = facts();
    expect(
      evaluateConditions(
        [
          c({ field: "type", op: "eq", value: "incident" }),
          c({ field: "priority", op: "eq", value: "urgent" }),
        ],
        f,
      ).matched,
    ).toBe(true);
    expect(
      evaluateConditions(
        [
          c({ field: "type", op: "eq", value: "incident" }),
          c({ field: "priority", op: "eq", value: "low" }),
        ],
        f,
      ).matched,
    ).toBe(false);
  });

  it("an empty list always matches, and each result is reported", () => {
    expect(evaluateConditions([], facts()).matched).toBe(true);
    const out = evaluateConditions(
      [c({ field: "type", op: "ne", value: "incident" })],
      facts(),
    );
    expect(out.results).toEqual([{ field: "type", op: "ne", matched: false }]);
  });
});

describe("field comparisons", () => {
  it("compares priority by declared order, not text", () => {
    const f = facts({ priority: "high" });
    expect(
      evaluateCondition(
        c({ field: "priority", op: "gte", value: "medium" }),
        f,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(c({ field: "priority", op: "lt", value: "urgent" }), f),
    ).toBe(true);
    expect(
      evaluateCondition(c({ field: "priority", op: "gt", value: "urgent" }), f),
    ).toBe(false);
    // Alphabetical order would put "high" before "low"; declared order must not.
    expect(
      evaluateCondition(c({ field: "priority", op: "gt", value: "low" }), f),
    ).toBe(true);
  });

  it("handles in / not_in / is_empty on an unassigned item", () => {
    const f = facts({ assigneeId: null });
    expect(evaluateCondition(c({ field: "assignee", op: "is_empty" }), f)).toBe(
      true,
    );
    expect(
      evaluateCondition(c({ field: "assignee", op: "in", value: ["p1"] }), f),
    ).toBe(false);
    expect(
      evaluateCondition(
        c({ field: "assignee", op: "not_in", value: ["p1"] }),
        f,
      ),
    ).toBe(true);
  });

  it("matches state group, project key and label membership", () => {
    const f = facts();
    expect(
      evaluateCondition(
        c({ field: "state.group", op: "in", value: ["started", "unstarted"] }),
        f,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(c({ field: "project", op: "eq", value: "SUP" }), f),
    ).toBe(true);
    expect(
      evaluateCondition(c({ field: "label", op: "contains", value: "vip" }), f),
    ).toBe(true);
    expect(
      evaluateCondition(
        c({ field: "label", op: "not_contains", value: "vip" }),
        f,
      ),
    ).toBe(false);
  });

  it("age counts whole minutes from created_at by default and updated_at on request", () => {
    const f = facts();
    expect(
      evaluateCondition(c({ field: "age", op: "gte", value: 90 }), f),
    ).toBe(true);
    expect(evaluateCondition(c({ field: "age", op: "gt", value: 90 }), f)).toBe(
      false,
    );
    expect(
      evaluateCondition(
        c({ field: "age", op: "lt", value: 11, basis: "updated_at" }),
        f,
      ),
    ).toBe(true);
  });

  it("reads comment visibility and changed fields from the event", () => {
    const base = {
      now: NOW,
      commentVisibility: "internal" as const,
      changedFields: ["priority"],
    };
    expect(
      evaluateCondition(
        c({ field: "comment_visibility", op: "eq", value: "internal" }),
        base,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        c({ field: "comment_visibility", op: "eq", value: "public" }),
        base,
      ),
    ).toBe(false);
    expect(
      evaluateCondition(
        c({ field: "field_changed", op: "contains", value: "priority" }),
        base,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        c({ field: "field_changed", op: "in", value: ["title", "dueDate"] }),
        base,
      ),
    ).toBe(false);
  });

  it("never matches a fact that was not loaded (fail closed)", () => {
    const noItem = { now: NOW } satisfies ConditionFacts;
    for (const condition of [
      c({ field: "type", op: "eq", value: "incident" }),
      c({ field: "type", op: "ne", value: "incident" }),
      c({ field: "assignee", op: "is_empty" }),
      c({ field: "age", op: "gte", value: 0 }),
      c({ field: "comment_visibility", op: "eq", value: "public" }),
    ])
      expect(evaluateCondition(condition, noItem), condition.field).toBe(false);
  });

  it("recognises the contract keys that have no loader yet", () => {
    expect(conditionFieldAvailability("type")).toBe("available");
    // `sla_state` has a loader now (computed on read with the list's SLA badge logic).
    expect(conditionFieldAvailability("sla_state")).toBe("available");
    expect(conditionFieldAvailability("actor_role")).toBe("unavailable");
    expect(conditionFieldAvailability("cf.cost_centre")).toBe("unavailable");
    expect(conditionFieldAvailability("nonsense")).toBe("unknown");
  });
});

describe("AM-5 / EV-3 loop protection", () => {
  it("skips an event the rule itself produced", () => {
    expect(
      guardAutomationTrigger({
        automationId: "am_1",
        eventDepth: 1,
        eventOriginAutomationId: "am_1",
      }),
    ).toBe("self_origin");
  });

  it("lets a different rule react to another rule's event until depth 5", () => {
    expect(
      guardAutomationTrigger({
        automationId: "am_2",
        eventDepth: 1,
        eventOriginAutomationId: "am_1",
      }),
    ).toBe("ok");
  });

  it("fires on a depth-4 event but abandons the chain at depth 5", () => {
    const at = (eventDepth: number) =>
      guardAutomationTrigger({
        automationId: "am_2",
        eventDepth,
        eventOriginAutomationId: "am_1",
      });
    expect(AUTOMATION_MAX_DEPTH).toBe(5);
    expect(at(0)).toBe("ok");
    expect(at(4)).toBe("ok");
    expect(at(5)).toBe("depth_exceeded");
    expect(at(6)).toBe("depth_exceeded");
  });

  it("stamps depth, causation and origin onto events produced inside an action", async () => {
    const produced = {
      id: "evt_child",
      kind: "work_item.updated",
      occurredAt: NOW.toISOString(),
      actor: { type: "automation" as const, id: "am_1", name: "Rule" },
      scope: { workspaceId: "ws" },
      payload: {},
      causationId: null,
      depth: 0,
      originAutomationId: null,
    };
    // Outside any automation: untouched.
    expect(withAutomationContext(produced)).toBe(produced);
    const inside = await runAsAutomation(
      {
        automationId: "am_1",
        automationName: "Escalate urgent incidents",
        depth: 3,
        causationId: "evt_trigger",
      },
      async () => {
        await Promise.resolve();
        return withAutomationContext(produced);
      },
    );
    expect(inside).toMatchObject({
      depth: 3,
      causationId: "evt_trigger",
      originAutomationId: "am_1",
      // AM-4: attributed to the rule by id and name, never to a person.
      actor: {
        type: "automation",
        id: "am_1",
        name: "Escalate urgent incidents",
      },
    });
  });

  it("a two-rule loop is cut at depth 5", () => {
    // Rule A and rule B each re-trigger the other. Walk the chain the way the consumer does.
    let depth = 0;
    let origin: string | null = null;
    const fired: string[] = [];
    let rule = "A";
    for (let guard = 0; guard < 20; guard++) {
      const decision = guardAutomationTrigger({
        automationId: rule,
        eventDepth: depth,
        eventOriginAutomationId: origin,
      });
      if (decision !== "ok") break;
      fired.push(rule);
      origin = rule;
      depth += 1;
      rule = rule === "A" ? "B" : "A";
    }
    expect(fired).toHaveLength(AUTOMATION_MAX_DEPTH);
  });
});
