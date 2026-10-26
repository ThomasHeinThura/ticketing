import type { Capability } from "@taskdesk/permissions";
import { PRIORITY_ORDER } from "./constants";
import { validatePlaceholders } from "./placeholders";

/**
 * The action vocabulary (`feature-contracts-p4.md` "Actions").
 *
 * `AM-13`: there is **no delete action** and never will be one here. The vocabulary below has no
 * delete, purge or archive member, and `ACTION_TYPE_PATTERN` plus the unit test
 * (`automation-vocabulary.test.ts`) make adding one a failing test, not a code-review hope. Any
 * later automation-delete capability needs its own feature specification with blast-radius
 * control, dry-run behaviour, explicit human approval, audit requirements and a security review.
 */

/** Action types that have an executor in this build. */
export const BUILTIN_ACTION_TYPES = [
  "assign",
  "set_priority",
  "set_due_date",
  "add_label",
  "remove_label",
  "add_watcher",
  "call_webhook",
  "post_comment",
  "notify",
  "transition",
] as const;

/** `post_comment` body cap, applied to the template and again to the expanded text. */
export const POST_COMMENT_MAX_LENGTH = 5000;

/**
 * Contract actions that have no executor yet. They are recognised so a rule that names one is
 * refused with `422 action_unavailable` naming it, rather than saved and then failing on every
 * run. An executor registered through `registerAutomationAction` (`./action-registry.ts`) moves a
 * type from this list into the available set.
 */
export const UNAVAILABLE_ACTION_TYPES = [
  "create_linked_item",
  "request_approval",
  "set_custom_field",
] as const;

export type BuiltinActionType = (typeof BUILTIN_ACTION_TYPES)[number];

/** Never a valid action name, however it is spelled (`AM-13`). */
export const FORBIDDEN_ACTION_PATTERN =
  /delete|purge|destroy|remove_work_item|archive|erase|wipe/i;

export type AutomationAction =
  | { type: "assign"; assigneeId: string }
  | {
      type: "set_priority";
      priority: (typeof PRIORITY_ORDER)[number] | null;
    }
  | { type: "set_due_date"; dueInDays: number | null }
  | { type: "add_label"; labelId: string }
  | { type: "remove_label"; labelId: string }
  | { type: "add_watcher"; personId: string }
  | { type: "call_webhook"; webhookId: string }
  | {
      type: "post_comment";
      /** Plain text with `{{placeholders}}`; never rich text, so it cannot carry a mention. */
      body: string;
      visibility: "public" | "internal";
    }
  | { type: "notify"; teamId: string; title: string; body: string }
  | { type: "transition"; toStateTemplateId: string };

/**
 * `AM-3`: the capability the rule's effective role must hold for the action, checked at the
 * triggering item's project before each action runs.
 */
export function requiredCapability(action: AutomationAction): Capability {
  switch (action.type) {
    case "assign":
      return "work_item:assign";
    case "set_priority":
      return "work_item:set_priority";
    case "set_due_date":
    case "add_label":
    case "remove_label":
    case "add_watcher":
      return "work_item:update";
    case "call_webhook":
      return "work_item:read";
    case "notify":
      return "work_item:read";
    case "post_comment":
      return action.visibility === "public"
        ? "comment:create"
        : "comment:create_internal";
    case "transition":
      return "work_item:transition";
  }
}

/** Action types that need the triggering event to carry a work item. */
export function actionNeedsWorkItem(action: AutomationAction): boolean {
  return action.type !== "call_webhook";
}

export type ActionProblem = {
  code: "invalid" | "unavailable";
  index: number;
  message: string;
};

const ID = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128;

function onlyKeys(
  raw: Record<string, unknown>,
  allowed: readonly string[],
): string | null {
  const extra = Object.keys(raw).find((key) => !allowed.includes(key));
  return extra ? `unknown field "${extra}"` : null;
}

