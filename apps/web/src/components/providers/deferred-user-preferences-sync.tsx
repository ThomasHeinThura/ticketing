import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";

// The sync pulls the settings fetcher, query hook, write queue and reconcile logic into
// whatever chunk loads it. It never affects the first paint (the persisted store already
// supplies the cached density synchronously), so it is kept out of the entry chunk and only
// starts once the browser is idle after the first frames.
//
// A failed chunk load (a stale hashed chunk after a deploy, or a network blip) must not reach
// the app error boundary: the sync is a background reconcile, so on failure it renders
// nothing and the cached density stays in place.
export function loadUserPreferencesSync(
  importer: () => Promise<{
    UserPreferencesSync: () => ReactNode;
  }> = () => import("./user-preferences-sync"),
): Promise<{ default: () => ReactNode }> {
  return importer().then(
    (module) => ({ default: module.UserPreferencesSync }),
    () => ({ default: () => null }),
  );
}

const UserPreferencesSync = lazy(() => loadUserPreferencesSync());

const IDLE_TIMEOUT_MS = 3_000;

/** Mounts `UserPreferencesSync` after first paint instead of on the critical path. */
export function DeferredUserPreferencesSync() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let idle: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      if (!cancelled) setReady(true);
    };
    // Two frames: the first lets the initial render commit and paint; the second guarantees
    // the browser has had a chance to paint before any extra work is scheduled.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (typeof requestIdleCallback === "function")
          idle = requestIdleCallback(start, { timeout: IDLE_TIMEOUT_MS });
        else timer = setTimeout(start, 200);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (idle !== undefined && typeof cancelIdleCallback === "function")
        cancelIdleCallback(idle);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);

  if (!ready) return null;
  return (
    <Suspense fallback={null}>
      <UserPreferencesSync />
    </Suspense>
  );
}
