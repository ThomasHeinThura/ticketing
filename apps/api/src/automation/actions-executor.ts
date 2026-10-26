import { createId } from "@paralleldrive/cuid2";
import type { JsonValue } from "@taskdesk/domain";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import db from "../database";
import {
  commentTable,
  personTable,
  projectTable,
  userTable,
  watcherTable,
  webhookDeliveryTable,
  webhookTable,
  workItemTable,
} from "../database/schema";
import { publishEvent } from "../events";
import { runAsAutomation } from "../events/automation-context";
import type { InternalEnvelope } from "../webhook/envelope";
import { projectWebhookEnvelope } from "../webhook/envelope";
import { decideOwnerReach } from "../webhook/reach";
import { recordWorkItemActivity } from "../work-item/activity";
import {
  assertProjectStillLive,
  assertWorkItemStillLive,
} from "../work-item/assert-work-item-live";
import {
  type BulkWorkItemOperation,
  bulkWorkItems,
} from "../work-item/controllers/bulk-work-items";
import transitionWorkItem, {
  NoMatchingTransitionError,
  SlaPauseConflictError,
  TransitionBlockedError,
  TransitionConflictError,
} from "../work-item/controllers/transition-work-item";
import {
  publishWorkItemHint,
  recordWorkItemEvent,
} from "../work-item/native-event";
import {
  type AutomationAction,
  POST_COMMENT_MAX_LENGTH,
  requiredCapability,
} from "./actions";
import { type EffectiveRole, roleMayAct } from "./effective-role";
import type { LoadedWorkItem } from "./facts";
import { expandPlaceholders } from "./placeholders";
import type { AutomationRow } from "./repository";
import { notifyTeam } from "./team-notify";

/**
 * Action execution for one matched rule (`AM-3`, `AM-4`, `AM-7`, `AM-12`).
 *
 * Every action first asks the rule's **effective role** (never the author) whether it may take
 * the action at the triggering item's project. The work itself goes through the same domain code
 * a person's request uses (`bulkWorkItems` is actor-agnostic: it takes the actor id and type and a
 * per-item authoriser), with `actor_type = 'automation'` and `actor_id = automation.id`, so the
 * activity row, the audit row and the outbox event are attributed to the automation by id, never
 * to a person. Each action runs inside `runAsAutomation`, which stamps `depth`, `causationId` and
 * `originAutomationId` onto every event it produces (`EV-3`).
 *
 * A failing action does not abort the rest of the rule: it returns an `ActionResult` with the
 * reason and the next action runs (`AM-7`).
 */

export type ActionResult = {
  index: number;
  type: string;
  ok: boolean;
  error?: string;
  detail?: Record<string, unknown>;
};

export type ActionContext = {
  automation: Pick<AutomationRow, "id" | "name" | "workspaceId" | "projectId">;
  role: EffectiveRole;
  envelope: InternalEnvelope & { depth: number };
  /** The triggering item, re-read before each action. */
  loadItem: () => Promise<LoadedWorkItem | null>;
  instance: string;
};

/** Stable machine reasons recorded in run history (and used to flag a rule). */
export const ACTION_ERRORS = {
  noWorkItem: "no_work_item",
  roleLacksCapability: "role_lacks_capability",
  referenceUnavailable: "reference_unavailable",
} as const;

