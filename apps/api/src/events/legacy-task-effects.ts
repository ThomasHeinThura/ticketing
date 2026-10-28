import { createId } from "@paralleldrive/cuid2";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { sql } from "drizzle-orm";
import { insertRequiredTaskActivity } from "../activity/repository";
import type { Executor, Transaction } from "../database/executor";
import { publishEvent } from "../events";
import type { DomainEventEnvelope } from "../events/outbox";
import { notificationDedupeKey } from "../notification/delivery-primitives";
import { attachDigestWindow } from "../notification/digest-writer";
import {
  findNotificationPreferenceRow,
  findProjectWorkspaceId,
  insertNotificationRow,
} from "../notification/inbox.repository";
import { resolveNotificationPreference } from "../notification/preferences";
import { userCanReachTask } from "../notification/task-reach.repository";
import { buildDeliveryContent } from "../notification-preferences/delivery";
import { QUIET_HOURS_HOLD_KEY } from "../notification-preferences/delivery.repository";

export type LegacyTaskNotification = {
  id: string;
  userId: string;
  eventId?: string;
};

type LegacyNotificationType =
  | "task_created"
  | "task_status_changed"
  | "task_assignee_changed"
  | "time_entry_created"
  | "task_comment"
  | "task_mention";

type LegacyNotificationInput = {
  userId: string;
  type: LegacyNotificationType;
  taskId: string;
  projectId: string;
  eventData: Record<string, unknown>;
};

async function loadLegacyEventEnvelope(
  tx: Transaction,
  input: {
    eventId: string;
    eventKind: string;
    workspaceId: string;
    projectId: string;
  },
): Promise<DomainEventEnvelope<Record<string, unknown>>> {
  const result = await tx.execute(sql`
    SELECT payload
      FROM outbox
     WHERE event_id = ${input.eventId}
       AND kind = ${input.eventKind}
       AND workspace_id = ${input.workspaceId}
     LIMIT 1
  `);
  const value = result.rows[0]?.payload;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Legacy notification parent event is unavailable");
  }
  const event = value as Partial<DomainEventEnvelope<Record<string, unknown>>>;
  if (
    event.id !== input.eventId ||
    event.kind !== input.eventKind ||
    !event.scope ||
    event.scope.workspaceId !== input.workspaceId ||
    event.scope.projectId !== input.projectId
  ) {
    throw new Error("Legacy notification parent event scope changed");
  }
  return event as DomainEventEnvelope<Record<string, unknown>>;
}

const LEGACY_CHANNEL_SETTINGS = {
  "notify.email": { personal: "emailEnabled", workspace: "emailEnabled" },
  "notify.webhook": {
    personal: "webhookEnabled",
    workspace: "webhookEnabled",
  },
  "notify.ntfy": { personal: "ntfyEnabled", workspace: "ntfyEnabled" },
  "notify.gotify": { personal: "gotifyEnabled", workspace: "gotifyEnabled" },
} as const;

/** Persist the history projection in the same transaction as the legacy task write. */
export async function insertLegacyTaskActivity(
  tx: Executor,
  identity: ResolvedIdentity,
  input: {
    taskId: string;
    type: string;
    userId: string;
    eventData?: Record<string, unknown> | null;
  },
) {
  return insertRequiredTaskActivity(tx, identity, {
    ...input,
    content: null,
    eventData: input.eventData ?? null,
  });
}

/**
 * Materialize the old inbox row and per-channel children under the same parent event.
 * Immediate children carry no legacy quiet-hours hold marker; opted-in digest children join
 * the canonical event-time digest window in this same transaction.
 */
