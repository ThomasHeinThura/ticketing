import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { portalForHost } from "../../auth";
import db from "../../database";
import { notificationReservationKey } from "../../notification/delivery-primitives";
import { apiRouter, createRoute, jsonResponse, z } from "../../openapi";
import { setShadowLegacyAuthorization } from "../../permissions/shadow-context";
import { normaliseTraceId } from "../../permissions/shadow-middleware";
import { requireSessionOnly } from "../../utils/require-session-only";
import { requireCurrentInstanceAdmin } from "../require-instance-admin";

const errorSchema = z.object({
  message: z.enum([
    "Forbidden",
    "delivery_not_found",
    "delivery_id_ambiguous",
    "delivery_not_requeueable",
    "delivery_reservation_active",
  ]),
});

const route = createRoute({
  method: "post",
  operationId: "requeueInstanceDelivery",
  path: "/deliveries/{id}/requeue",
  tags: ["Instance"],
  summary: "Requeue a dead event or notification delivery",
  description:
    "Requeues a dead parent event for idempotent consumer replay or a dead standalone notification child using its existing id. Digest and webhook attempts are handled by their existing flows.",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: z.object({ id: z.string().min(1).max(200) }),
    body: {
      required: true,
      content: { "application/json": { schema: z.object({}).strict() } },
    },
  },
  responses: {
    200: jsonResponse(
      "Delivery queued for retry",
      z.object({
        id: z.string(),
        kind: z.enum(["event", "notification"]),
        state: z.literal("pending"),
      }),
    ),
    403: jsonResponse("Forbidden", errorSchema),
    404: jsonResponse("Delivery not found", errorSchema),
    409: jsonResponse("Delivery cannot be requeued", errorSchema),
  },
});

type RequeueKind = "event" | "notification";
type RequeueResult =
  | { kind: "requeued"; id: string; deliveryKind: RequeueKind }
  | { kind: "not_found" }
  | { kind: "ambiguous" }
  | { kind: "not_requeueable" }
  | { kind: "reservation_active" };

function rows<T>(result: { rows: unknown[] }): T[] {
  return result.rows as T[];
}

