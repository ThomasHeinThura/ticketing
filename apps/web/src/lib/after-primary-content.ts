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
 * work list and boards that is after their rows render (`data-primary-content-ready`), so
 * secondary UI never competes with them (G11 work-list render and LCP); elsewhere it is
 * after the first paint. Always resolves: a screen that never marks itself falls back to a
 * timer.
 */
export function afterPrimaryContent({
  timeoutMs = 10_000,
}: {
  timeoutMs?: number;
} = {}): Promise<void> {
  if (
    typeof document === "undefined" ||
    !waitsForPrimaryContent(window.location.pathname) ||
    document.querySelector(MARKER)
  )
    return afterFirstPaint();
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (document.querySelector(MARKER)) done();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-primary-content-ready"],
    });
    const timer = setTimeout(done, timeoutMs);
  }).then(() => afterFirstPaint());
}
