import { sendNotificationEmail } from "@taskdesk/email";
import { sql } from "drizzle-orm";
import { getConfiguredAgentOrigin } from "../auth";
import db from "../database";
import type { ClaimedNotificationDelivery } from "../database/repositories/notification-delivery.repository";
import type { DbTransaction } from "../events/outbox";
import { z } from "../openapi";
import { evaluateCurrentNotificationReachAndPreference } from "./current-eligibility";
import { NotificationProviderOutcomeAmbiguous } from "./delivery-errors";
import { configuredMentionChannels } from "./fanout.repository";
import type {
  NotificationEligibility,
  NotificationOutboxRuntime,
} from "./outbox-drain";
import {
  type PreferenceSelector,
  signNotificationPreferenceLink,
} from "./preference-link";
import { resolveNotificationPreference } from "./preferences";

async function emailDestination(tx: DbTransaction, personId: string) {
  const result =
    await tx.execute(sql`SELECT u.email, u.locale FROM person p JOIN "user" u ON u.id = p.user_id
    WHERE p.id = ${personId} AND p.active AND p.side = 'staff'`);
  const row = result.rows[0] as
    | { email: string; locale: string | null }
    | undefined;
  return row && z.email().safeParse(row.email).success ? row : null;
}
async function current(
  tx: DbTransaction,
  delivery: ClaimedNotificationDelivery,
): Promise<NotificationEligibility> {
  if (
    delivery.channel !== "notify.email" ||
    delivery.eventKind !== "work_item.mentioned" ||
    delivery.resourceType !== "comment"
  )
    return { kind: "unresolved", reason: "destination_unresolved" };
  if (!(await configuredMentionChannels(tx)).includes("notify.email"))
    return {
      kind: "defer",
      until: new Date(Date.now() + 60_000),
      reason: "provider_unavailable",
    };
  const eligibility = await evaluateCurrentNotificationReachAndPreference(
    tx,
    delivery,
  );
  if (
    eligibility.kind === "quiet_hours_unresolved" ||
    eligibility.kind === "destination_unresolved"
  )
    return { kind: "unresolved", reason: eligibility.kind };
  if (eligibility.kind !== "eligible") return eligibility;
  if (!(await emailDestination(tx, delivery.recipientPersonId)))
    return { kind: "unresolved", reason: "destination_unresolved" };
  // The first settings journey edits global mention preferences only. Scoped
  // candidates retain their row and wait for the corresponding settings surface.
  if ((await selector(tx, delivery)).scope !== "global")
    return { kind: "unresolved", reason: "destination_unresolved" };
  return eligibility;
}
async function selector(
  tx: DbTransaction,
  delivery: ClaimedNotificationDelivery,
): Promise<PreferenceSelector> {
  const envelope =
    typeof delivery.payload === "string"
      ? JSON.parse(delivery.payload)
      : delivery.payload;
  const projectId =
    (envelope as { scope: { projectId?: string } }).scope.projectId ?? null;
  const preference = await resolveNotificationPreference(tx, {
    personId: delivery.recipientPersonId,
    workspaceId: delivery.workspaceId,
    projectId,
    eventKind: delivery.eventKind,
    channel: delivery.channel,
  });
  const scope =
    preference.source === "project"
      ? "project"
      : preference.source === "workspace"
        ? "workspace"
        : "global";
  return {
    eventKind: delivery.eventKind,
    channel: delivery.channel,
    scope,
    scopeId:
      scope === "project"
        ? projectId
        : scope === "workspace"
          ? delivery.workspaceId
          : null,
  };
}
/** Only the native staff comment-mention journey is registered in this slice. */
export function immediateNotificationRuntime(
  send = sendNotificationEmail,
): NotificationOutboxRuntime {
  return {
    evaluateCurrentEligibility: current,
    send: async (_channel, projection, options) => {
      const context = await db.transaction(async (tx) => {
        const eligibility = await current(tx, options.delivery);
        if (eligibility.kind !== "eligible")
          throw new Error("Notification eligibility changed");
        const destination = await emailDestination(
          tx,
          options.delivery.recipientPersonId,
        );
        if (!destination)
          throw new Error("Notification destination unavailable");
        return {
          destination,
          selector: await selector(tx, options.delivery),
          projection: eligibility.projection,
        };
      });
      if (options.signal.aborted)
        throw new Error("Notification attempt cancelled");
      const token = signNotificationPreferenceLink({
        audience: "agent",
        recipientPersonId: options.delivery.recipientPersonId,
        selector: context.selector,
      });
      const origin = getConfiguredAgentOrigin();
      const result = await send(
        context.destination.email,
        projection.title,
        {
          title: context.projection.title,
          message: context.projection.body,
          actionUrl: new URL(context.projection.url, origin).href,
          preferenceUrl: `${origin}/agent/settings/profile/notifications#preference_token=${token}`,
          locale: context.destination.locale,
        },
        {
          signal: options.signal,
          deadlineMs: 25_000,
          idempotencyKey: options.idempotencyKey,
          authorize: () =>
            db.transaction(async (tx) => {
              if (options.signal.aborted) return false;
              const eligibility = await current(tx, options.delivery);
              const destination = await emailDestination(
                tx,
                options.delivery.recipientPersonId,
              );
              return (
                eligibility.kind === "eligible" &&
                destination?.email === context.destination.email &&
                eligibility.projection.url === context.projection.url &&
                eligibility.projection.title === context.projection.title &&
                eligibility.projection.body === context.projection.body &&
                JSON.stringify(await selector(tx, options.delivery)) ===
                  JSON.stringify(context.selector)
              );
            }),
        },
      ).catch((error: unknown) => {
        if (
          error &&
          typeof error === "object" &&
          "ambiguous" in error &&
          error.ambiguous === true
        )
          throw new NotificationProviderOutcomeAmbiguous();
        throw error;
      });
      if (!result.success) throw new Error("Notification provider unavailable");
    },
  };
}