function failure(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

async function viaBulk(
  ctx: ActionContext,
  item: LoadedWorkItem,
  operation: BulkWorkItemOperation,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await runAsAutomation(
    {
      automationId: ctx.automation.id,
      automationName: ctx.automation.name,
      depth: ctx.envelope.depth + 1,
      causationId: ctx.envelope.id,
    },
    () =>
      bulkWorkItems(
        item.workspaceId,
        ctx.automation.id,
        "automation",
        [item.key],
        operation,
        // The effective role's capability was already decided for this exact item.
        async () => "ok",
      ),
  );
  if (result.succeeded.includes(item.key)) return { ok: true };
  return failure(result.failed[0]?.reason ?? "failed");
}

async function addWatcher(
  ctx: ActionContext,
  item: LoadedWorkItem,
  personId: string,
): Promise<
  { ok: true; detail?: Record<string, unknown> } | { ok: false; error: string }
> {
  // The watcher must themselves be able to see the item (same reach rule as a webhook owner).
  const reach = await decideOwnerReach(db, personId, {
    workspaceId: item.workspaceId,
    projectId: item.projectId,
    workItemEvent: true,
  });
  if (reach.kind !== "in_reach")
    return failure(ACTION_ERRORS.referenceUnavailable);
  const inserted = await runAsAutomation(
    {
      automationId: ctx.automation.id,
      automationName: ctx.automation.name,
      depth: ctx.envelope.depth + 1,
      causationId: ctx.envelope.id,
    },
    () =>
      db.transaction(async (tx) => {
        const rows = await tx
          .insert(watcherTable)
          .values({
            workItemId: item.id,
            personId,
            source: "explicit",
            muted: false,
          })
          .onConflictDoNothing()
          .returning({ id: watcherTable.id });
        if (rows.length === 0) return false;
        await recordWorkItemActivity(tx, [
          {
            workspaceId: item.workspaceId,
            workItemId: item.id,
            actorId: ctx.automation.id,
            actorType: "automation",
            verb: "updated",
            field: "watcher",
            oldValue: null,
            newValue: { personId },
          },
        ]);
        await appendAuditLog(tx, {
          actorId: ctx.automation.id,
          actorType: "automation",
          workspaceId: item.workspaceId,
          projectId: item.projectId,
          action: "work_item.updated",
          entityType: "work_item",
          entityId: item.id,
          before: { watcherIds: [] },
          after: { addedWatcherId: personId },
        });
        return true;
      }),
  );
  return { ok: true, detail: { added: inserted } };
}

/**
 * Values for the closed placeholder vocabulary (`placeholders.ts`), read from the database when
 * the action runs. A staff-only path (`assignee.email`, `requester.email`, ...) is loaded only so
 * a *staff* destination can show it; `expandPlaceholders` redacts it for a customer-visible one
 * whatever is loaded here (`AM-11`).
 */
async function placeholderValues(
  ctx: ActionContext,
  item: LoadedWorkItem,
): Promise<Record<string, string | null>> {
  const [project] = await db
    .select({ name: projectTable.name })
    .from(projectTable)
    .where(eq(projectTable.id, item.projectId))
    .limit(1);
  const person = async (personId: string | null) => {
    if (!personId) return { name: null, email: null };
    const [row] = await db
      .select({
        name: personTable.displayName,
        userName: userTable.name,
        email: userTable.email,
      })
      .from(personTable)
      .leftJoin(userTable, eq(userTable.id, personTable.userId))
      .where(eq(personTable.id, personId))
      .limit(1);
    return {
      name: row?.name ?? row?.userName ?? null,
      email: row?.email ?? null,
    };
  };
  const assignee = await person(item.facts.assigneeId);
  const requester = await person(item.facts.requesterId);
  return {
    "work_item.key": item.key,
    "work_item.title": item.title,
    "work_item.url": `${ctx.instance}/agent/work-items/${encodeURIComponent(item.key)}`,
    "work_item.state": item.facts.stateKey,
    "work_item.priority": item.facts.priority,
    "project.key": item.facts.projectKey,
    "project.name": project?.name ?? null,
    "actor.name": ctx.automation.name,
    "assignee.name": assignee.name,
    "assignee.email": assignee.email,
    "requester.name": requester.name,
    "requester.email": requester.email,
  };
}

// Control characters other than newline and tab never belong in a comment.
// biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function plainTextDocument(text: string): JsonValue {
  return {
    type: "doc",
    content: text
      .split("\n")
      .map(
        (line): JsonValue =>
          line.length > 0
            ? { type: "paragraph", content: [{ type: "text", text: line }] }
            : { type: "paragraph" },
      ),
  };
}

/**
 * `post_comment` (`AM-3`, `AM-4`, `AM-11`). The text is expanded against the destination's
 * audience (a public comment is customer-visible: staff-only placeholders are redacted), kept to
 * plain text, and written through the comment tables in one transaction with an `automation`
 * actor: no author person, an `audit_log` row and a `work_item.commented` event attributed to the
 * rule by id and name. Everything inside `runAsAutomation`, so the event carries the loop-guard
 * context (`AM-5`): a comment-triggered rule never re-fires on its own comment.
 */
async function postComment(
  ctx: ActionContext,
  item: LoadedWorkItem,
  action: Extract<AutomationAction, { type: "post_comment" }>,
): Promise<
  { ok: true; detail?: Record<string, unknown> } | { ok: false; error: string }
