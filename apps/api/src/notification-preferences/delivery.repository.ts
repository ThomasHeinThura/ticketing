import { and, eq, sql } from "drizzle-orm";
import db from "../database";
import {
  instanceSettingTable,
  notificationTable,
  personTable,
  projectTable,
  taskTable,
  userNotificationPreferenceTable,
  userNotificationWorkspaceRuleTable,
  userTable,
  workspaceTable,
} from "../database/schema";
import { reachableWorkspacePredicate } from "../utils/workspace-access-middleware";

export async function findDeliveryNotification(notificationId: string) {
  return await db.query.notificationTable.findFirst({
    where: eq(notificationTable.id, notificationId),
  });
}

export async function findDeliveryTaskContext(resourceId: string) {
  return await db
    .select({
      taskId: taskTable.id,
      taskTitle: taskTable.title,
      projectId: projectTable.id,
      projectName: projectTable.name,
      workspaceId: workspaceTable.id,
      workspaceName: workspaceTable.name,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .innerJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .where(eq(taskTable.id, resourceId))
    .limit(1);
}

export async function findDeliveryWorkspaceContext(
  resourceId: string,
  userId: string,
) {
  return await db
    .select({
      workspaceId: workspaceTable.id,
      workspaceName: workspaceTable.name,
    })
    .from(workspaceTable)
    .where(
      and(
        eq(workspaceTable.id, resourceId),
        reachableWorkspacePredicate(workspaceTable.id, userId),
      ),
    )
    .limit(1);
}

export async function findDeliveryUser(userId: string) {
  return await db
    .select({
      email: userTable.email,
      name: userTable.name,
      locale: userTable.locale,
    })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
}

export async function findDeliveryPreference(userId: string) {
  return await db.query.userNotificationPreferenceTable.findFirst({
    where: eq(userNotificationPreferenceTable.userId, userId),
  });
}

export async function findDeliveryWorkspaceRule(
  userId: string,
  workspaceId: string,
) {
  return await db.query.userNotificationWorkspaceRuleTable.findFirst({
    where: and(
      eq(userNotificationWorkspaceRuleTable.userId, userId),
      eq(userNotificationWorkspaceRuleTable.workspaceId, workspaceId),
    ),
    with: {
      selectedProjects: true,
    },
  });
}

/**
 * `NO-3`: the recipient's quiet-hours window (on the `person` row of this user) and the instance
 * zone it falls back to. Null fields when the user has no person row or none is configured.
 */
export async function findDeliveryQuietHours(userId: string) {
  const [person] = await db
    .select({
      start: personTable.quietHoursStart,
      end: personTable.quietHoursEnd,
      timezone: personTable.quietHoursTimezone,
    })
    .from(personTable)
    .where(eq(personTable.userId, userId))
    .limit(1);
  const [instance] = await db
    .select({ timezone: instanceSettingTable.timezone })
    .from(instanceSettingTable)
    .where(eq(instanceSettingTable.id, "singleton"))
    .limit(1);
  return {
    setting: {
      start: person?.start ?? null,
      end: person?.end ?? null,
      timezone: person?.timezone ?? null,
    },
    fallbackTimezone: instance?.timezone ?? "UTC",
  };
}

/**
 * Durable quiet-hours hold for the legacy delivery path. The marker lives in the existing
 * `notification.event_data` jsonb (no new table); a restart therefore cannot lose a held
 * delivery. `scheduler/notification-digest-release.ts` releases the rows once the time passes.
 */
export const QUIET_HOURS_HOLD_KEY = "quietHoursHeldUntil";

/** Hold a notification's external delivery until `until`. */
export async function holdDeliveryUntil(notificationId: string, until: Date) {
  await db.execute(sql`
    UPDATE notification
    SET event_data = CASE WHEN event_data IS NULL OR jsonb_typeof(event_data) <> 'object'
        THEN '{}'::jsonb ELSE event_data END
        || jsonb_build_object(${QUIET_HOURS_HOLD_KEY}::text, ${until.toISOString()}::text)
    WHERE id = ${notificationId}`);
}

/**
 * Claims up to `limit` held notifications that are due at `now`. The claim pushes the marker
 * `leaseMs` forward instead of deleting it, so a replica that dies mid-delivery leaves the row
 * to be retried rather than lost. Concurrent replicas skip each other's rows.
 */
export async function claimDueHeldDeliveries(
  now: Date,
  leaseMs: number,
  limit: number,
  maxAgeMs: number,
): Promise<Array<{ id: string; lease: string }>> {
  const lease = new Date(now.getTime() + leaseMs).toISOString();
  const oldest = new Date(now.getTime() - maxAgeMs);
  const result = await db.execute<{ id: string }>(sql`
    UPDATE notification
    SET event_data = event_data || jsonb_build_object(${QUIET_HOURS_HOLD_KEY}::text, ${lease}::text)
    WHERE id IN (
      SELECT id FROM notification
      WHERE created_at > ${oldest}
        AND jsonb_typeof(event_data) = 'object'
        AND event_data->>${QUIET_HOURS_HOLD_KEY} IS NOT NULL
        AND (event_data->>${QUIET_HOURS_HOLD_KEY})::timestamptz <= ${now.toISOString()}::timestamptz
      ORDER BY created_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`);
  return result.rows.map((row) => ({ id: row.id, lease }));
}

/** Drops the hold marker, but only when it is still the lease this releaser took. */
export async function clearDeliveryHold(notificationId: string, lease: string) {
  await db.execute(sql`
    UPDATE notification
    SET event_data = NULLIF(event_data - ${QUIET_HOURS_HOLD_KEY}::text, '{}'::jsonb)
    WHERE id = ${notificationId}
      AND jsonb_typeof(event_data) = 'object'
      AND event_data->>${QUIET_HOURS_HOLD_KEY} = ${lease}`);
}
