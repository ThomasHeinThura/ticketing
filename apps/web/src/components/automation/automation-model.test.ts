import { describe, expect, it } from "vitest";
import type { Automation } from "@/fetchers/automation/automations";
import {
  actionToJson,
  conditionDefaults,
  conditionToJson,
  draftFromAutomation,
  draftToInput,
  emptyDraft,
  isEditableCondition,
  validateDraft,
} from "./automation-model";

const rule: Automation = {
  id: "am_1",
  workspaceId: "ws",
  projectId: null,
  projectFilter: null,
  name: "Escalate urgent incidents",
  enabled: false,
  trigger: "work_item.created",
  scheduleCron: null,
  conditions: [
    { field: "priority", op: "eq", value: "urgent" },
    { field: "age", op: "gte", value: 90, basis: "updated_at" },
    { field: "assignee", op: "is_empty" },
    { field: "organisation", op: "eq", value: "org_1" },
  ],
  actions: [
    { type: "assign", assigneeId: "p1" },
    { type: "set_due_date", dueInDays: null },
    { type: "transition", toStateKey: "x" },
  ],
  effectiveRoleId: "role_1",
  effectiveRoleName: "Agent",
  position: 0,
  stopProcessing: true,
  flaggedReason: null,
  fireCount: 0,
  lastRunAt: null,
  createdBy: "p0",
  version: 3,
  createdAt: "2026-10-23T00:00:00.000Z",
  updatedAt: "2026-10-23T00:00:00.000Z",
};

describe("rule drafts round-trip", () => {
  it("keeps a stored rule byte-for-byte through edit and save", () => {
    const input = draftToInput(draftFromAutomation(rule));
    expect(input.conditions).toEqual(rule.conditions);
    expect(input.actions).toEqual(rule.actions);
    expect(input).toMatchObject({
      name: rule.name,
      trigger: rule.trigger,
      effectiveRoleId: "role_1",
      stopProcessing: true,
    });
  });

  it("marks fields without a picker read-only so they are preserved, not dropped", () => {
    const draft = draftFromAutomation(rule);
    expect(draft.conditions.map((entry) => entry.readOnly)).toEqual([
      false,
      false,
      false,
      true,
    ]);
    expect(draft.actions.map((entry) => entry.readOnly)).toEqual([
      false,
      false,
      true,
    ]);
    expect(isEditableCondition({ field: "organisation", op: "eq" })).toBe(
      false,
    );
  });
});

describe("draft to JSON", () => {
  it("builds each action's parameters", () => {
    const make = (type: string, value: string) =>
      actionToJson({ key: "k", type, value, readOnly: false });
    expect(make("assign", "p1")).toEqual({ type: "assign", assigneeId: "p1" });
    expect(make("set_priority", "")).toEqual({
      type: "set_priority",
      priority: null,
    });
    expect(make("set_priority", "high")).toEqual({
      type: "set_priority",
      priority: "high",
    });
    expect(make("set_due_date", "3")).toEqual({
      type: "set_due_date",
      dueInDays: 3,
    });
    expect(make("add_label", "l1")).toEqual({
      type: "add_label",
      labelId: "l1",
    });
    expect(make("call_webhook", "w1")).toEqual({
      type: "call_webhook",
      webhookId: "w1",
    });
  });

  it("builds conditions with numbers for age and no value for emptiness", () => {
    expect(
      conditionToJson({
        key: "k",
        field: "age",
        op: "gte",
        value: "90",
        basis: "updated_at",
        readOnly: false,
      }),
    ).toEqual({ field: "age", op: "gte", value: 90, basis: "updated_at" });
    expect(
      conditionToJson({
        key: "k",
        field: "assignee",
        op: "is_empty",
        value: "",
        basis: "created_at",
        readOnly: false,
      }),
    ).toEqual({ field: "assignee", op: "is_empty" });
  });

  it("picks sensible defaults when a condition's field changes", () => {
    expect(conditionDefaults("age")).toMatchObject({ op: "gte", value: "60" });
    expect(conditionDefaults("label")).toMatchObject({
      op: "contains",
      value: "",
    });
  });
});

describe("validateDraft", () => {
  it("requires a name, a role and at least one action", () => {
    const draft = { ...emptyDraft(""), actions: [] };
    expect(validateDraft(draft)).toEqual([
      "nameRequired",
      "roleRequired",
      "actionsRequired",
    ]);
  });

  it("asks for a value on pickers but not on optional ones", () => {
    const draft = emptyDraft("role_1");
    draft.name = "Rule";
    draft.actions = [
      { key: "a", type: "assign", value: "", readOnly: false },
      { key: "b", type: "set_priority", value: "", readOnly: false },
    ];
    expect(validateDraft(draft)).toEqual(["actionValueRequired"]);
    draft.actions = [
      { key: "b", type: "set_priority", value: "", readOnly: false },
    ];
    expect(validateDraft(draft)).toEqual([]);
  });

  it("asks for a condition value unless the operator is about emptiness", () => {
    const draft = emptyDraft("role_1");
    draft.name = "Rule";
    draft.conditions = [
      {
        key: "c",
        field: "label",
        op: "contains",
        value: "",
        basis: "created_at",
        readOnly: false,
      },
    ];
    expect(validateDraft(draft)).toEqual(["conditionValueRequired"]);
    draft.conditions = [
      {
        key: "c",
        field: "assignee",
        op: "is_empty",
        value: "",
        basis: "created_at",
        readOnly: false,
      },
    ];
    expect(validateDraft(draft)).toEqual([]);
  });
});
