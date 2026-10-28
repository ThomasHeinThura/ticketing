import { useEffect, useState } from "react";

/**
 * Whether a lazily loaded module is here, so a screen can mount it with an ordinary update
 * instead of suspending for it. Content that suspended is revealed as a Suspense retry, and
 * React throttles retries to 300 ms after the most recent fallback anywhere on the page; on a
 * cold load, where the shell's own lazy controls commit fallbacks, that held a ready list or
 * board back for most of that window (G11 board and table render). While the module loads the
 * caller renders its loading state itself. A failed download also reports ready, so the
 * caller's `lazy` boundary retries and surfaces the error as before.
 */
export function useModuleReady(
  load: () => Promise<unknown>,
  isLoaded: () => boolean,
  enabled = true,
) {
  const [settled, setSettled] = useState(isLoaded);
  useEffect(() => {
    if (!enabled || settled) return;
    let current = true;
    load().then(
      () => current && setSettled(true),
      () => current && setSettled(true),
    );
    return () => {
      current = false;
    };
  }, [enabled, load, settled]);
  return settled || isLoaded();
}
