import type {
  Automation,
  AutomationAction,
  AutomationCondition,
  AutomationInput,
} from "@/fetchers/automation/automations";

/**
 * The rule editor's draft model. A rule is one trigger, a flat AND-list of conditions and a flat
 * list of actions (`feature-contracts-p4.md` "Design stance"); the API owns validation and
 * answers with path-named problems, so this file only maps between the stored JSON and form
 * state.
 */

export const TRIGGERS = [
  "work_item.created",
  "work_item.transitioned",
  "work_item.updated",
  "work_item.assigned",
  "work_item.commented",
  "work_item.escalated",
  "sla.at_risk",
  "sla.breached",
  "approval.decided",
  "submission.received",
] as const;

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const STATE_GROUPS = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
] as const;
export const CHANGEABLE_FIELDS = [
  "title",
  "description",
  "priority",
  "dueDate",
  "assignee",
  "labels",
] as const;

/** Condition fields the editor can edit with a proper picker, with their operators. */
export const EDITABLE_CONDITIONS = {
  type: ["eq", "ne"],
  "state.group": ["eq", "ne"],
  priority: ["eq", "ne", "gte", "lte"],
  label: ["contains", "not_contains"],
  project: ["eq", "ne"],
  age: ["gte", "lte"],
  comment_visibility: ["eq"],
  field_changed: ["contains"],
  assignee: ["is_empty", "is_not_empty"],
} as const;

export type EditableConditionField = keyof typeof EDITABLE_CONDITIONS;

export function isEditableCondition(
  condition: AutomationCondition,
): condition is AutomationCondition & { field: EditableConditionField } {
  return Object.hasOwn(EDITABLE_CONDITIONS, condition.field);
}

export const ACTION_TYPES = [
  "assign",
  "set_priority",
  "set_due_date",
  "add_label",
  "remove_label",
  "add_watcher",
  "call_webhook",
] as const;
export type EditableActionType = (typeof ACTION_TYPES)[number];

export type ConditionDraft = {
  key: string;
  field: string;
  op: string;
  value: string;
  basis: "created_at" | "updated_at";
  /** True when the stored condition has a field this editor has no picker for. */
  readOnly: boolean;
  original?: AutomationCondition;
};

export type ActionDraft = {
  key: string;
  type: string;
  /** A person, label or webhook id; or a priority; or a number of days. */
  value: string;
  readOnly: boolean;
  original?: AutomationAction;
};

export type RuleDraft = {
  name: string;
  trigger: string;
  conditions: ConditionDraft[];
  actions: ActionDraft[];
  effectiveRoleId: string;
  stopProcessing: boolean;
};

let counter = 0;
export function nextKey(): string {
  counter += 1;
  return `draft-${counter}`;
}

export function emptyCondition(): ConditionDraft {
  return {
    key: nextKey(),
    field: "priority",
    op: "eq",
    value: "high",
    basis: "created_at",
    readOnly: false,
  };
}

export function emptyAction(): ActionDraft {
  return {
    key: nextKey(),
    type: "set_priority",
    value: "high",
    readOnly: false,
  };
}

export function emptyDraft(defaultRoleId: string): RuleDraft {
  return {
    name: "",
    trigger: "work_item.created",
    conditions: [],
    actions: [emptyAction()],
    effectiveRoleId: defaultRoleId,
    stopProcessing: false,
  };
}

function conditionValueToText(condition: AutomationCondition): string {
  const value = condition.value;
  if (value === undefined || value === null) return "";
  return String(value);
}

export function draftFromAutomation(rule: Automation): RuleDraft {
  return {
    name: rule.name,
    trigger: rule.trigger,
    conditions: rule.conditions.map((condition) => ({
      key: nextKey(),
      field: condition.field,
      op: condition.op,
      value: conditionValueToText(condition),
      basis: condition.basis ?? "created_at",
      readOnly: !isEditableCondition(condition),
      original: condition,
    })),
    actions: rule.actions.map((action) => ({
      key: nextKey(),
      type: action.type,
      value: actionValueToText(action),
      readOnly: !(ACTION_TYPES as readonly string[]).includes(action.type),
      original: action,
    })),
    effectiveRoleId: rule.effectiveRoleId,
    stopProcessing: rule.stopProcessing,
  };
}

