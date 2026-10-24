import { PRIORITY_ORDER, STATE_GROUPS } from "./constants";

/**
 * Condition evaluation (`AM-1`: conditions combine with AND; an OR is two rules).
 *
 * The grammar is the structured search filter's `{ field, op, value }` leaf
 * (`safety-and-runtime.md`, work-item search v1), narrowed to flat conjunction and extended by
 * the contract's automation-only keys. A field is only accepted when its fact has an
 * authoritative loader; the contract's remaining keys (`cf.<key>`, `actor_role`)
 * are recognised and refused with the field named, the same `422` rule the search grammar uses,
 * never evaluated as a false predicate.
 */

export const CONDITION_OPS = [
  "eq",
  "ne",
  "in",
  "not_in",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "not_contains",
  "is_empty",
  "is_not_empty",
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

/** Condition keys that have a fact loader today. */
export const CONDITION_FIELDS = [
  "type",
  "state",
  "state.group",
  "priority",
  "assignee",
  "requester",
  "label",
  "organisation",
  "project",
  "age",
  "sla_state",
  "comment_visibility",
  "field_changed",
] as const;
export const SLA_STATE_VALUES = [
  "ok",
  "at_risk",
  "breached",
  "met",
  "missed",
] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

/** Recognised by the contract, but without storage or a loader here; refused with `422`. */
export const UNAVAILABLE_CONDITION_FIELDS = ["actor_role"] as const;

export function isCustomFieldCondition(field: string): boolean {
  return /^cf\.[A-Za-z0-9_-]{1,64}$/.test(field);
}

export function conditionFieldAvailability(
  field: string,
): "available" | "unavailable" | "unknown" {
  if ((CONDITION_FIELDS as readonly string[]).includes(field))
    return "available";
  if (
    (UNAVAILABLE_CONDITION_FIELDS as readonly string[]).includes(field) ||
    isCustomFieldCondition(field)
  )
    return "unavailable";
  return "unknown";
}

const SCALAR_OPS: readonly ConditionOp[] = ["eq", "ne", "in", "not_in"];

/** Which operators each field accepts. */
export const FIELD_OPS: Record<ConditionField, readonly ConditionOp[]> = {
  type: SCALAR_OPS,
  state: SCALAR_OPS,
  "state.group": SCALAR_OPS,
  priority: [...SCALAR_OPS, "gt", "gte", "lt", "lte", "is_empty"],
  assignee: [...SCALAR_OPS, "is_empty", "is_not_empty"],
  requester: [...SCALAR_OPS, "is_empty", "is_not_empty"],
  label: ["contains", "not_contains", "is_empty", "is_not_empty"],
  organisation: [...SCALAR_OPS, "is_empty", "is_not_empty"],
  project: ["eq", "ne", "in", "not_in"],
  age: ["gt", "gte", "lt", "lte"],
  sla_state: [...SCALAR_OPS, "is_empty", "is_not_empty"],
  comment_visibility: ["eq", "ne"],
  field_changed: ["contains", "in"],
};

export type AutomationCondition = {
  field: ConditionField;
  op: ConditionOp;
  value?: unknown;
  /** `age` only: which timestamp the minutes are counted from. */
  basis?: "created_at" | "updated_at";
};

/** The persisted facts a condition is decided from. `undefined` means "not loaded". */
export type ConditionFacts = {
  now: Date;
  /** Work-item facts; absent for an event that carries no work item. */
  workItem?: {
    typeKey: string | null;
    stateKey: string | null;
    stateGroup: string | null;
    priority: string | null;
    assigneeId: string | null;
    requesterId: string | null;
    labels: readonly string[];
    organisationId: string | null;
    projectKey: string | null;
    createdAt: Date;
    updatedAt: Date;
    /**
     * The work item's SLA badge state (`ok|at_risk|breached|met|missed`), computed on read with
     * the same `computeSlaState` the list uses; `null` when no policy applies. `undefined` means
     * not loaded, and a condition on it never matches.
     */
    slaState?: string | null;
  };
  /** From the event payload. */
  commentVisibility?: "public" | "internal" | null;
  changedFields?: readonly string[];
};

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function priorityRank(value: unknown): number {
  return typeof value === "string"
    ? (PRIORITY_ORDER as readonly string[]).indexOf(value)
    : -1;
}

/** Evaluates one condition. A fact that is not loaded never matches (fail closed). */
export function evaluateCondition(
  condition: AutomationCondition,
  facts: ConditionFacts,
): boolean {
  const { op, value } = condition;
  const item = facts.workItem;

  const compareScalar = (actual: string | null | undefined): boolean => {
    switch (op) {
      case "eq":
        return actual !== null && actual !== undefined && actual === value;
      case "ne":
        return actual !== value;
      case "in":
        return (
          actual !== null &&
          actual !== undefined &&
          asArray(value).includes(actual)
        );
      case "not_in":
        return actual === null || actual === undefined
          ? true
          : !asArray(value).includes(actual);
      case "is_empty":
        return actual === null || actual === undefined;
      case "is_not_empty":
        return actual !== null && actual !== undefined;
      default:
        return false;
    }
  };

  switch (condition.field) {
    case "type":
      return item ? compareScalar(item.typeKey) : false;
    case "state":
      return item ? compareScalar(item.stateKey) : false;
    case "state.group":
      return item ? compareScalar(item.stateGroup) : false;
    case "assignee":
      return item ? compareScalar(item.assigneeId) : false;
    case "requester":
      return item ? compareScalar(item.requesterId) : false;
    case "organisation":
      return item ? compareScalar(item.organisationId) : false;
    case "project":
      return item ? compareScalar(item.projectKey) : false;
    case "sla_state":
      return item && item.slaState !== undefined
        ? compareScalar(item.slaState)
        : false;
    case "priority": {
      if (!item) return false;
      if (op === "is_empty") return item.priority === null;
      if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
        const actual = priorityRank(item.priority);
        const wanted = priorityRank(value);
        if (actual < 0 || wanted < 0) return false;
        return op === "gt"
          ? actual > wanted
          : op === "gte"
            ? actual >= wanted
            : op === "lt"
              ? actual < wanted
              : actual <= wanted;
      }
      return compareScalar(item.priority);
    }
    case "label": {
      if (!item) return false;
      if (op === "is_empty") return item.labels.length === 0;
      if (op === "is_not_empty") return item.labels.length > 0;
      const has = typeof value === "string" && item.labels.includes(value);
      return op === "contains" ? has : !has;
    }
    case "age": {
      if (!item || typeof value !== "number") return false;
      const from =
        condition.basis === "updated_at" ? item.updatedAt : item.createdAt;
      const minutes = Math.floor(
        (facts.now.getTime() - from.getTime()) / 60_000,
      );
      return op === "gt"
        ? minutes > value
        : op === "gte"
          ? minutes >= value
          : op === "lt"
            ? minutes < value
            : op === "lte"
              ? minutes <= value
              : false;
    }
    case "comment_visibility": {
      const actual = facts.commentVisibility;
      if (actual === undefined || actual === null) return false;
      return op === "eq" ? actual === value : actual !== value;
    }
    case "field_changed": {
      const changed = facts.changedFields;
      if (!changed) return false;
      if (op === "contains")
        return typeof value === "string" && changed.includes(value);
      return asArray(value).some(
        (name) => typeof name === "string" && changed.includes(name),
      );
    }
    default:
      return false;
  }
}

