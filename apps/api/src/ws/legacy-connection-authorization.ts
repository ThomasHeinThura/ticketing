import type { WSContext } from "hono/ws";

const REFRESH_INTERVAL_MS = 60_000;
/**
 * How long a legacy PROJECT socket reuses one passing authority lookup for event deliveries on
 * that same socket (#748). A burst of events would otherwise repeat the whole lookup, roughly
 * eleven database queries, once per event per connection. The window is the longest a
 * revocation that is not announced on the control channel can go unnoticed by event delivery;
 * an announced one (`identity.invalidate`), the 60-second floor and any failed or refused
 * lookup never use it.
 */
export const LEGACY_AUTHORIZATION_REUSE_MS = 1_500;
// Bound retained fan-out while an authority lookup is slow or unavailable.
const MAX_PENDING_CHECKS = 64;

/** All checks for one socket are ordered; a failed check is terminal. */
export function createLegacyConnectionAuthorization(
  ws: WSContext,
  authorize: () => Promise<boolean>,
  remove: () => void,
  /** How long a passing lookup may be reused by event deliveries; 0 (the default) never reuses. */
  reuseMs = 0,
) {
  let disposed = false;
  let pending = 0;
  let queue = Promise.resolve();
  // A passing lookup is reusable until `reusableUntil` (a monotonic `performance.now()` time, so
  // a wall-clock step cannot stretch the window). Checks run strictly one at a time, so a
  // fresh check can never be overtaken by a lookup that started before it.
  let reusableUntil = 0;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearInterval(refresh);
  };

  const reject = () => {
    if (disposed) return;
    dispose();
    remove();
    try {
      ws.close(1008, "authorization unavailable");
    } catch {
      // The connection is already removed even if its transport has failed.
    }
  };

  /**
   * `fresh` forces a real lookup (control-channel invalidation, the 60-second floor); without
   * it a delivery may reuse a passing lookup that is at most `reuseMs` old.
   */
  const check = (payload?: string, options: { fresh?: boolean } = {}) => {
    if (disposed) return Promise.resolve();
    if (pending >= MAX_PENDING_CHECKS) {
      reject();
      return Promise.resolve();
    }
    pending += 1;
    queue = queue.then(async () => {
      try {
        if (disposed) return;
        let allowed: boolean;
        if (
          !options.fresh &&
          reuseMs > 0 &&
          performance.now() < reusableUntil
        ) {
          allowed = true;
        } else {
          allowed = await authorize();
          if (allowed) reusableUntil = performance.now() + reuseMs;
        }
        if (disposed) return;
        if (!allowed) {
          reject();
          return;
        }
        if (payload !== undefined) ws.send(payload);
      } catch {
        reject();
      } finally {
        pending -= 1;
      }
    });
    return queue;
  };

  const refresh = setInterval(() => {
    void check(undefined, { fresh: true });
  }, REFRESH_INTERVAL_MS);
  refresh.unref();

  return { check, dispose };
}
