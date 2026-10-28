import { Cron } from "croner";
import {
  type AutomationAction,
  BUILTIN_ACTION_TYPES,
  parseAction,
} from "./actions";
import {
  type AutomationCondition,
  CONDITION_OPS,
  type ConditionField,
  type ConditionOp,
  conditionFieldAvailability,
  conditionValueProblem,
} from "./conditions";
import {
  AUTOMATION_EVENT_TRIGGERS,
  AUTOMATION_MAX_ACTIONS,
  AUTOMATION_MAX_CONDITIONS,
  AUTOMATION_MAX_PROJECT_FILTER,
  AUTOMATION_SCHEDULE_TRIGGER,
  isAutomationEventTrigger,
} from "./constants";

/**
 * Save-time validation of a rule definition. Every problem names its path, and a recognised but
 * not-yet-backed key answers `unavailable` (HTTP 422), never a silently-false predicate.
 */

export type RuleProblem = {
  code: "invalid" | "unavailable";
  path: string;
  message: string;
};

export type RuleDefinitionInput = {
  trigger: string;
  scheduleCron?: string | null;
  conditions: unknown;
  actions: unknown;
  projectFilter?: unknown;
};

export type ValidRuleDefinition = {
  trigger: string;
  scheduleCron: string | null;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  projectFilter: string[] | null;
};

const AVAILABLE_ACTION_TYPES: ReadonlySet<string> = new Set(
  BUILTIN_ACTION_TYPES,
);

export function validateRuleDefinition(
  input: RuleDefinitionInput,
  options: {
    /** `schedule` has no executor in this build; when false it is refused as unavailable. */
    scheduleAvailable?: boolean;
  } = {},
):
  | { ok: true; value: ValidRuleDefinition }
  | { ok: false; problems: RuleProblem[] } {
  const problems: RuleProblem[] = [];

  // Trigger
  let scheduleCron: string | null = null;
  if (input.trigger === AUTOMATION_SCHEDULE_TRIGGER) {
    if (!options.scheduleAvailable) {
      problems.push({
        code: "unavailable",
        path: "trigger",
        message: "the schedule trigger is not available yet",
      });
    } else {
      const cron = input.scheduleCron?.trim() ?? "";
      let valid = cron.length > 0 && cron.length <= 100;
      if (valid) {
        try {
          new Cron(cron, { paused: true });
        } catch {
          valid = false;
        }
      }
      if (!valid)
        problems.push({
          code: "invalid",
          path: "scheduleCron",
          message:
            "a valid cron expression is required for the schedule trigger",
        });
      else scheduleCron = cron;
    }
  } else if (!isAutomationEventTrigger(input.trigger)) {
    problems.push({
      code: "invalid",
      path: "trigger",
      message: `trigger must be one of ${[...AUTOMATION_EVENT_TRIGGERS, AUTOMATION_SCHEDULE_TRIGGER].join(", ")}`,
    });
  } else if (input.scheduleCron) {
    problems.push({
      code: "invalid",
      path: "scheduleCron",
      message: "scheduleCron applies only to the schedule trigger",
    });
  }

  // Conditions
  const conditions: AutomationCondition[] = [];
  if (!Array.isArray(input.conditions)) {
    problems.push({
      code: "invalid",
      path: "conditions",
      message: "conditions must be a list",
    });
  } else if (input.conditions.length > AUTOMATION_MAX_CONDITIONS) {
    problems.push({
      code: "invalid",
      path: "conditions",
      message: `at most ${AUTOMATION_MAX_CONDITIONS} conditions`,
    });
  } else {
    input.conditions.forEach((raw, index) => {
      const path = `conditions[${index}]`;
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        problems.push({ code: "invalid", path, message: "must be an object" });
        return;
      }
      const record = raw as Record<string, unknown>;
      const extra = Object.keys(record).find(
        (key) => !["field", "op", "value", "basis"].includes(key),
      );
      if (extra) {
        problems.push({
          code: "invalid",
          path,
          message: `unknown field "${extra}"`,
        });
        return;
      }
      const field = record.field;
      if (typeof field !== "string") {
        problems.push({ code: "invalid", path, message: "field is required" });
        return;
      }
      const availability = conditionFieldAvailability(field);
      if (availability === "unavailable") {
        problems.push({
          code: "unavailable",
          path: `${path}.field`,
          message: `condition field "${field}" is not available yet`,
        });
        return;
      }
      if (availability === "unknown") {
        problems.push({
          code: "invalid",
          path: `${path}.field`,
          message: `unknown condition field "${field}"`,
        });
        return;
      }
      const op = record.op;
      if (
        typeof op !== "string" ||
        !(CONDITION_OPS as readonly string[]).includes(op)
      ) {
        problems.push({
          code: "invalid",
          path: `${path}.op`,
          message: "unknown operator",
        });
        return;
      }
      if (
        record.basis !== undefined &&
        (field !== "age" ||
          (record.basis !== "created_at" && record.basis !== "updated_at"))
      ) {
        problems.push({
          code: "invalid",
          path: `${path}.basis`,
          message: "basis applies only to age (created_at or updated_at)",
        });
        return;
      }
      const condition: AutomationCondition = {
        field: field as ConditionField,
        op: op as ConditionOp,
        ...(record.value !== undefined ? { value: record.value } : {}),
        ...(record.basis !== undefined
          ? { basis: record.basis as "created_at" | "updated_at" }
          : {}),
      };
      const problem = conditionValueProblem(condition);
      if (problem) {
        problems.push({ code: "invalid", path, message: problem });
        return;
      }
      conditions.push(condition);
    });
  }

  // Actions
  const actions: AutomationAction[] = [];
  if (!Array.isArray(input.actions)) {
    problems.push({
      code: "invalid",
      path: "actions",
      message: "actions must be a list",
    });
  } else if (input.actions.length < 1) {
    problems.push({
      code: "invalid",
      path: "actions",
      message: "a rule needs at least one action",
    });
  } else if (input.actions.length > AUTOMATION_MAX_ACTIONS) {
    problems.push({
      code: "invalid",
      path: "actions",
      message: `at most ${AUTOMATION_MAX_ACTIONS} actions`,
    });
  } else {
    input.actions.forEach((raw, index) => {
      const parsed = parseAction(raw, index, AVAILABLE_ACTION_TYPES);
      if (parsed.ok) actions.push(parsed.action);
      else
        problems.push({
          code: parsed.problem.code,
          path: `actions[${index}]`,
          message: parsed.problem.message,
        });
    });
  }

  // Project filter (workspace rules only; the route decides whether it is allowed)
  let projectFilter: string[] | null = null;
  if (input.projectFilter !== undefined && input.projectFilter !== null) {
    if (
      !Array.isArray(input.projectFilter) ||
      input.projectFilter.length < 1 ||
      input.projectFilter.length > AUTOMATION_MAX_PROJECT_FILTER ||
      input.projectFilter.some(
        (id) => typeof id !== "string" || id.length === 0 || id.length > 128,
      )
    ) {
      problems.push({
        code: "invalid",
        path: "projectFilter",
        message: `projectFilter must be a list of 1 to ${AUTOMATION_MAX_PROJECT_FILTER} project ids`,
      });
    } else {
      projectFilter = [...new Set(input.projectFilter as string[])];
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      trigger: input.trigger,
      scheduleCron,
      conditions,
      actions,
      projectFilter,
    },
  };
}

/** Does any stored action need the triggering event to carry a work item? */
export function actionsNeedWorkItem(actions: readonly AutomationAction[]) {
  return actions.some((action) => action.type !== "call_webhook");
}
