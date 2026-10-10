import db from "../database";
import {
  acquireNotificationReservation,
  authorizeNotificationProviderAttempt,
  type ClaimedNotificationDelivery,
  claimNextNotificationDelivery,
  completeNotificationDelivery,
  deferNotificationDelivery,
  hasRecentNotificationSuccess,
  type ReservationToken,
  releaseNotificationReservation,
  renewNotificationReservation,
  updateUnreservedNotificationDelivery,
} from "../database/repositories/notification-delivery.repository";
import type { DbTransaction } from "../events/outbox";
import { evaluateCurrentNotificationReachAndPreference } from "./current-eligibility";
import {
  callNotificationProvider,
  NotificationProviderDeadlineExceeded,
} from "./delivery-primitives";

export type NotificationProjection = {
  title: string;
  body: string;
  url: string;
};

export type NotificationEligibility =
  | { kind: "eligible"; projection: NotificationProjection }
  | { kind: "defer"; until: Date; reason: string }
  | { kind: "suppress"; reason: string }
  | {
      kind: "unresolved";
      reason: "quiet_hours_unresolved" | "destination_unresolved";
    };

/**
 * Runtime seams are supplied by the owning notification/plugin integration. The
 * evaluator must re-read reach, preference and quiet-hours state using the given
 * transaction and return only a recipient-safe projection. No adapter is assumed.
 */
export type NotificationOutboxRuntime = {
  evaluateCurrentEligibility(
    tx: DbTransaction,
    delivery: ClaimedNotificationDelivery,
  ): Promise<NotificationEligibility>;
  send(
    channel: string,
    projection: NotificationProjection,
    options: { signal: AbortSignal; idempotencyKey: string },
  ): Promise<void>;
};

export type NotificationDrainResult =
  | { kind: "idle" }
  | { kind: "deferred"; reason: string }
  | { kind: "suppressed"; reason: string }
  | {
      kind: "unresolved";
      reason: "quiet_hours_unresolved" | "destination_unresolved";
    }
  | { kind: "delivered" }
  | { kind: "retry"; ambiguous: boolean };

export function currentEligibilityRuntime(
  send: NotificationOutboxRuntime["send"],
): NotificationOutboxRuntime {
  return {
    evaluateCurrentEligibility: async (tx, delivery) => {
      const current = await evaluateCurrentNotificationReachAndPreference(
        tx,
        delivery,
      );
      if (
        current.kind === "quiet_hours_unresolved" ||
        current.kind === "destination_unresolved"
      )
        return { kind: "unresolved", reason: current.kind };
      return current;
    },
    send,
  };
}

async function releaseAsSuppressed(
  delivery: ClaimedNotificationDelivery,
  reservation: ReservationToken,
  reason: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await completeNotificationDelivery(tx, delivery.id, reservation, {
      kind: "suppressed",
    });
    // `completeNotificationDelivery` clears last_error by contract; reason is
    // returned to worker observability, not persisted in a customer-facing row.
    void reason;
  });
}

async function leaveUnresolved(
  delivery: ClaimedNotificationDelivery,
  reason: "quiet_hours_unresolved" | "destination_unresolved",
  reservation?: ReservationToken,
): Promise<NotificationDrainResult> {
  if (reservation)
    await db.transaction((tx) =>
      releaseNotificationReservation(tx, delivery.id, reservation),
    );
  return { kind: "unresolved", reason };
}

async function renewUntilStopped(
  reservation: ReservationToken,
  controller: AbortController,
): Promise<void> {
  while (!controller.signal.aborted) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, 15_000);
      function done() {
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", done);
        resolve();
      }
      controller.signal.addEventListener("abort", done, { once: true });
    });
    if (controller.signal.aborted) return;
    const renewed = await db.transaction((tx) =>
      renewNotificationReservation(tx, reservation),
    );
    if (!renewed) {
      controller.abort(new Error("Notification reservation fence lost"));
      return;
    }
    reservation.leaseExpiresAt = renewed.leaseExpiresAt;
  }
}

