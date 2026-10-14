/**
 * Resolves once the page has painted and the main thread is idle, so work that is not needed
 * for the first paint (G11) does not compete with it for bandwidth or CPU. Always resolves:
 * a missing paint timing API or a page that never paints falls back to a timer.
 */
export function afterFirstPaint({
  idleTimeoutMs = 2_000,
  paintTimeoutMs = 5_000,
}: {
  idleTimeoutMs?: number;
  paintTimeoutMs?: number;
} = {}): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let observer: PerformanceObserver | undefined;
    let paintTimer: ReturnType<typeof setTimeout> | undefined;

    const whenIdle = () => {
      if (typeof requestIdleCallback === "function")
        requestIdleCallback(() => resolve(), { timeout: idleTimeoutMs });
      else setTimeout(resolve, 200);
    };
    const painted = () => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      if (paintTimer !== undefined) clearTimeout(paintTimer);
      whenIdle();
    };

    try {
      if (
        typeof performance !== "undefined" &&
        performance.getEntriesByName("first-contentful-paint").length > 0
      )
        return painted();
      if (typeof PerformanceObserver === "undefined") return painted();
      observer = new PerformanceObserver((list) => {
        if (list.getEntriesByName("first-contentful-paint").length > 0)
          painted();
      });
      observer.observe({ type: "paint", buffered: true });
      paintTimer = setTimeout(painted, paintTimeoutMs);
    } catch {
      painted();
    }
  });
}
