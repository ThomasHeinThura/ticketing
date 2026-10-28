import { sql } from "drizzle-orm";
import db from "../database";
import type { ClaimedNotificationDelivery } from "../database/repositories/notification-delivery.repository";
import { isLegacyTaskCompatibilityKey } from "../events/event-keys";
import type { DbTransaction } from "../events/outbox";
import {
  legacyQuietHoursDecision,
  sendLegacyNotificationChannel,
} from "../notification-preferences/delivery";
import type {
  NotificationEligibility,
  NotificationOutboxRuntime,
} from "./outbox-drain";
import { userCanReachTask } from "./task-reach.repository";

type LegacyEnvelope = {
  id: string;
  kind: string;
  scope: { workspaceId?: string; projectId?: string };
  payload: { taskId?: string; key?: string; projectId?: string };
};

const LEGACY_NOTIFIABLE_EVENT_KINDS = new Set([
  "comment.created",
  "task.assignee_changed",
  "task.created",
  "task.description_changed",
  "task.status_changed",
  "task.updated",
  "time-entry.created",
]);
const LEGACY_NOTIFICATION_CHANNELS = new Set([
  "notify.email",
  "notify.webhook",
  "notify.ntfy",
  "notify.gotify",
]);

export function parseLegacyTaskDeliveryEnvelope(
  delivery: ClaimedNotificationDelivery,
): LegacyEnvelope | null {
  let value: unknown = delivery.payload;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as LegacyEnvelope;
  if (
    envelope.id !== delivery.eventId ||
    envelope.kind !== delivery.eventKind ||
    !isLegacyTaskCompatibilityKey(envelope.kind) ||
    !LEGACY_NOTIFIABLE_EVENT_KINDS.has(envelope.kind) ||
    delivery.resourceType !== "task" ||
    !LEGACY_NOTIFICATION_CHANNELS.has(delivery.channel) ||
    !envelope.scope ||
    envelope.scope.workspaceId !== delivery.workspaceId ||
    typeof envelope.scope.projectId !== "string" ||
    !envelope.payload ||
    envelope.payload.taskId !== delivery.resourceId ||
    envelope.payload.key !== delivery.resourceId ||
    envelope.payload.projectId !== envelope.scope.projectId
  )
    return null;
  return envelope;
}

