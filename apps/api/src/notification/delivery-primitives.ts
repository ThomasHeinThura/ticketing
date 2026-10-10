import { createHash } from "node:crypto";

const MAX_U32 = 0xffff_ffff;

function encodeLengthPrefixed(values: readonly string[]): Buffer {
  const chunks: Buffer[] = [];
  for (const value of values) {
    const bytes = Buffer.from(value, "utf8");
    if (bytes.length > MAX_U32) {
      throw new RangeError("Notification key component is too large");
    }
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    chunks.push(length, bytes);
  }
  return Buffer.concat(chunks);
}

function digest(domain: string, values: readonly string[]): string {
  return createHash("sha256")
    .update(domain, "utf8")
    .update(Buffer.from([0]))
    .update(encodeLengthPrefixed(values))
    .digest("hex");
}

/** NO-11: stable per event, resource, recipient and channel. */
export function notificationDedupeKey(input: {
  eventKind: string;
  resourceType: string;
  resourceId: string;
  personId: string;
  channel: string;
}): string {
  return `notification:v1:${digest("taskdesk:notification-dedupe:v1", [
    input.eventKind,
    input.resourceType,
    input.resourceId,
    input.personId,
    input.channel,
  ])}`;
}

/** NO-11: serializes live delivery reservations across worker replicas. */
export function notificationReservationKey(input: {
  recipientPersonId: string;
  channel: string;
  dedupeKey: string;
}): Buffer {
  return createHash("sha256")
    .update("taskdesk:outbox-dedupe-reservation:v1", "utf8")
    .update(Buffer.from([0]))
    .update(
      encodeLengthPrefixed([
        input.recipientPersonId,
        input.channel,
        input.dedupeKey,
      ]),
    )
    .digest();
}

export const NOTIFICATION_ATTEMPT_LIMIT = 6;

const RETRY_BACKOFF_MS = [
  30_000,
  2 * 60_000,
  10 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
] as const;

/**
 * Delay applied when an eligibility result is unresolved (quiet-hours or destination
 * contract pending) or the evaluator fails. The specs name no schedule for these, so this
 * reuses the first, smallest step of the existing retry schedule. It consumes no attempt.
 */
export const NOTIFICATION_UNRESOLVED_BACKOFF_MS = RETRY_BACKOFF_MS[0];

/** Returns the documented delay for a durable attempt, or null at the terminal cap. */
export function notificationRetryDelayMs(attempt: number): number | null {
  if (
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    attempt > NOTIFICATION_ATTEMPT_LIMIT
  ) {
    throw new RangeError(
      "Notification attempt must be an integer from 1 through 6",
    );
  }
  if (attempt === NOTIFICATION_ATTEMPT_LIMIT) return null;
  return RETRY_BACKOFF_MS[attempt - 1] ?? null;
}

export class NotificationProviderDeadlineExceeded extends Error {
  constructor() {
    super("Notification provider deadline exceeded");
    this.name = "NotificationProviderDeadlineExceeded";
  }
}

/**
 * NO-11: starts a cancellable adapter request, asks it to stop at the absolute
 * deadline, and stops awaiting even if the adapter ignores cancellation.
 */
export async function callNotificationProvider<T>(
  send: (signal: AbortSignal) => Promise<T>,
  options: { deadlineMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const deadlineMs = options.deadlineMs ?? 30_000;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new RangeError("Notification provider deadline must be positive");
  }
  if (options.signal?.aborted) throw options.signal.reason;
  const controller = new AbortController();
  let rejectCallerAbort: ((reason?: unknown) => void) | undefined;
  const callerAbort = new Promise<never>((_, reject) => {
    rejectCallerAbort = reject;
  });
  const abortFromCaller = () => {
    controller.abort(options.signal?.reason);
    rejectCallerAbort?.(options.signal?.reason);
  };
  if (options.signal?.aborted) abortFromCaller();
  else
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const task = Promise.resolve().then(() => send(controller.signal));
  // Observe late rejection if the adapter ignores cancellation and settles after
  // the deadline race has already returned.
  void task.catch(() => undefined);
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new NotificationProviderDeadlineExceeded());
      reject(new NotificationProviderDeadlineExceeded());
    }, deadlineMs);
  });
  try {
    const result = await Promise.race([task, deadline, callerAbort]);
    if (options.signal?.aborted) throw options.signal.reason;
    return result;
  } catch (error) {
    if (timedOut) throw new NotificationProviderDeadlineExceeded();
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}
