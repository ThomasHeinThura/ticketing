import type { DbTransaction } from "../events/outbox";
import { findMostSpecificPreferenceRow } from "./fanout.repository";

export type NotificationCadence = "off" | "hourly" | "daily";
export type EffectiveNotificationPreference = {
  enabled: boolean;
  digest: NotificationCadence;
  source: "project" | "workspace" | "global" | "default" | "in_app";
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
  const selected = await findMostSpecificPreferenceRow(tx, input);
  if (!selected)
    return defaultExternalPreference(input.eventKind, input.channel);
  return {
    enabled: selected.enabled,
    digest: selected.digest,
    source: selected.scope,
  };
}