async function currentLegacyEligibility(
  tx: DbTransaction,
  delivery: ClaimedNotificationDelivery,
): Promise<NotificationEligibility> {
  if (
    delivery.resourceType !== "task" ||
    !delivery.resourceId ||
    !delivery.title ||
    !delivery.body ||
    ![
      "notify.email",
      "notify.webhook",
      "notify.ntfy",
      "notify.gotify",
    ].includes(delivery.channel)
  )
    return { kind: "suppress", reason: "legacy_mapping_missing" };
  const envelope = parseLegacyTaskDeliveryEnvelope(delivery);
  if (!envelope) return { kind: "suppress", reason: "legacy_mapping_mismatch" };

  const contextResult = await tx.execute(sql`
    SELECT t.id AS "taskId", t.project_id AS "projectId",
           p.workspace_id AS "workspaceId", w.organisation_id AS "organisationId"
      FROM task t
      JOIN project p ON p.id = t.project_id
      JOIN workspace w ON w.id = p.workspace_id
     WHERE t.id = ${delivery.resourceId}
       AND t.project_id = ${envelope.scope.projectId}
       AND p.workspace_id = ${delivery.workspaceId}
     LIMIT 1
  `);
  const context = contextResult.rows[0] as
    | {
        taskId: string;
        projectId: string;
        workspaceId: string;
        organisationId: string | null;
      }
    | undefined;
  if (!context || context.organisationId !== delivery.organisationId)
    return { kind: "suppress", reason: "legacy_resource_scope_changed" };

  const inboxResult = await tx.execute(sql`
    SELECT n.type
      FROM notification n
     WHERE n.event_id = ${delivery.eventId}
       AND n.person_id = ${delivery.recipientPersonId}
       AND n.kind = ${delivery.eventKind}
       AND n.resource_type = 'task'
       AND n.resource_id = ${delivery.resourceId}
       AND (n.event_data IS NULL OR NOT (n.event_data ? 'quietHoursHeldUntil'))
     LIMIT 1
  `);
  const inbox = inboxResult.rows[0] as { type: string } | undefined;
  if (!inbox)
    return { kind: "suppress", reason: "legacy_inbox_binding_missing" };

  const personResult = await tx.execute(sql`
    SELECT p.user_id AS "userId", p.side, p.active
      FROM person p
     WHERE p.id = ${delivery.recipientPersonId}
     FOR SHARE
  `);
  const person = personResult.rows[0] as
    | { userId: string | null; side: string; active: boolean }
    | undefined;
  if (!person?.active || !person.userId || person.side !== "staff")
    return {
      kind: "suppress",
      reason: "legacy_recipient_inactive_or_nonstaff",
    };
  if (!(await userCanReachTask(person.userId, delivery.resourceId, tx)))
    return { kind: "suppress", reason: "legacy_task_unreachable" };

  const preferenceResult = await tx.execute(sql`
    SELECT email_enabled AS "emailEnabled", webhook_enabled AS "webhookEnabled",
           ntfy_enabled AS "ntfyEnabled", gotify_enabled AS "gotifyEnabled",
           task_assignment_enabled AS "taskAssignmentEnabled",
           task_status_change_enabled AS "taskStatusChangeEnabled",
           task_comment_enabled AS "taskCommentEnabled",
           email, webhook_url AS "webhookUrl", ntfy_server_url AS "ntfyServerUrl",
           ntfy_topic AS "ntfyTopic", gotify_server_url AS "gotifyServerUrl",
           gotify_token AS "gotifyToken"
      FROM user_notification_preference p
      JOIN "user" u ON u.id = p.user_id
     WHERE p.user_id = ${person.userId}
     LIMIT 1
  `);
  const preference = preferenceResult.rows[0] as
    | Record<string, unknown>
    | undefined;
  if (!preference)
    return { kind: "suppress", reason: "legacy_preference_missing" };
  const categoryPreference =
    inbox.type === "task_created" || inbox.type === "task_assignee_changed"
      ? "taskAssignmentEnabled"
      : inbox.type === "task_status_changed"
        ? "taskStatusChangeEnabled"
        : inbox.type === "task_comment" || inbox.type === "task_mention"
          ? "taskCommentEnabled"
          : null;
  if (categoryPreference && preference[categoryPreference] !== true)
    return { kind: "suppress", reason: "legacy_category_disabled" };
  const channelPreference = {
    "notify.email": ["emailEnabled", "email"],
    "notify.webhook": ["webhookEnabled", "webhookUrl"],
    "notify.ntfy": ["ntfyEnabled", "ntfyServerUrl", "ntfyTopic"],
    "notify.gotify": ["gotifyEnabled", "gotifyServerUrl", "gotifyToken"],
  } as const;
  const fields =
    channelPreference[delivery.channel as keyof typeof channelPreference];
  if (!fields.every((field) => Boolean(preference[field])))
    return { kind: "suppress", reason: "legacy_channel_disabled" };

  const ruleResult = await tx.execute(sql`
    SELECT id, is_active AS "isActive", project_mode AS "projectMode",
           email_enabled AS "emailEnabled", webhook_enabled AS "webhookEnabled",
           ntfy_enabled AS "ntfyEnabled", gotify_enabled AS "gotifyEnabled"
      FROM user_notification_workspace_rule
     WHERE user_id = ${person.userId} AND workspace_id = ${delivery.workspaceId}
     LIMIT 1
  `);
  const rule = ruleResult.rows[0] as
    | {
        id: string;
        isActive: boolean;
        projectMode: string;
        emailEnabled: boolean;
        webhookEnabled: boolean;
        ntfyEnabled: boolean;
        gotifyEnabled: boolean;
      }
    | undefined;
  if (!rule?.isActive)
    return { kind: "suppress", reason: "legacy_workspace_disabled" };
  const workspaceChannelEnabled = {
    "notify.email": rule.emailEnabled,
    "notify.webhook": rule.webhookEnabled,
    "notify.ntfy": rule.ntfyEnabled,
    "notify.gotify": rule.gotifyEnabled,
  };
  if (
    !workspaceChannelEnabled[
      delivery.channel as keyof typeof workspaceChannelEnabled
    ]
  )
    return { kind: "suppress", reason: "legacy_workspace_channel_disabled" };
  if (rule.projectMode === "selected") {
    const selected = await tx.execute(sql`
      SELECT 1 FROM user_notification_workspace_project
       WHERE workspace_rule_id = ${rule.id} AND project_id = ${context.projectId}
       LIMIT 1
    `);
    if (!selected.rows.length)
      return { kind: "suppress", reason: "legacy_project_not_selected" };
  }

  const quiet = await legacyQuietHoursDecision(person.userId, new Date());
  if (quiet.kind === "defer")
    return { kind: "defer", until: quiet.until, reason: "quiet_hours" };
  if (quiet.kind === "withhold")
    return { kind: "unresolved", reason: "quiet_hours_unresolved" };

  const clientUrl = process.env.TASKDESK_AGENT_URL || "http://localhost:5173";
  const url = `${clientUrl}/dashboard/workspace/${context.workspaceId}/project/${context.projectId}/task/${context.taskId}`;
  return {
    kind: "eligible",
    projection: {
      title: delivery.title,
      body: delivery.body,
      url,
      audience: "agent",
    },
  };
}

export function legacyTaskNotificationRuntime(
  sendChannel: typeof sendLegacyNotificationChannel = sendLegacyNotificationChannel,
): NotificationOutboxRuntime {
  return {
    evaluateCurrentEligibility: currentLegacyEligibility,
    send: async (channel, _projection, options) => {
      const authorize = async () => {
        if (options.signal.aborted) return false;
        const eligibility = await db.transaction((tx) =>
          currentLegacyEligibility(tx, options.delivery),
        );
        return eligibility.kind === "eligible";
      };
      await sendChannel({
        eventId: options.delivery.eventId,
        recipientPersonId: options.delivery.recipientPersonId,
        channel: channel as
          | "notify.email"
          | "notify.webhook"
          | "notify.ntfy"
          | "notify.gotify",
        idempotencyKey: options.idempotencyKey,
        signal: options.signal,
        authorize,
      });
    },
  };
}
