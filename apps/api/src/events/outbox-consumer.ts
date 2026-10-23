import type { Transaction } from "../database/executor";
import {
  NOTIFICATION_ATTEMPT_LIMIT,
  notificationRetryDelayMs,
} from "../notification/delivery-primitives";
import type { DomainEventEnvelope } from "./outbox";
import {
  claimNextPendingParentEvent,
  markParentEventDelivered,
  markParentEventFailed,
} from "./outbox-consumer.repository";

/**
 * Parent event-envelope consumer for `outbox-drain` (`background-jobs.md`, `EV-1`, `EV-2`).
 *
 * Every domain event is written to `outbox` in the producing transaction (`enqueueOutboxEvent`).
 * Notification fan-out (inbox rows and `notification_delivery` children) is already
 * materialised in that same transaction, so this consumer never re-materialises it — doing so
 * would collide with the `(event_id, person_id)` / `(event_id, recipient_person_id, channel)`
 * unique keys on every replay. What this consumer owns is the **parent** state machine:
 * `pending → delivered` once every registered consumer has handled the envelope, or
 * `pending → (retry with backoff) → dead` when one keeps failing. Parent completion is
 * deliberately distinct from any notification provider success (`EV-2`).
 *
 * Replay safety: the claim takes the row with `FOR UPDATE SKIP LOCKED`, and the handlers run
 * inside a savepoint of that same transaction. A handler's database writes commit only together
 * with the `delivered` transition; a crash or failure rolls them back with the claim, so a
 * re-drain replays from a clean slate. A row already `delivered`/`dead` is never claimed again.
 * Handlers must still key every side effect on `envelope.id` (the event id) — that is the
 * `EV-2` idempotency key — and a handler with an external side effect (a webhook POST) must
 * record its own per-attempt child row instead of performing I/O while this lock is held.
 *
 * Registered consumers today: none. The webhook and automation runtimes do not exist in this
 * codebase yet, so a claimed envelope is marked `delivered` after validation. The seam below is
 * where they register.
 *
 * Decision (review F26, recorded in `events.md` `EV-2`): with no consumer registered, every
 * claimed parent, including historical pending rows, is marked `delivered` on purpose. Those
 * interim events are NOT replayed to consumers registered later (P4 webhooks/automations);
 * a consumer starts from its registration point and backfills from source tables if needed.
 */

export type ParentEventEnvelope = DomainEventEnvelope<Record<string, unknown>>;

export type ParentEventConsumer = {
  /** Stable identifier, used only in logs. */
  name: string;
  handles(kind: string): boolean;
  handle(tx: Transaction, envelope: ParentEventEnvelope): Promise<void>;
};

const registeredConsumers: ParentEventConsumer[] = [];

/** Registers a parent consumer (webhooks, automations). Names must be unique. */
export function registerParentEventConsumer(
  consumer: ParentEventConsumer,
): void {
  if (registeredConsumers.some((entry) => entry.name === consumer.name)) {
    throw new TypeError(
      `Parent event consumer already registered: ${consumer.name}`,
    );
  }
  registeredConsumers.push(consumer);
}

export function registeredParentEventConsumers(): readonly ParentEventConsumer[] {
  return registeredConsumers;
}

/** For tests only. */
export function resetParentEventConsumersForTests(): void {
  registeredConsumers.length = 0;
}

export function consumersForKind(
  kind: string,
  consumers: readonly ParentEventConsumer[],
): ParentEventConsumer[] {
  return consumers.filter((consumer) => consumer.handles(kind));
}

/** The parent attempt cap and schedule reuse the notification child schedule (6 attempts). */
export const PARENT_EVENT_ATTEMPT_LIMIT = NOTIFICATION_ATTEMPT_LIMIT;

export type ParentFailureOutcome =
  | { state: "pending"; attempts: number; retryDelayMs: number }
  | { state: "dead"; attempts: number };

/**
 * Pure transition for a failed parent attempt. `attemptsBefore` is the stored count; the
 * returned `attempts` is what to persist. The sixth failed attempt dead-letters the parent.
 */
export function parentFailureOutcome(
  attemptsBefore: number,
): ParentFailureOutcome {
  if (!Number.isInteger(attemptsBefore) || attemptsBefore < 0) {
    throw new RangeError("Parent attempts must be a non-negative integer");
  }
  const attempts = Math.min(attemptsBefore + 1, PARENT_EVENT_ATTEMPT_LIMIT);
  const delay = notificationRetryDelayMs(attempts);
  if (delay === null || attemptsBefore + 1 >= PARENT_EVENT_ATTEMPT_LIMIT) {
    return { state: "dead", attempts };
  }
  return { state: "pending", attempts, retryDelayMs: delay };
}

/**
 * Validates that the stored payload is the complete envelope for this row. A mismatch is a
 * corrupt parent: it fails (and eventually dead-letters) rather than being delivered.
 */
export function parseParentEnvelope(row: {
  eventId: string;
  kind: string;
  payload: unknown;
}): ParentEventEnvelope {
  const payload = row.payload as Partial<ParentEventEnvelope> | null;
  if (
    !payload ||
    typeof payload !== "object" ||
    payload.id !== row.eventId ||
    payload.kind !== row.kind ||
    typeof payload.occurredAt !== "string" ||
    typeof payload.depth !== "number" ||
    !payload.actor ||
    !payload.scope ||
    typeof payload.payload !== "object"
  ) {
    throw new ParentEnvelopeInvalid();
  }
  return payload as ParentEventEnvelope;
}

export class ParentEnvelopeInvalid extends Error {
  constructor() {
    super("Parent outbox envelope does not match its row");
    this.name = "ParentEnvelopeInvalid";
  }
}

/** Safe, bounded error label for `outbox.last_error`; never the raw message (may hold data). */
export function parentErrorLabel(error: unknown, consumer?: string): string {
  const name =
    error instanceof Error && /^[A-Za-z0-9_]{1,64}$/.test(error.name)
      ? error.name
      : "Error";
  return consumer ? `${consumer}:${name}`.slice(0, 200) : name;
}

export type ParentDrainResult =
  | { kind: "idle" }
  | { kind: "delivered"; eventId: string }
  | { kind: "retry"; eventId: string }
  | { kind: "dead"; eventId: string };

/** Claims and processes at most one due parent envelope. Safe on every replica concurrently. */
export async function processNextParentEvent(
  consumers: readonly ParentEventConsumer[] = registeredConsumers,
): Promise<ParentDrainResult> {
  return claimNextPendingParentEvent(async (tx, row) => {
    let failedConsumer: string | undefined;
    try {
      const envelope = parseParentEnvelope(row);
      await tx.transaction(async (savepoint) => {
        for (const consumer of consumersForKind(envelope.kind, consumers)) {
          failedConsumer = consumer.name;
          await consumer.handle(savepoint, envelope);
        }
        failedConsumer = undefined;
      });
    } catch (error) {
      const outcome = parentFailureOutcome(row.attempts);
      await markParentEventFailed(
        tx,
        row.eventId,
        outcome,
        parentErrorLabel(error, failedConsumer),
      );
      return {
        kind: outcome.state === "dead" ? "dead" : "retry",
        eventId: row.eventId,
      };
    }
    await markParentEventDelivered(tx, row.eventId, row.attempts);
    return { kind: "delivered", eventId: row.eventId };
  });
}
