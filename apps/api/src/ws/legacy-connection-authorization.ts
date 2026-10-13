import type { WSContext } from "hono/ws";

const REFRESH_INTERVAL_MS = 60_000;
// Bound retained fan-out while an authority lookup is slow or unavailable.
const MAX_PENDING_CHECKS = 64;

/** All checks for one socket are ordered; a failed check is terminal. */
export function createLegacyConnectionAuthorization(
  ws: WSContext,
  authorize: () => Promise<boolean>,
  remove: () => void,
) {
  let disposed = false;
  let pending = 0;
  let queue = Promise.resolve();

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

  const check = (payload?: string) => {
    if (disposed) return Promise.resolve();
    if (pending >= MAX_PENDING_CHECKS) {
      reject();
      return Promise.resolve();
    }
    pending += 1;
    queue = queue.then(async () => {
      try {
        if (disposed) return;
        const allowed = await authorize();
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
    void check();
  }, REFRESH_INTERVAL_MS);
  refresh.unref();

  return { check, dispose };
}
