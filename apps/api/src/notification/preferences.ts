import { sql } from "drizzle-orm";
import type { DbTransaction } from "../events/outbox";

export type NotificationCadence = "off" | "hourly" | "daily";
export type EffectiveNotificationPreference = {
  enabled: boolean;
  digest: NotificationCadence;
  source: "project" | "workspace" | "global" | "default" | "in_app";
};

type PreferenceRow = {
  scope: "global" | "workspace" | "project";
  enabled: boolean;
  digest: NotificationCadence;
};

export function defaultExternalPreference(
  eventKind: string,
  channel: string,
): EffectiveNotificationPreference {
  if (channel === "in_app")
    return { enabled: true, digest: "off", source: "in_app" };
  if (channel !== "notify.email")
    return { enabled: false, digest: "off", source: "default" };
  const enabled =
    eventKind === "work_item.assigned" ||
    eventKind === "work_item.unassigned" ||
    eventKind === "work_item.mentioned" ||
    eventKind.startsWith("approval.") ||
    eventKind === "sla.breached";
  return { enabled, digest: "off", source: "default" };
}

/** Resolve the event-time preference, most-specific scope first, per NO-1/NO-5. */
export async function resolveNotificationPreference(
  tx: DbTransaction,
  input: {
    personId: string;
    workspaceId: string;
    projectId: string | null;
    eventKind: string;
    channel: string;
  },
): Promise<EffectiveNotificationPreference> {
  if (input.channel === "in_app")
    return defaultExternalPreference(input.eventKind, input.channel);
  const result = await tx.execute(sql`
    SELECT scope, enabled, digest
      FROM notification_preference
     WHERE person_id = ${input.personId}
       AND channel = ${input.channel}
       AND event_kind = ${input.eventKind}
       AND (
         scope = 'global' OR
         (scope = 'workspace' AND scope_id = ${input.workspaceId}) OR
         (scope = 'project' AND ${input.projectId}::text IS NOT NULL AND scope_id = ${input.projectId})
       )
     ORDER BY CASE scope WHEN 'project' THEN 0 WHEN 'workspace' THEN 1 ELSE 2 END
     LIMIT 1
  `);
  const selected = (result.rows as PreferenceRow[])[0];
  if (!selected)
    return defaultExternalPreference(input.eventKind, input.channel);
  return {
    enabled: selected.enabled,
    digest: selected.digest,
    source: selected.scope,
  };
}