export async function insertLegacyTaskNotification(
  tx: Transaction,
  input: LegacyNotificationInput & { eventId: string; eventKind: string },
): Promise<LegacyTaskNotification | null> {
  if (!(await userCanReachTask(input.userId, input.taskId, tx))) return null;
  const project = await findProjectWorkspaceId(input.projectId, tx);
  if (!project) return null;

  const recipientResult = await tx.execute(sql`
    SELECT p.id AS "personId", p.side, p.active
      FROM person p
     WHERE p.user_id = ${input.userId}
     FOR SHARE
  `);
  const recipient = recipientResult.rows[0] as
    | { personId: string; side: string; active: boolean }
    | undefined;
  if (!recipient?.active || recipient.side !== "staff") return null;

  const preferenceResult = await tx.execute(sql`
    SELECT email_enabled AS "emailEnabled",
           webhook_enabled AS "webhookEnabled",
           ntfy_enabled AS "ntfyEnabled",
           gotify_enabled AS "gotifyEnabled",
           task_assignment_enabled AS "taskAssignmentEnabled",
           task_status_change_enabled AS "taskStatusChangeEnabled",
           task_comment_enabled AS "taskCommentEnabled",
           email, ntfy_server_url AS "ntfyServerUrl", ntfy_topic AS "ntfyTopic",
           gotify_server_url AS "gotifyServerUrl", gotify_token AS "gotifyToken",
           webhook_url AS "webhookUrl"
      FROM user_notification_preference p
      JOIN "user" u ON u.id = p.user_id
     WHERE p.user_id = ${input.userId}
     LIMIT 1
  `);
  const preference = preferenceResult.rows[0] as
    | Record<string, unknown>
    | undefined;

  const typePreference =
    input.type === "task_created" || input.type === "task_assignee_changed"
      ? "taskAssignmentEnabled"
      : input.type === "task_status_changed"
        ? "taskStatusChangeEnabled"
        : input.type === "task_comment" || input.type === "task_mention"
          ? "taskCommentEnabled"
          : null;
  if (typePreference && preference?.[typePreference] === false) return null;

  const ruleResult = await tx.execute(sql`
    SELECT id, is_active AS "isActive", project_mode AS "projectMode",
           email_enabled AS "emailEnabled", webhook_enabled AS "webhookEnabled",
           ntfy_enabled AS "ntfyEnabled", gotify_enabled AS "gotifyEnabled"
      FROM user_notification_workspace_rule
     WHERE user_id = ${input.userId} AND workspace_id = ${project.workspaceId}
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
  const selectedResult =
    rule?.projectMode === "selected"
      ? await tx.execute(sql`
        SELECT 1 FROM user_notification_workspace_project
         WHERE workspace_rule_id = ${rule.id} AND project_id = ${input.projectId}
         LIMIT 1
      `)
      : null;
  const workspaceSelected = Boolean(
    rule?.isActive &&
      (rule.projectMode !== "selected" || selectedResult?.rows.length),
  );

  const eventData = { ...input.eventData };
  delete eventData[QUIET_HOURS_HOLD_KEY];
  const content = buildDeliveryContent({
    type: input.type,
    title: null,
    content: null,
    eventData,
  });
  const notificationId = createId();
  const notification = await tx.execute(sql`
    INSERT INTO notification
      (id, user_id, person_id, event_id, kind, title, body, content,
       resource_type, resource_id, is_read, read_at, type, event_data)
    VALUES
      (${notificationId}, ${input.userId}, ${recipient.personId}, ${input.eventId},
       ${input.eventKind}, ${content.title}, ${content.body}, ${content.body},
       'task', ${input.taskId}, false, NULL, ${input.type}, ${JSON.stringify(eventData)}::jsonb)
    ON CONFLICT (event_id, person_id) WHERE event_id IS NOT NULL DO NOTHING
    RETURNING id
  `);

  if (workspaceSelected && preference) {
    const eligibleDestination = (
      channel: keyof typeof LEGACY_CHANNEL_SETTINGS,
    ) => {
      if (preference[LEGACY_CHANNEL_SETTINGS[channel].personal] !== true)
        return false;
      if (rule?.[LEGACY_CHANNEL_SETTINGS[channel].workspace] !== true)
        return false;
      if (channel === "notify.email") return Boolean(preference.email);
      if (channel === "notify.webhook") return Boolean(preference.webhookUrl);
      if (channel === "notify.ntfy")
        return Boolean(preference.ntfyServerUrl && preference.ntfyTopic);
      return Boolean(preference.gotifyServerUrl && preference.gotifyToken);
    };
    for (const channel of Object.keys(LEGACY_CHANNEL_SETTINGS) as Array<
      keyof typeof LEGACY_CHANNEL_SETTINGS
    >) {
      if (!eligibleDestination(channel)) continue;
      const dedupeKey = notificationDedupeKey({
        eventKind: input.eventKind,
        resourceType: "task",
        resourceId: input.taskId,
        personId: recipient.personId,
        channel,
      });
      const digestPreference = await resolveNotificationPreference(tx, {
        personId: recipient.personId,
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        eventKind: input.eventKind,
        channel,
      });
      // The legacy category/channel switches above remain the compatibility enablement gates;
      // the canonical event preference contributes only its persisted digest cadence here.
      let digestId: string | null = null;
      if (digestPreference.digest !== "off") {
        const event = await loadLegacyEventEnvelope(tx, {
          eventId: input.eventId,
          eventKind: input.eventKind,
          workspaceId: project.workspaceId,
          projectId: input.projectId,
        });
        digestId = (
          await attachDigestWindow({
            tx,
            event,
            recipientPersonId: recipient.personId,
            channel,
            cadence: digestPreference.digest,
          })
        ).id;
      }
      await tx.execute(sql`
        INSERT INTO notification_delivery
          (id, event_id, recipient_person_id, channel, workspace_id, organisation_id,
           dedupe_key, digest_id, state, attempts, next_attempt_at, created_at, updated_at)
        VALUES
          (${createId()}, ${input.eventId}, ${recipient.personId}, ${channel},
           ${project.workspaceId},
           (SELECT organisation_id FROM workspace WHERE id = ${project.workspaceId}),
           ${dedupeKey}, ${digestId}, 'pending', 0, clock_timestamp() AT TIME ZONE 'UTC',
           clock_timestamp() AT TIME ZONE 'UTC', clock_timestamp() AT TIME ZONE 'UTC')
        ON CONFLICT (event_id, recipient_person_id, channel) DO NOTHING
      `);
    }
  }

  return notification.rows.length
    ? { id: notificationId, userId: input.userId, eventId: input.eventId }
    : null;
}

/** Marker-backed legacy recovery fixture; producers must use the event-linked writer above. */
export async function insertLegacyMarkedNotificationForRecovery(
  tx: Executor,
  input: LegacyNotificationInput,
): Promise<LegacyTaskNotification | null> {
  if (!(await userCanReachTask(input.userId, input.taskId, tx))) return null;
  const project = await findProjectWorkspaceId(input.projectId, tx);
  if (!project) return null;
  const preferenceKey =
    input.type === "task_assignee_changed" || input.type === "task_created"
      ? "taskAssignmentEnabled"
      : input.type === "task_status_changed"
        ? "taskStatusChangeEnabled"
        : input.type === "task_comment" || input.type === "task_mention"
          ? "taskCommentEnabled"
          : null;
  if (preferenceKey) {
    const preference = await findNotificationPreferenceRow(input.userId, tx);
    if (preference?.[preferenceKey] === false) return null;
  }
  const old = await insertNotificationRow(
    {
      id: createId(),
      userId: input.userId,
      title: null,
      content: null,
      type: input.type,
      eventData: {
        ...input.eventData,
        projectId: input.projectId,
        workspaceId: project.workspaceId,
        [QUIET_HOURS_HOLD_KEY]: new Date().toISOString(),
      },
      resourceId: input.taskId,
      resourceType: "task",
    },
    tx,
  );
  return old ? { id: old.id, userId: input.userId } : null;
}

/** Existing marker-backed notifications remain owned by the old all-channel worker. */
export async function dispatchLegacyTaskNotification(
  notification: LegacyTaskNotification | null,
): Promise<void> {
  if (!notification || notification.eventId) return;
  await publishEvent("notification.created", {
    notificationId: notification.id,
    userId: notification.userId,
  });
}