/** Processes at most one immediate child; the scheduled outbox-drain calls repeatedly. */
export async function processNextNotificationDelivery(
  runtime: NotificationOutboxRuntime,
): Promise<NotificationDrainResult> {
  const delivery = await db.transaction((tx) =>
    claimNextNotificationDelivery(tx),
  );
  if (!delivery) return { kind: "idle" };

  const eligibility = await db.transaction((tx) =>
    runtime.evaluateCurrentEligibility(tx, delivery),
  );
  if (eligibility.kind === "unresolved")
    return leaveUnresolved(delivery, eligibility.reason);
  if (eligibility.kind === "defer") {
    const changed = await db.transaction((tx) =>
      updateUnreservedNotificationDelivery(tx, delivery.id, {
        kind: "deferred",
        until: eligibility.until,
        reason: eligibility.reason,
      }),
    );
    return {
      kind: "deferred",
      reason: changed ? eligibility.reason : "delivery_fence",
    };
  }
  if (eligibility.kind === "suppress") {
    const changed = await db.transaction((tx) =>
      updateUnreservedNotificationDelivery(tx, delivery.id, {
        kind: "suppressed",
        reason: eligibility.reason,
      }),
    );
    return changed
      ? { kind: "suppressed", reason: eligibility.reason }
      : { kind: "deferred", reason: "delivery_fence" };
  }

  const claim = await db.transaction((tx) =>
    acquireNotificationReservation(tx, {
      recipientPersonId: delivery.recipientPersonId,
      channel: delivery.channel,
      dedupeKey: delivery.dedupeKey,
      ownerDeliveryId: delivery.id,
    }),
  );
  if (claim.status === "not_pending")
    return { kind: "deferred", reason: "delivery_fence" };
  if (claim.status === "digest_collision") {
    const changed = await db.transaction((tx) =>
      updateUnreservedNotificationDelivery(tx, delivery.id, {
        kind: "suppressed",
        reason: "reservation_digest_collision",
      }),
    );
    return changed
      ? { kind: "suppressed", reason: claim.status }
      : { kind: "deferred", reason: "delivery_fence" };
  }
  if (claim.status === "deferred") {
    await db.transaction((tx) =>
      updateUnreservedNotificationDelivery(tx, delivery.id, {
        kind: "deferred",
        until: claim.leaseExpiresAt,
        reason: "reservation_contention",
      }),
    );
    return { kind: "deferred", reason: claim.status };
  }
  const reservation = claim.reservation;

  if (
    await hasRecentNotificationSuccess(db, {
      recipientPersonId: delivery.recipientPersonId,
      channel: delivery.channel,
      dedupeKey: delivery.dedupeKey,
      excludeDeliveryId: delivery.id,
    })
  ) {
    await releaseAsSuppressed(delivery, reservation, "recent_duplicate");
    return { kind: "suppressed", reason: "recent_duplicate" };
  }

  const preflight = await db.transaction(async (tx) => {
    const current = await runtime.evaluateCurrentEligibility(tx, delivery);
    if (current.kind === "defer")
      return { kind: "defer" as const, eligibility: current };
    if (current.kind === "suppress")
      return { kind: "suppress" as const, eligibility: current };
    if (current.kind === "unresolved")
      return { kind: "unresolved" as const, eligibility: current };
    const attempt = await authorizeNotificationProviderAttempt(
      tx,
      delivery.id,
      reservation,
    );
    return { kind: "authorized" as const, eligibility: current, attempt };
  });
  if (preflight.kind === "defer") {
    await db.transaction((tx) =>
      deferNotificationDelivery(
        tx,
        delivery.id,
        preflight.eligibility.until,
        preflight.eligibility.reason,
        reservation,
      ),
    );
    return { kind: "deferred", reason: preflight.eligibility.reason };
  }
  if (preflight.kind === "unresolved")
    return leaveUnresolved(delivery, preflight.eligibility.reason, reservation);
  if (preflight.kind === "suppress") {
    await releaseAsSuppressed(
      delivery,
      reservation,
      preflight.eligibility.reason,
    );
    return { kind: "suppressed", reason: preflight.eligibility.reason };
  }
  if (preflight.attempt === null)
    return { kind: "deferred", reason: "authorization_fence" };

  const controller = new AbortController();
  const renewal = renewUntilStopped(reservation, controller);
  let outcome: "delivered" | "failed" | "ambiguous";
  try {
    await callNotificationProvider(
      (signal) =>
        runtime.send(delivery.channel, preflight.eligibility.projection, {
          signal,
          idempotencyKey: delivery.id,
        }),
      { signal: controller.signal, deadlineMs: 30_000 },
    );
    outcome = "delivered";
  } catch (error) {
    outcome =
      error instanceof NotificationProviderDeadlineExceeded ||
      controller.signal.aborted
        ? "ambiguous"
        : "failed";
  } finally {
    controller.abort();
  }
  await renewal;

  if (outcome === "ambiguous") {
    await db.transaction((tx) =>
      completeNotificationDelivery(tx, delivery.id, reservation, {
        kind: "ambiguous",
      }),
    );
    return { kind: "retry", ambiguous: true };
  }
  if (outcome === "delivered") {
    const completed = await db.transaction((tx) =>
      completeNotificationDelivery(tx, delivery.id, reservation, {
        kind: "delivered",
      }),
    );
    return completed
      ? { kind: "delivered" }
      : { kind: "retry", ambiguous: true };
  }
  await db.transaction((tx) =>
    completeNotificationDelivery(tx, delivery.id, reservation, {
      kind: "failed",
      errorCode: "provider_failed",
    }),
  );
  return { kind: "retry", ambiguous: false };
}
