import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  type DbTransaction,
  type DomainEventEnvelope,
  enqueueOutboxEvent,
} from "../events/outbox";
import { dbNowUtc } from "../utils/db-time";
import { notificationDedupeKey } from "./delivery-primitives";
import { resolveNotificationPreference } from "./preferences";

/** Recipient facts are resolved by the event-specific canonical repository. */
export type NotificationRecipientCandidate = {
  personId: string;
  resourceType: string;
  resourceId: string;
  title: string;
  body: string;
  /** Configured, installed `notify.*` channels from the plugin registry. */
  channels: readonly string[];
};

export type NotificationDigestMembership = {
  id: string;
};

export type NotificationFanoutHooks = {
  /** Resolve event-specific recipients and their live resource reach in this transaction. */
  resolveRecipients(
    tx: DbTransaction,
    event: DomainEventEnvelope<Record<string, unknown>>,
  ): Promise<readonly NotificationRecipientCandidate[]>;
  /** Allocate/lock the event-time window group; required only for digest preferences. */
  attachDigest?: (input: {
    tx: DbTransaction;
    event: DomainEventEnvelope<Record<string, unknown>>;
    recipientPersonId: string;
    channel: string;
    cadence: "hourly" | "daily";
  }) => Promise<NotificationDigestMembership>;
};

/**
 * Transactional producer seam for a domain mutation that declares notification
 * recipients. Call this from the mutation transaction after its business writes;
 * outbox persistence and fan-out either commit together or roll back together.
 */
export async function enqueueNotificationEvent(
  tx: DbTransaction,
  event: DomainEventEnvelope<Record<string, unknown>>,
  hooks: NotificationFanoutHooks,
): Promise<void> {
  await enqueueOutboxEvent(tx, event);
  await materializeNotificationFanout(tx, event, hooks);
}

const RESOURCE_TYPES = new Set([
  "work_item",
  "comment",
  // `approval` rows are written only with the S3 recipient resolver, the 0120-anchored
  // send-time eligibility and the approval inbox read predicate (`approval-reach.ts`).
  "approval",
  "submission",
  "prerequisite",
  "project",
  "workspace",
  "webhook",
  "api_key",
  "automation",
  "pending_action",
  "identity_connection",
  "instance",
  "person",
]);

const URGENT_EVENT_KINDS = new Set([
  "sla.breached",
  "approval.expiring",
  "work_item.mentioned",
]);

/**
 * Writes event inbox rows and external delivery children in the same transaction as
 * the domain event. Recipient resolution and digest-window calculation are deliberately
 * injected from their canonical repositories; an omitted resolver is never treated as
 * an empty recipient set by this function.
 */
export async function materializeNotificationFanout(
  tx: DbTransaction,
  event: DomainEventEnvelope<Record<string, unknown>>,
  hooks: NotificationFanoutHooks,
): Promise<void> {
  const candidates = await hooks.resolveRecipients(tx, event);
  const actorPersonId = event.actor.type === "person" ? event.actor.id : null;
  const distinct = new Map<string, NotificationRecipientCandidate>();
  for (const candidate of candidates) {
    if (candidate.personId === actorPersonId) continue;
    if (!RESOURCE_TYPES.has(candidate.resourceType) || !candidate.resourceId)
      continue;
    if (!candidate.title || !candidate.body) {
      throw new TypeError(
        "Notification projection requires a safe title and body",
      );
    }
    const existing = distinct.get(candidate.personId);
    if (
      existing &&
      (existing.resourceType !== candidate.resourceType ||
        existing.resourceId !== candidate.resourceId)
    ) {
      throw new TypeError(
        "One event recipient cannot map to multiple notification resources",
      );
    }
    if (!existing) distinct.set(candidate.personId, candidate);
  }

  for (const candidate of distinct.values()) {
    const person = await tx.execute(sql`
      SELECT user_id AS "userId", active
        FROM person
       WHERE id = ${candidate.personId}
       FOR SHARE
    `);
    const recipient = person.rows[0] as
      | { userId: string | null; active: boolean }
      | undefined;
    // Person rows without a login are valid authorship/provenance records but have no
    // inbox principal. The current notification API is user-session-backed, so fail
    // closed for this batch rather than invent a recipient account or drop its person id.
    if (!recipient?.active || !recipient.userId) continue;

    await tx.execute(sql`
      INSERT INTO notification
        (id, user_id, person_id, event_id, kind, title, body, content,
         resource_type, resource_id, is_read, read_at, type)
      VALUES
        (${createId()}, ${recipient.userId}, ${candidate.personId}, ${event.id}, ${event.kind},
         ${candidate.title}, ${candidate.body}, ${candidate.body}, ${candidate.resourceType},
         ${candidate.resourceId}, false, NULL, 'info')
      ON CONFLICT (event_id, person_id) WHERE event_id IS NOT NULL DO NOTHING
    `);

    if (!event.scope.workspaceId) continue;
    for (const channel of new Set(candidate.channels)) {
      if (!channel.startsWith("notify.")) continue;
      const preference = await resolveNotificationPreference(tx, {
        personId: candidate.personId,
        workspaceId: event.scope.workspaceId,
        projectId:
          "projectId" in event.scope ? (event.scope.projectId ?? null) : null,
        eventKind: event.kind,
        channel,
      });
      if (!preference.enabled) continue;
      let digestId: string | null = null;
      const cadence = URGENT_EVENT_KINDS.has(event.kind)
        ? "off"
        : preference.digest;
      if (cadence !== "off") {
        if (!hooks.attachDigest) {
          throw new Error(
            "Digest candidate cannot be materialized without the canonical digest-window writer",
          );
        }
        digestId = (
          await hooks.attachDigest({
            tx,
            event,
            recipientPersonId: candidate.personId,
            channel,
            cadence,
          })
        ).id;
      }
      const dedupeKey = notificationDedupeKey({
        eventKind: event.kind,
        resourceType: candidate.resourceType,
        resourceId: candidate.resourceId,
        personId: candidate.personId,
        channel,
      });
      // Explicit UTC wall-clock timestamps: the column defaults are now(), which a database
      // session ahead of or behind UTC stores as its local wall clock, while the outbox
      // convention (utils/db-time.ts) is the UTC wall clock.
      await tx.execute(sql`
        INSERT INTO notification_delivery
          (id, event_id, recipient_person_id, channel, workspace_id, organisation_id,
           dedupe_key, digest_id, state, attempts, next_attempt_at, created_at, updated_at)
        VALUES
          (${createId()}, ${event.id}, ${candidate.personId}, ${channel},
           ${event.scope.workspaceId}, ${"organisationId" in event.scope ? (event.scope.organisationId ?? null) : null},
           ${dedupeKey}, ${digestId}, 'pending', 0,
           ${dbNowUtc()}, ${dbNowUtc()}, ${dbNowUtc()})
        ON CONFLICT (event_id, recipient_person_id, channel) DO NOTHING
      `);
    }
  }
}