export type ConditionResult = {
  field: string;
  op: string;
  matched: boolean;
};

/** `AM-1`: conditions combine with AND; an empty list always matches. */
export function evaluateConditions(
  conditions: readonly AutomationCondition[],
  facts: ConditionFacts,
): { matched: boolean; results: ConditionResult[] } {
  const results = conditions.map((condition) => ({
    field: condition.field,
    op: condition.op,
    matched: evaluateCondition(condition, facts),
  }));
  return { matched: results.every((entry) => entry.matched), results };
}

/** Value shape check per field/op, used by the save-time validator. */
export function conditionValueProblem(
  condition: AutomationCondition,
): string | null {
  const { field, op, value } = condition;
  if (!FIELD_OPS[field].includes(op))
    return `${field} does not support the ${op} operator`;
  if (op === "is_empty" || op === "is_not_empty") return null;
  if (field === "age") {
    return typeof value === "number" && Number.isInteger(value) && value >= 0
      ? null
      : "age requires a whole number of minutes (0 or more)";
  }
  if (op === "in" || op === "not_in") {
    if (
      !Array.isArray(value) ||
      value.length < 1 ||
      value.length > 20 ||
      value.some((entry) => typeof entry !== "string" || entry.length === 0)
    )
      return `${field} ${op} requires 1 to 20 non-empty strings`;
  } else if (typeof value !== "string" || value.length === 0) {
    return `${field} requires a non-empty string value`;
  }
  const strings = (Array.isArray(value) ? value : [value]) as string[];
  if (field === "priority") {
    if (
      strings.some(
        (entry) => !(PRIORITY_ORDER as readonly string[]).includes(entry),
      )
    )
      return `priority values must be one of ${PRIORITY_ORDER.join(", ")}`;
  }
  if (field === "state.group") {
    if (
      strings.some(
        (entry) => !(STATE_GROUPS as readonly string[]).includes(entry),
      )
    )
      return `state.group values must be one of ${STATE_GROUPS.join(", ")}`;
  }
  if (field === "sla_state") {
    if (
      strings.some(
        (entry) => !(SLA_STATE_VALUES as readonly string[]).includes(entry),
      )
    )
      return `sla_state values must be one of ${SLA_STATE_VALUES.join(", ")}`;
  }
  if (field === "comment_visibility") {
    if (strings.some((entry) => entry !== "public" && entry !== "internal"))
      return "comment_visibility must be public or internal";
  }
  return null;
}
