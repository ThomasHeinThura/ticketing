import { afterFirstPaint } from "@/lib/i18n/after-first-paint";

const MARKER = "[data-primary-content-ready='true']";

/** The heavy screens (work list, boards) mark their primary content when it has rendered. */
export function waitsForPrimaryContent(pathname: string): boolean {
  return (
    (pathname.includes("/agent/projects/") && pathname.endsWith("/work")) ||
    pathname.endsWith("/board")
  );
}

/**
 * Resolves once the page's primary content has painted and the main thread is idle. On the
 * work list and boards that is after their rows, empty or error state render
 * (`data-primary-content-ready`), so secondary UI never competes with them (G11 work-list
 * render and LCP); elsewhere it is after the first paint. It stops waiting when the user
 * leaves for a page without the marker, and falls back to a timer, so it always resolves
 * unless `signal` aborts first.
 */
export function afterPrimaryContent({
  timeoutMs = 3_000,
  signal,
  onPrimaryContentReady,
}: {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Start downloads at the real heavy-screen marker; mounting still waits for paint/idle. */
  onPrimaryContentReady?: () => void;
} = {}): Promise<void> {
  const ready = () =>
    !waitsForPrimaryContent(window.location.pathname) ||
    document.querySelector(MARKER) !== null;
  const afterReady = () => {
    const primaryRendered =
      waitsForPrimaryContent(window.location.pathname) &&
      document.querySelector(MARKER) !== null;
    if (!signal?.aborted && primaryRendered) onPrimaryContentReady?.();
    // A real heavy-screen marker already waits for its rows/empty/error content.
    // Still yield to paint/idle, but do not add the full startup idle allowance
    // again: on a busy CPU that delayed sidebar readiness, then palette warm-up,
    // by multiple seconds after the primary content was usable (#876).
    return afterFirstPaint(primaryRendered ? { idleTimeoutMs: 300 } : {});
  };
  if (typeof document === "undefined") return afterFirstPaint();
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (ready()) return afterReady();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (aborted: boolean) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (aborted) reject(signal?.reason);
      else resolve();
    };
    const onAbort = () => finish(true);
    // Mutations also follow client-side navigation, so leaving the screen ends the wait.
    const observer = new MutationObserver(() => {
      if (ready()) finish(false);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-primary-content-ready"],
    });
    const timer = setTimeout(() => finish(false), timeoutMs);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort);
  }).then(afterReady);
}
