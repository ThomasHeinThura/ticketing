import { sql } from "drizzle-orm";
import db from "../../database";
import { notificationReservationKey } from "../../notification/delivery-primitives";
import { apiRouter, createRoute, jsonResponse, z } from "../../openapi";
import { setShadowLegacyAuthorization } from "../../permissions/shadow-context";
import { requireCurrentInstanceAdmin } from "../require-instance-admin";
import {
  projectDeliveryCounts,
  projectDeliveryItems,
  type RawDeliveryItem,
} from "./response";

const errorSchema = z.object({ message: z.string() });
const itemSchema = z.object({
  id: z.string(),
  kind: z.enum(["event", "notification", "digest", "webhook"]),
  state: z.string(),
  createdAt: z.string().datetime(),
  requeueAllowed: z.boolean(),
  eventId: z.string().optional(),
  eventKind: z.string().optional(),
  channel: z.string().optional(),
  attempts: z.number().int().nonnegative().optional(),
  nextAttemptAt: z.string().datetime().nullable().optional(),
  deliveredAt: z.string().datetime().nullable().optional(),
  errorPresent: z.boolean().optional(),
  cadence: z.string().optional(),
  children: z.number().int().nonnegative().optional(),
  source: z.string().optional(),
  statusCode: z.number().int().nullable().optional(),
  durationMs: z.number().int().nullable().optional(),
  attemptedAt: z.string().datetime().nullable().optional(),
});
const countSchema = z.object({
  pending: z.number().int().nonnegative(),
  dead: z.number().int().nonnegative(),
});
const getResponseSchema = z.object({
  checkedAt: z.string().datetime(),
  counts: z.object({
    events: countSchema,
    notifications: z.object({
      pending: z.number().int().nonnegative(),
      delivered: z.number().int().nonnegative(),
      suppressed: z.number().int().nonnegative(),
      dead: z.number().int().nonnegative(),
    }),
    digests: z.object({
      collecting: z.number().int().nonnegative(),
      pending: z.number().int().nonnegative(),
      delivered: z.number().int().nonnegative(),
      suppressed: z.number().int().nonnegative(),
      dead: z.number().int().nonnegative(),
    }),
    webhooks: z.object({
      pending: z.number().int().nonnegative(),
      delivered: z.number().int().nonnegative(),
      dead: z.number().int().nonnegative(),
      skippedOutOfReach: z.number().int().nonnegative(),
      cancelled: z.number().int().nonnegative(),
    }),
  }),
  items: z.array(itemSchema),
});

const getRoute = createRoute({
  method: "get",
  operationId: "listInstanceDeliveries",
  path: "/deliveries",
  tags: ["Instance"],
  summary: "Inspect instance delivery queues",
  description:
    "Lists bounded, metadata-only views of event envelopes, notification deliveries and digests, and webhook attempts. Payloads, recipients, endpoint details, and provider error bodies are omitted.",
  responses: {
    200: jsonResponse("Delivery queue summary", getResponseSchema),
    403: jsonResponse("Forbidden", errorSchema),
  },
});