async function requeueDelivery(input: {
  id: string;
  actorUserId: string;
  traceId: string | null;
}): Promise<RequeueResult> {
  return db.transaction(async (tx) => {
    const match = await tx.execute(sql`
      SELECT
        EXISTS (SELECT 1 FROM outbox WHERE event_id = ${input.id}) AS "isEvent",
        EXISTS (SELECT 1 FROM notification_delivery WHERE id = ${input.id}) AS "isNotification"
    `);
    const found = rows<{ isEvent: boolean; isNotification: boolean }>(match)[0];
    const isEvent = found?.isEvent === true;
    const isNotification = found?.isNotification === true;
    if (!isEvent && !isNotification) return { kind: "not_found" };
    if (isEvent && isNotification) return { kind: "ambiguous" };

    if (isEvent) {
      const locked = await tx.execute(sql`
        SELECT state, attempts FROM outbox WHERE event_id = ${input.id} FOR UPDATE
      `);
      const before = rows<{ state: string; attempts: number }>(locked)[0];
      if (!before) return { kind: "not_found" };
      if (before.state !== "dead") return { kind: "not_requeueable" };

      const updated = await tx.execute(sql`
        UPDATE outbox
           SET state = 'pending', attempts = 0, next_attempt_at = clock_timestamp(),
               last_error = NULL, updated_at = clock_timestamp()
         WHERE event_id = ${input.id} AND state = 'dead' AND attempts = ${before.attempts}
         RETURNING event_id
      `);
      if (rows<{ eventId: string }>(updated).length !== 1)
        return { kind: "not_requeueable" };

      const { appendAuditLog } = await import("../../audit/audit-writer");
      await appendAuditLog(tx, {
        action: "instance.delivery.requeued",
        actorId: input.actorUserId,
        actorType: "person",
        traceId: input.traceId,
        entityType: "delivery",
        entityId: input.id,
        before: { kind: "event", state: "dead", attempts: before.attempts },
        after: { kind: "event", state: "pending", attempts: 0 },
      });
      return { kind: "requeued", id: input.id, deliveryKind: "event" };
    }

    const locked = await tx.execute(sql`
      SELECT id, state, attempts, digest_id AS "digestId",
             (delivered_at IS NOT NULL) AS "wasDelivered",
             recipient_person_id AS "recipientPersonId", channel,
             dedupe_key AS "dedupeKey"
        FROM notification_delivery
       WHERE id = ${input.id}
       FOR UPDATE
    `);
    const before = rows<{
      id: string;
      state: string;
      attempts: number;
      digestId: string | null;
      wasDelivered: boolean;
      recipientPersonId: string;
      channel: string;
      dedupeKey: string;
    }>(locked)[0];
    if (!before) return { kind: "not_found" };
    if (
      before.state !== "dead" ||
      before.digestId !== null ||
      before.wasDelivered
    )
      return { kind: "not_requeueable" };

    const reservationKey = notificationReservationKey({
      recipientPersonId: before.recipientPersonId,
      channel: before.channel,
      dedupeKey: before.dedupeKey,
    });
    const lockedReservation = await tx.execute(sql`
      SELECT recipient_person_id AS "recipientPersonId", channel,
             dedupe_key AS "dedupeKey"
        FROM outbox_dedupe_reservation
       WHERE reservation_key = ${reservationKey}
       FOR UPDATE
    `);
    const reservation = rows<{
      recipientPersonId: string;
      channel: string;
      dedupeKey: string;
    }>(lockedReservation)[0];
    if (
      reservation &&
      (reservation.recipientPersonId !== before.recipientPersonId ||
        reservation.channel !== before.channel ||
        reservation.dedupeKey !== before.dedupeKey)
    )
      return { kind: "not_requeueable" };
    const sampled = await tx.execute(sql`
      WITH sampled AS MATERIALIZED (
        SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "sampledAt"
      )
      SELECT to_char(sampled."sampledAt", 'YYYY-MM-DD HH24:MI:SS.US') AS "sampledAt",
             EXISTS (
               SELECT 1 FROM outbox_dedupe_reservation reservation
                WHERE reservation.reservation_key = ${reservationKey}
                  AND reservation.lease_expires_at > sampled."sampledAt"
             ) AS "hasLiveReservation"
        FROM sampled
    `);
    const sample = rows<{
      sampledAt: string;
      hasLiveReservation: boolean;
    }>(sampled)[0];
    if (!sample?.sampledAt)
      throw new Error("Database wall-clock sample was unavailable");
    if (sample.hasLiveReservation) return { kind: "reservation_active" };

    const updated = await tx.execute(sql`
      UPDATE notification_delivery
         SET state = 'pending', attempts = 0,
             next_attempt_at = ${sample.sampledAt}::timestamp,
             delivered_at = NULL, last_error = NULL,
             updated_at = ${sample.sampledAt}::timestamp
       WHERE id = ${input.id}
         AND state = 'dead'
         AND digest_id IS NULL
         AND attempts = ${before.attempts}
       RETURNING id
    `);
    if (rows<{ id: string }>(updated).length !== 1)
      return { kind: "not_requeueable" };

    const { appendAuditLog } = await import("../../audit/audit-writer");
    await appendAuditLog(tx, {
      action: "instance.delivery.requeued",
      actorId: input.actorUserId,
      actorType: "person",
      traceId: input.traceId,
      entityType: "delivery",
      entityId: input.id,
      before: {
        kind: "notification",
        state: "dead",
        attempts: before.attempts,
      },
      after: { kind: "notification", state: "pending", attempts: 0 },
    });
    return { kind: "requeued", id: input.id, deliveryKind: "notification" };
  });
}

const routes = apiRouter().openapi(route, async (c) => {
  if (portalForHost(c.req.header("host")) !== "agent")
    throw new HTTPException(403, { message: "Forbidden" });
  await requireCurrentInstanceAdmin(
    c,
    "POST",
    "/api/instance/deliveries/{id}/requeue",
  );
  const actorUserId = c.get("userId") as string | undefined;
  if (!actorUserId) throw new HTTPException(401, { message: "Unauthorized" });

  const result = await requeueDelivery({
    id: c.req.valid("param").id,
    actorUserId,
    traceId: normaliseTraceId(c.req.header("x-request-id")),
  });
  if (result.kind === "not_found")
    throw new HTTPException(404, { message: "delivery_not_found" });
  if (result.kind === "ambiguous")
    throw new HTTPException(409, { message: "delivery_id_ambiguous" });
  if (result.kind === "not_requeueable")
    throw new HTTPException(409, { message: "delivery_not_requeueable" });
  if (result.kind === "reservation_active")
    throw new HTTPException(409, { message: "delivery_reservation_active" });

  setShadowLegacyAuthorization(c, "allowed");
  c.header("Cache-Control", "no-store");
  return c.json(
    { id: result.id, kind: result.deliveryKind, state: "pending" as const },
    200,
  );
});

export default routes;
