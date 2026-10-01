type RoutePaintMetrics = {
  routeStart: number;
  routePaint: number;
  routePaintTarget: "" | "loading" | "detail";
  routeVisibilityProbeCount: number;
  routeVisibilityProbeTotalMs: number;
  routeVisibilityProbeMaxMs: number;
};

type RoutePaintWindow = Window & {
  __g11Metrics?: RoutePaintMetrics;
};

export function installRoutePaintRecorder() {
  const browserWindow = window as RoutePaintWindow;
  const probe = (selector: string, target: "loading" | "detail") => {
    const metrics = browserWindow.__g11Metrics;
    const started = performance.now();
    const element = document.querySelector(selector);
    let visible = false;
    if (element?.isConnected) {
      let styleVisible = true;
      for (
        let ancestor: Element | null = element;
        ancestor;
        ancestor = ancestor.parentElement
      ) {
        const style = getComputedStyle(ancestor);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          style.contentVisibility === "hidden" ||
          Number(style.opacity) === 0
        ) {
          styleVisible = false;
          break;
        }
      }
      if (styleVisible) {
        const rect = element.getBoundingClientRect();
        visible = rect.width > 0 && rect.height > 0;
      }
    }
    const durationMs = Math.max(0, performance.now() - started);
    if (metrics) {
      metrics.routeVisibilityProbeCount += 1;
      metrics.routeVisibilityProbeTotalMs += durationMs;
      metrics.routeVisibilityProbeMaxMs = Math.max(
        metrics.routeVisibilityProbeMaxMs,
        durationMs,
      );
    }
    return visible
      ? { target, durationMs }
      : { target: "" as const, durationMs };
  };
  let pending = false;

  const recordAfterPaint = () => {
    const metrics = browserWindow.__g11Metrics;
    if (
      !metrics ||
      metrics.routeStart <= 0 ||
      metrics.routePaint > 0 ||
      pending
    )
      return;
    const candidate =
      probe('[data-testid="work-item-detail-loading"]', "loading").target ||
      probe('[data-testid="work-item-detail"]', "detail").target;
    if (!candidate) return;

    pending = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const atMark =
          probe('[data-testid="work-item-detail-loading"]', "loading").target ||
          probe('[data-testid="work-item-detail"]', "detail").target;
        if (!atMark) {
          pending = false;
          return;
        }
        metrics.routePaintTarget = atMark;
        metrics.routePaint = performance.now() - metrics.routeStart;
      }),
    );
  };

  const poll = () => {
    const metrics = browserWindow.__g11Metrics;
    if (!metrics || metrics.routeStart <= 0 || metrics.routePaint > 0) return;
    recordAfterPaint();
    requestAnimationFrame(poll);
  };

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      const href = target?.closest("a[href]")?.getAttribute("href");
      if (!href?.includes("/agent/work-items/WLP-1")) return;
      const metrics = browserWindow.__g11Metrics;
      if (!metrics) return;
      metrics.routeStart = performance.now();
      metrics.routePaint = 0;
      metrics.routePaintTarget = "";
      pending = false;
      requestAnimationFrame(poll);
    },
    { capture: true },
  );
}