const routes = apiRouter().openapi(getRoute, async (c) => {
  await requireCurrentInstanceAdmin(c, "GET", "/api/instance/deliveries");
  setShadowLegacyAuthorization(c, "allowed");
  c.header("Cache-Control", "no-store");

  const [events, notifications, digests, webhooks, counts] = await Promise.all([
    db.execute(sql`
      SELECT event_id AS id, 'event'::text AS kind, state, created_at AS "createdAt",
             kind AS "eventKind", attempts, (last_error IS NOT NULL) AS "hasError",
             (state = 'dead' AND NOT EXISTS (
               SELECT 1 FROM notification_delivery child WHERE child.id = outbox.event_id
             )) AS "requeueAllowed"
        FROM outbox
       ORDER BY created_at DESC, event_id DESC
       LIMIT 50
    `),
    db.execute(sql`
      SELECT d.id, 'notification'::text AS kind, d.state,
             d.created_at AT TIME ZONE 'UTC' AS "createdAt",
             d.event_id AS "eventId", o.kind AS "eventKind", d.channel, d.attempts,
             d.digest_id AS "digestId",
             d.recipient_person_id AS "recipientPersonId",
             d.dedupe_key AS "dedupeKey",
             NOT EXISTS (SELECT 1 FROM outbox parent WHERE parent.event_id = d.id) AS "idUnambiguous",
             d.next_attempt_at AT TIME ZONE 'UTC' AS "nextAttemptAt",
             d.delivered_at AT TIME ZONE 'UTC' AS "deliveredAt",
             (d.last_error IS NOT NULL) AS "hasError"
        FROM notification_delivery d
        JOIN outbox o ON o.event_id = d.event_id
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT 50
    `),
    db.execute(sql`
      SELECT d.id, 'digest'::text AS kind, d.state,
             d.created_at AT TIME ZONE 'UTC' AS "createdAt",
             d.channel, d.cadence, d.attempts,
             d.next_attempt_at AT TIME ZONE 'UTC' AS "nextAttemptAt",
             d.delivered_at AT TIME ZONE 'UTC' AS "deliveredAt",
             (d.last_error IS NOT NULL) AS "hasError",
             (SELECT count(*)::int FROM notification_delivery child WHERE child.digest_id = d.id) AS children
        FROM notification_digest d
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT 50
    `),
    db.execute(sql`
      SELECT id, 'webhook'::text AS kind, state, created_at AS "createdAt",
             event_id AS "eventId", event_kind AS "eventKind", source, attempt AS attempts,
             next_attempt_at AS "nextAttemptAt", status_code AS "statusCode",
             duration_ms AS "durationMs", attempted_at AS "attemptedAt",
             (error IS NOT NULL) AS "hasError"
        FROM webhook_delivery
       ORDER BY created_at DESC, id DESC
       LIMIT 50
    `),
    db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM outbox WHERE state = 'pending') AS "eventsPending",
        (SELECT count(*)::int FROM outbox WHERE state = 'dead') AS "eventsDead",
        (SELECT count(*)::int FROM notification_delivery WHERE state = 'pending') AS "notificationsPending",
        (SELECT count(*)::int FROM notification_delivery WHERE state = 'delivered') AS "notificationsDelivered",
        (SELECT count(*)::int FROM notification_delivery WHERE state = 'suppressed') AS "notificationsSuppressed",
        (SELECT count(*)::int FROM notification_delivery WHERE state = 'dead') AS "notificationsDead",
        (SELECT count(*)::int FROM notification_digest WHERE state = 'collecting') AS "digestsCollecting",
        (SELECT count(*)::int FROM notification_digest WHERE state = 'pending') AS "digestsPending",
        (SELECT count(*)::int FROM notification_digest WHERE state = 'delivered') AS "digestsDelivered",
        (SELECT count(*)::int FROM notification_digest WHERE state = 'suppressed') AS "digestsSuppressed",
        (SELECT count(*)::int FROM notification_digest WHERE state = 'dead') AS "digestsDead",
        (SELECT count(*)::int FROM webhook_delivery WHERE state = 'pending') AS "webhooksPending",
        (SELECT count(*)::int FROM webhook_delivery WHERE state = 'delivered') AS "webhooksDelivered",
        (SELECT count(*)::int FROM webhook_delivery WHERE state = 'dead') AS "webhooksDead",
        (SELECT count(*)::int FROM webhook_delivery WHERE state = 'skipped_out_of_reach') AS "webhooksSkippedOutOfReach",
        (SELECT count(*)::int FROM webhook_delivery WHERE state = 'cancelled') AS "webhooksCancelled"
    `),
  ]);

  type NotificationProjectionRow = RawDeliveryItem & {
    digestId: string | null;
    recipientPersonId: string;
    channel: string;
    dedupeKey: string;
    idUnambiguous: boolean;
  };
  const notificationRows =
    notifications.rows as unknown as NotificationProjectionRow[];
  const reservationKeys = notificationRows
    .filter(
      (row) =>
        row.state === "dead" &&
        row.deliveredAt == null &&
        row.digestId === null &&
        row.idUnambiguous,
    )
    .map((row) =>
      notificationReservationKey({
        recipientPersonId: row.recipientPersonId,
        channel: row.channel,
        dedupeKey: row.dedupeKey,
      }),
    );
  const liveReservationKeys = new Set<string>();
  if (reservationKeys.length > 0) {
    const reservationStatus = await db.execute(sql`
      WITH sampled AS MATERIALIZED (
        SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "sampledAt"
      )
      SELECT encode(reservation.reservation_key, 'hex') AS "reservationKey"
        FROM outbox_dedupe_reservation reservation
        CROSS JOIN sampled
       WHERE reservation.reservation_key IN (${sql.join(
         reservationKeys.map((key) => sql`${key}`),
         sql`, `,
       )})
         AND reservation.lease_expires_at > sampled."sampledAt"
    `);
    for (const row of reservationStatus.rows as Array<{
      reservationKey: string;
    }>) {
      liveReservationKeys.add(row.reservationKey);
    }
  }
  const projectedNotifications = notificationRows.map((row) => {
    const reservationKey = notificationReservationKey({
      recipientPersonId: row.recipientPersonId,
      channel: row.channel,
      dedupeKey: row.dedupeKey,
    }).toString("hex");
    return {
      ...row,
      requeueAllowed:
        row.state === "dead" &&
        row.deliveredAt == null &&
        row.digestId === null &&
        row.idUnambiguous &&
        !liveReservationKeys.has(reservationKey),
    };
  });
  const rawItems = [
    ...events.rows,
    ...projectedNotifications,
    ...digests.rows,
    ...webhooks.rows,
  ] as unknown as RawDeliveryItem[];
  const summary = counts.rows[0] as Record<string, unknown> | undefined;
  const items = projectDeliveryItems(rawItems).sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
  return c.json(
    {
      checkedAt: new Date().toISOString(),
      counts: projectDeliveryCounts(summary ?? {}),
      items,
    },
    200,
  );
});

export default routes;
