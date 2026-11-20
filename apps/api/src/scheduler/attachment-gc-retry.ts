/** Largest value of the `attachment_object_gc.attempts` integer column. */
export const MAX_ATTEMPTS = 2147483647;

/**
 * One saturated step for the queue's attempts counter and its capped delay (PTM-06). The same
 * `next` gives both the stored attempts and the delay: 1, 2, 4, 8, 16, then 30 days. It
 * saturates at `MAX_ATTEMPTS` and treats a negative value as 0, so no interval or integer
 * overflow can occur. Pure: the collector reads the old value under the row lock and writes
 * both results as parameters.
 */
export function nextRetry(oldAttempts: number) {
  const next = Math.min(Math.max(oldAttempts, 0), MAX_ATTEMPTS - 1) + 1;
  const days = Math.min(30, 2 ** (Math.min(next, 6) - 1));
  return { next, days };
}