/** Validates one stored action. `available` is the set of types with an executor. */
export function parseAction(
  raw: unknown,
  index: number,
  available: ReadonlySet<string>,
):
  | { ok: true; action: AutomationAction }
  | { ok: false; problem: ActionProblem } {
  const fail = (code: ActionProblem["code"], message: string) => ({
    ok: false as const,
    problem: { code, index, message },
  });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return fail("invalid", "action must be an object");
  const record = raw as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string" || !/^[a-z_]{2,40}$/.test(type))
    return fail("invalid", "action.type is required");
  if (FORBIDDEN_ACTION_PATTERN.test(type))
    return fail(
      "invalid",
      "automations cannot delete, purge or archive anything (AM-13)",
    );
  if (!available.has(type)) {
    return (UNAVAILABLE_ACTION_TYPES as readonly string[]).includes(type)
      ? fail("unavailable", `action type "${type}" is not available yet`)
      : fail("invalid", `unknown action type "${type}"`);
  }
  switch (type) {
    case "assign": {
      const extra = onlyKeys(record, ["type", "assigneeId"]);
      if (extra) return fail("invalid", extra);
      if (!ID(record.assigneeId))
        return fail("invalid", "assign requires assigneeId");
      return { ok: true, action: { type, assigneeId: record.assigneeId } };
    }
    case "set_priority": {
      const extra = onlyKeys(record, ["type", "priority"]);
      if (extra) return fail("invalid", extra);
      const priority = record.priority;
      if (
        priority !== null &&
        !(PRIORITY_ORDER as readonly unknown[]).includes(priority)
      )
        return fail(
          "invalid",
          `priority must be null or one of ${PRIORITY_ORDER.join(", ")}`,
        );
      return {
        ok: true,
        action: {
          type,
          priority: priority as (typeof PRIORITY_ORDER)[number] | null,
        },
      };
    }
    case "set_due_date": {
      const extra = onlyKeys(record, ["type", "dueInDays"]);
      if (extra) return fail("invalid", extra);
      const days = record.dueInDays;
      if (
        days !== null &&
        !(
          typeof days === "number" &&
          Number.isInteger(days) &&
          days >= 0 &&
          days <= 3650
        )
      )
        return fail(
          "invalid",
          "dueInDays must be null or a whole number from 0 to 3650",
        );
      return { ok: true, action: { type, dueInDays: days as number | null } };
    }
    case "add_label":
    case "remove_label": {
      const extra = onlyKeys(record, ["type", "labelId"]);
      if (extra) return fail("invalid", extra);
      if (!ID(record.labelId))
        return fail("invalid", `${type} requires labelId`);
      return { ok: true, action: { type, labelId: record.labelId } };
    }
    case "add_watcher": {
      const extra = onlyKeys(record, ["type", "personId"]);
      if (extra) return fail("invalid", extra);
      if (!ID(record.personId))
        return fail("invalid", "add_watcher requires personId");
      return { ok: true, action: { type, personId: record.personId } };
    }
    case "call_webhook": {
      const extra = onlyKeys(record, ["type", "webhookId"]);
      if (extra) return fail("invalid", extra);
      if (!ID(record.webhookId))
        return fail("invalid", "call_webhook requires webhookId");
      return { ok: true, action: { type, webhookId: record.webhookId } };
    }
    case "post_comment": {
      const extra = onlyKeys(record, ["type", "body", "visibility"]);
      if (extra) return fail("invalid", extra);
      if (record.visibility !== "public" && record.visibility !== "internal")
        return fail(
          "invalid",
          "post_comment requires visibility public or internal",
        );
      const body = record.body;
      if (
        typeof body !== "string" ||
        body.trim().length === 0 ||
        body.length > POST_COMMENT_MAX_LENGTH ||
        body.includes("\u0000")
      )
        return fail(
          "invalid",
          `post_comment requires a text body of 1 to ${POST_COMMENT_MAX_LENGTH} characters`,
        );
      // AM-11: a public comment is customer-visible, so a staff-only placeholder in it is
      // refused here with the offending placeholder named.
      const checked = validatePlaceholders(
        body,
        record.visibility === "public" ? "customer" : "staff",
      );
      if (checked.problems.length > 0)
        return fail(
          "invalid",
          checked.problems
            .map((problem) => `{{${problem.path}}}: ${problem.reason}`)
            .join("; "),
        );
      return {
        ok: true,
        action: { type, body, visibility: record.visibility },
      };
    }
    case "notify": {
      const extra = onlyKeys(record, ["type", "teamId", "title", "body"]);
      if (extra) return fail("invalid", extra);
      if (!ID(record.teamId)) return fail("invalid", "notify requires teamId");
      const title = record.title;
      const body = record.body;
      if (
        typeof title !== "string" ||
        title.trim().length === 0 ||
        title.length > 160 ||
        title.includes("\u0000")
      )
        return fail(
          "invalid",
          "notify requires a title of 1 to 160 characters",
        );
      if (
        typeof body !== "string" ||
        body.trim().length === 0 ||
        body.length > POST_COMMENT_MAX_LENGTH ||
        body.includes("\u0000")
      )
        return fail(
          "invalid",
          `notify requires a text body of 1 to ${POST_COMMENT_MAX_LENGTH} characters`,
        );
      const checked = validatePlaceholders(`${title}\n${body}`, "staff");
      if (checked.problems.length > 0)
        return fail(
          "invalid",
          checked.problems
            .map((problem) => `{{${problem.path}}}: ${problem.reason}`)
            .join("; "),
        );
      return { ok: true, action: { type, teamId: record.teamId, title, body } };
    }
    case "transition": {
      const extra = onlyKeys(record, ["type", "toStateTemplateId"]);
      if (extra) return fail("invalid", extra);
      if (!ID(record.toStateTemplateId))
        return fail("invalid", "transition requires toStateTemplateId");
      return {
        ok: true,
        action: { type, toStateTemplateId: record.toStateTemplateId },
      };
    }
    default:
      return fail("unavailable", `action type "${type}" is not available yet`);
  }
}