> {
  const text = expandPlaceholders(
    action.body,
    await placeholderValues(ctx, item),
    action.visibility === "public" ? "customer" : "staff",
  )
    .replace(CONTROL_CHARACTERS, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (text.length === 0) return failure("empty_comment");
  if (text.length > POST_COMMENT_MAX_LENGTH) return failure("comment_too_long");

  const created = await runAsAutomation(
    {
      automationId: ctx.automation.id,
      automationName: ctx.automation.name,
      depth: ctx.envelope.depth + 1,
      causationId: ctx.envelope.id,
    },
    () =>
      db.transaction(async (tx) => {
        const [locked] = await tx
          .select({
            projectId: workItemTable.projectId,
            key: workItemTable.key,
            deletedAt: workItemTable.deletedAt,
            archivedAt: workItemTable.archivedAt,
          })
          .from(workItemTable)
          .where(eq(workItemTable.id, item.id))
          .for("update");
        assertWorkItemStillLive(locked);
        await assertProjectStillLive(tx, locked.projectId);
        const [row] = await tx
          .insert(commentTable)
          .values({
            workspaceId: item.workspaceId,
            workItemId: item.id,
            authorId: null,
            actorType: "automation",
            body: plainTextDocument(text),
            visibility: action.visibility,
          })
          .returning({ id: commentTable.id });
        if (!row) throw new Error("comment insert returned no row");
        await appendAuditLog(tx, {
          actorId: ctx.automation.id,
          actorType: "automation",
          workspaceId: item.workspaceId,
          projectId: locked.projectId,
          action: "work_item.commented",
          entityType: "comment",
          entityId: row.id,
          before: null,
          after: {
            workItemId: item.id,
            visibility: action.visibility,
            automation: { id: ctx.automation.id, name: ctx.automation.name },
            body: plainTextDocument(text),
          },
        });
        const event = await recordWorkItemEvent(tx, {
          kind: "work_item.commented",
          workItemId: item.id,
          key: locked.key,
          workspaceId: item.workspaceId,
          projectId: locked.projectId,
          actorId: ctx.automation.id,
          actorType: "automation",
          actorName: ctx.automation.name,
          customerVisible: action.visibility === "public",
          payload: {
            key: locked.key,
            url: `/agent/work-items/${encodeURIComponent(locked.key)}`,
            commentId: row.id,
            visibility: action.visibility,
          },
        });
        return { commentId: row.id, event, projectId: locked.projectId };
      }),
  );
  await publishEvent("work_item.commented", {
    commentId: created.commentId,
    workItemId: item.id,
    workspaceId: item.workspaceId,
    visibility: action.visibility,
    actorId: ctx.automation.id,
    actorType: "automation",
  });
  await publishWorkItemHint(created.event, {
    kind: "work_item.commented",
    key: item.key,
    projectId: created.projectId,
    customerVisible: action.visibility === "public",
  });
  return { ok: true, detail: { commentId: created.commentId } };
}

/**
 * `transition`: the same transition code a person's request runs, as the rule's effective role
 * (`AM-3`). Only edges open to that role are legal; the most-restrictive matching edge, its
 * guards, required custom fields and the concurrency check all apply, and an approval or CAB
 * gated edge is refused. A refusal is a recorded failure, never a partial change.
 */
async function transitionItem(
  ctx: ActionContext,
  item: LoadedWorkItem,
  action: Extract<AutomationAction, { type: "transition" }>,
): Promise<
  { ok: true; detail?: Record<string, unknown> } | { ok: false; error: string }
> {
  try {
    const result = await runAsAutomation(
      {
        automationId: ctx.automation.id,
        automationName: ctx.automation.name,
        depth: ctx.envelope.depth + 1,
        causationId: ctx.envelope.id,
      },
      () =>
        transitionWorkItem(
          item.id,
          null,
          null,
          ctx.automation.id,
          "automation",
          { toStateTemplateId: action.toStateTemplateId },
          undefined,
          { roleId: ctx.role.id },
        ),
    );
    return { ok: true, detail: { stateId: result.stateId } };
  } catch (error) {
    if (error instanceof NoMatchingTransitionError)
      return failure("no_matching_transition");
    if (error instanceof TransitionBlockedError)
      return failure(
        `transition_blocked${error.blockedBy[0] ? `: ${error.blockedBy[0].kind}` : ""}`,
      );
    if (error instanceof TransitionConflictError)
      return failure("state_changed");
    if (error instanceof SlaPauseConflictError)
      return failure("sla_pause_conflict");
    if (error instanceof HTTPException)
      return failure(ACTION_ERRORS.noWorkItem);
    throw error;
  }
}

async function callWebhook(
  ctx: ActionContext,
  item: LoadedWorkItem | null,
  webhookId: string,
): Promise<
  { ok: true; detail?: Record<string, unknown> } | { ok: false; error: string }
> {
  const [webhook] = await db
    .select()
    .from(webhookTable)
    .where(
      and(
        eq(webhookTable.id, webhookId),
        eq(webhookTable.workspaceId, ctx.automation.workspaceId),
      ),
    )
    .limit(1);
  if (!webhook || !webhook.active || webhook.disabledAt)
    return failure(ACTION_ERRORS.referenceUnavailable);
  const projectId = item?.projectId ?? ctx.envelope.scope.projectId ?? null;

  // AM-12 / WH-14: the webhook's owner must still see the event, and so must the rule's
  // effective role (never the author). The delivery worker re-checks the owner at send time.
  if (
    projectId &&
    !roleMayAct(ctx.role, "work_item:read", {
      workspaceId: ctx.automation.workspaceId,
      projectId,
    })
  )
    return failure(ACTION_ERRORS.roleLacksCapability);
  const ownerReach = await decideOwnerReach(db, webhook.createdBy, {
    workspaceId: ctx.automation.workspaceId,
    projectId,
    workItemEvent: item !== null,
  });
  if (ownerReach.kind !== "in_reach")
    return failure("webhook_owner_out_of_reach");

  const projected = projectWebhookEnvelope(ctx.envelope, {
    instance: ctx.instance,
    workItem: item ? { key: item.key, title: item.title } : null,
    project: null,
  });
  if (projected.kind !== "deliver") return failure("no_visible_changes");
  const body = {
    ...projected.body,
    data: {
      ...projected.body.data,
      automation: { id: ctx.automation.id, name: ctx.automation.name },
    },
  };
  const [delivery] = await db
    .insert(webhookDeliveryTable)
    .values({
      id: createId(),
      webhookId: webhook.id,
      workspaceId: webhook.workspaceId,
      eventId: ctx.envelope.id,
      eventKind: ctx.envelope.kind,
      source: "automation",
      projectId,
      requestBody: body,
      state: "pending",
    })
    .returning({ id: webhookDeliveryTable.id });
  return { ok: true, detail: { deliveryId: delivery?.id ?? null } };
}

/** Executes one action; never throws (an exception becomes a recorded failure). */
export async function executeAction(
  action: AutomationAction,
  index: number,
  ctx: ActionContext,
): Promise<ActionResult> {
  const result = await executeActionInner(action, ctx).catch(
    (error: unknown) => {
      const message =
        error instanceof Error &&
        /^[A-Za-z0-9_ ,.:'-]{1,200}$/.test(error.message)
          ? error.message
          : "action_failed";
      return failure(message);
    },
  );
  return { index, type: action.type, ...result };
}

async function executeActionInner(
  action: AutomationAction,
  ctx: ActionContext,
): Promise<
  { ok: true; detail?: Record<string, unknown> } | { ok: false; error: string }
> {
  const item = await ctx.loadItem();
  if (action.type !== "call_webhook" && !item)
    return failure(ACTION_ERRORS.noWorkItem);

  const projectId = item?.projectId ?? ctx.envelope.scope.projectId ?? null;
  if (
    item &&
    !roleMayAct(ctx.role, requiredCapability(action), {
      workspaceId: item.workspaceId,
      projectId: item.projectId,
    })
  )
    return failure(ACTION_ERRORS.roleLacksCapability);
  if (!item && projectId === null && action.type !== "call_webhook")
    return failure(ACTION_ERRORS.noWorkItem);

  switch (action.type) {
    case "assign":
      return viaBulk(ctx, item as LoadedWorkItem, {
        operation: "assign",
        assigneeId: action.assigneeId,
        expectedCurrentAssigneeIds: {
          [(item as LoadedWorkItem).key]: (item as LoadedWorkItem).facts
            .assigneeId,
        },
      });
    case "set_priority":
      return viaBulk(ctx, item as LoadedWorkItem, {
        operation: "set_priority",
        priority: action.priority,
      });
    case "set_due_date":
      return viaBulk(ctx, item as LoadedWorkItem, {
        operation: "set_due_date",
        dueDate:
          action.dueInDays === null
            ? null
            : new Date(Date.now() + action.dueInDays * 86_400_000),
      });
    case "add_label":
    case "remove_label":
      return viaBulk(ctx, item as LoadedWorkItem, {
        operation: action.type,
        labelId: action.labelId,
      });
    case "add_watcher":
      return addWatcher(ctx, item as LoadedWorkItem, action.personId);
    case "call_webhook":
      return callWebhook(ctx, item, action.webhookId);
    case "post_comment":
      return postComment(ctx, item as LoadedWorkItem, action);
    case "notify":
      return notifyTeam(
        ctx,
        item as LoadedWorkItem,
        action,
        await placeholderValues(ctx, item as LoadedWorkItem),
      );
    case "transition":
      return transitionItem(ctx, item as LoadedWorkItem, action);
  }
}