function actionValueToText(action: AutomationAction): string {
  switch (action.type) {
    case "assign":
      return String(action.assigneeId ?? "");
    case "set_priority":
      return action.priority === null ? "" : String(action.priority);
    case "set_due_date":
      return action.dueInDays === null ? "" : String(action.dueInDays);
    case "add_label":
    case "remove_label":
      return String(action.labelId ?? "");
    case "add_watcher":
      return String(action.personId ?? "");
    case "call_webhook":
      return String(action.webhookId ?? "");
    default:
      return "";
  }
}

export function conditionToJson(draft: ConditionDraft): AutomationCondition {
  if (draft.readOnly && draft.original) return draft.original;
  if (draft.op === "is_empty" || draft.op === "is_not_empty")
    return { field: draft.field, op: draft.op };
  if (draft.field === "age")
    return {
      field: "age",
      op: draft.op,
      value: Number.parseInt(draft.value, 10),
      basis: draft.basis,
    };
  return { field: draft.field, op: draft.op, value: draft.value };
}

export function actionToJson(draft: ActionDraft): AutomationAction {
  if (draft.readOnly && draft.original) return draft.original;
  switch (draft.type) {
    case "assign":
      return { type: "assign", assigneeId: draft.value };
    case "set_priority":
      return { type: "set_priority", priority: draft.value || null };
    case "set_due_date":
      return {
        type: "set_due_date",
        dueInDays: draft.value === "" ? null : Number.parseInt(draft.value, 10),
      };
    case "add_label":
      return { type: "add_label", labelId: draft.value };
    case "remove_label":
      return { type: "remove_label", labelId: draft.value };
    case "add_watcher":
      return { type: "add_watcher", personId: draft.value };
    case "call_webhook":
      return { type: "call_webhook", webhookId: draft.value };
    default:
      return { type: draft.type };
  }
}

export function draftToInput(draft: RuleDraft): AutomationInput {
  return {
    name: draft.name.trim(),
    trigger: draft.trigger,
    conditions: draft.conditions.map(conditionToJson),
    actions: draft.actions.map(actionToJson),
    effectiveRoleId: draft.effectiveRoleId,
    stopProcessing: draft.stopProcessing,
  };
}

/** Which operators a condition field offers; an unknown (read-only) field offers its own. */
export function operatorsFor(field: string): readonly string[] {
  return Object.hasOwn(EDITABLE_CONDITIONS, field)
    ? EDITABLE_CONDITIONS[field as EditableConditionField]
    : [];
}

/** A condition's default operator and value when its field changes in the editor. */
export function conditionDefaults(
  field: EditableConditionField,
): Pick<ConditionDraft, "op" | "value" | "basis"> {
  const op = EDITABLE_CONDITIONS[field][0];
  const defaults: Record<EditableConditionField, string> = {
    type: "",
    "state.group": "started",
    priority: "high",
    label: "",
    project: "",
    age: "60",
    comment_visibility: "public",
    field_changed: "priority",
    assignee: "",
  };
  return { op, value: defaults[field], basis: "created_at" };
}

export function actionNeedsPerson(type: string) {
  return type === "assign" || type === "add_watcher";
}

export type DraftProblem =
  | "nameRequired"
  | "actionsRequired"
  | "actionValueRequired"
  | "conditionValueRequired"
  | "roleRequired";

/** Client hints only; the API validates the rule and names each problem by path. */
export function validateDraft(draft: RuleDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (draft.name.trim().length === 0) problems.push("nameRequired");
  if (draft.effectiveRoleId === "") problems.push("roleRequired");
  if (draft.actions.length === 0) problems.push("actionsRequired");
  if (
    draft.actions.some(
      (action) =>
        !action.readOnly &&
        action.type !== "set_priority" &&
        action.type !== "set_due_date" &&
        action.value.trim() === "",
    )
  )
    problems.push("actionValueRequired");
  if (
    draft.conditions.some(
      (condition) =>
        !condition.readOnly &&
        condition.op !== "is_empty" &&
        condition.op !== "is_not_empty" &&
        condition.value.trim() === "",
    )
  )
    problems.push("conditionValueRequired");
  return problems;
}

/** A person-facing summary of a stored rule, for the list ("When ... if N conditions ..."). */
export function conditionCountLabelKey(count: number): "none" | "some" {
  return count === 0 ? "none" : "some";
}
