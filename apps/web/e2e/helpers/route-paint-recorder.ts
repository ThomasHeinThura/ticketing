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
      const targetRects = element.getClientRects();
      const region =
        targetRects.length === 1
          ? (() => {
              const rect = targetRects[0];
              return {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
              };
            })()
          : null;
      let supported = Boolean(
        region &&
          Number.isFinite(region.left) &&
          Number.isFinite(region.top) &&
          Number.isFinite(region.right) &&
          Number.isFinite(region.bottom) &&
          region.right > region.left &&
          region.bottom > region.top,
      );

      if (region && supported) {
        const root = document.documentElement;
        const body = document.body;
        const rootStyle = getComputedStyle(root);
        const bodyStyle = getComputedStyle(body);
        const rootVerticalOverflow = [rootStyle.overflowY, bodyStyle.overflowY];
        const rootHorizontalOverflow = [
          rootStyle.overflowX,
          bodyStyle.overflowX,
        ];
        const rootVerticalScroll =
          rootVerticalOverflow.includes("scroll") ||
          (!rootVerticalOverflow.some((overflow) =>
            ["hidden", "clip"].includes(overflow),
          ) &&
            (root.scrollHeight > root.clientHeight ||
              body.scrollHeight > root.clientHeight));
        const rootHorizontalScroll =
          rootHorizontalOverflow.includes("scroll") ||
          (!rootHorizontalOverflow.some((overflow) =>
            ["hidden", "clip"].includes(overflow),
          ) &&
            (root.scrollWidth > root.clientWidth ||
              body.scrollWidth > root.clientWidth));
        const ambiguousViewportOrigin =
          ((rootStyle.direction === "rtl" || bodyStyle.direction === "rtl") &&
            rootVerticalScroll) ||
          (rootStyle.writingMode !== "horizontal-tb" &&
            (rootVerticalScroll || rootHorizontalScroll)) ||
          ((rootStyle.scrollbarGutter.includes("both-edges") ||
            bodyStyle.scrollbarGutter.includes("both-edges")) &&
            (rootVerticalScroll || rootHorizontalScroll)) ||
          ((rootVerticalScroll || rootHorizontalScroll) &&
            (root.clientLeft !== 0 || root.clientTop !== 0));
        const visualViewport = window.visualViewport;
        const ambiguousVisualViewport =
          visualViewport !== null &&
          (visualViewport.scale !== 1 ||
            visualViewport.offsetLeft !== 0 ||
            visualViewport.offsetTop !== 0);
        const viewportWidth = root.clientWidth;
        const viewportHeight = root.clientHeight;
        if (
          ambiguousViewportOrigin ||
          ambiguousVisualViewport ||
          !Number.isInteger(viewportWidth) ||
          !Number.isInteger(viewportHeight) ||
          viewportWidth <= 1 ||
          viewportHeight <= 1
        ) {
          supported = false;
        } else {
          // The measured layout viewport extent may be rounded outward. Keep a
          // one-CSS-pixel inward strip at its far edges; root RTL/top-scrollbar
          // origins are rejected above instead of assuming they start at zero.
          region.left = Math.max(region.left, 0);
          region.top = Math.max(region.top, 0);
          region.right = Math.min(region.right, viewportWidth - 1);
          region.bottom = Math.min(region.bottom, viewportHeight - 1);
          supported = region.right > region.left && region.bottom > region.top;
        }
      }

      for (
        let ancestor: Element | null = element;
        ancestor && supported;
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
          supported = false;
          break;
        }

        // The approved route uses ordinary in-flow, axis-aligned boxes. Do not
        // infer a rectangular paint region for geometry modes this probe cannot
        // model faithfully.
        const hasTransform =
          style.transform !== "none" ||
          style.perspective !== "none" ||
          style.getPropertyValue("translate") !== "none" ||
          style.getPropertyValue("rotate") !== "none" ||
          style.getPropertyValue("scale") !== "none";
        const positionUnsupported =
          style.position === "absolute" ||
          style.position === "fixed" ||
          style.position === "sticky" ||
          style.float !== "none";
        const hasNonRectangularClip =
          style.clipPath !== "none" ||
          style.getPropertyValue("mask-image") !== "none" ||
          style.getPropertyValue("-webkit-mask-image") !== "none" ||
          style.clip !== "auto";
        const zoom = style.getPropertyValue("zoom");
        const clipMargin = style.getPropertyValue("overflow-clip-margin");
        const hasBorderRadius = [
          style.borderTopLeftRadius,
          style.borderTopRightRadius,
          style.borderBottomRightRadius,
          style.borderBottomLeftRadius,
        ].some((radius) => radius !== "0px" && radius !== "0px 0px");
        const clipsX = ["hidden", "clip", "auto", "scroll"].includes(
          style.overflowX,
        );
        const clipsY = ["hidden", "clip", "auto", "scroll"].includes(
          style.overflowY,
        );
        const containsPaint = style.contain
          .split(/\s+/)
          .some((value) => value === "paint" || value === "strict");
        const hasClip = clipsX || clipsY || containsPaint;

        if (
          hasTransform ||
          positionUnsupported ||
          hasNonRectangularClip ||
          (zoom !== "" && zoom !== "1" && zoom !== "normal") ||
          (clipMargin !== "" && clipMargin !== "0px") ||
          (hasClip && hasBorderRadius)
        ) {
          supported = false;
          break;
        }

        if (ancestor === element || !hasClip) continue;

        const ancestorRects = ancestor.getClientRects();
        if (ancestorRects.length !== 1) {
          supported = false;
          break;
        }
        const ancestorRect = ancestorRects[0];
        const clientLeft = ancestor.clientLeft;
        const clientTop = ancestor.clientTop;
        const clientWidth = ancestor.clientWidth;
        const clientHeight = ancestor.clientHeight;
        const clipLeft = ancestorRect.left + clientLeft + 1;
        const clipTop = ancestorRect.top + clientTop + 1;
        const clipRight = ancestorRect.left + clientLeft + clientWidth - 2;
        const clipBottom = ancestorRect.top + clientTop + clientHeight - 2;

        if (
          ![
            ancestorRect.left,
            ancestorRect.top,
            ancestorRect.right,
            ancestorRect.bottom,
          ].every(Number.isFinite) ||
          ancestorRect.right <= ancestorRect.left ||
          ancestorRect.bottom <= ancestorRect.top ||
          ![clipLeft, clipTop, clipRight, clipBottom].every(Number.isFinite) ||
          ![clientLeft, clientTop, clientWidth, clientHeight].every(
            (value) => Number.isInteger(value) && value >= 0,
          )
        ) {
          supported = false;
          break;
        }
        if (clipsX || containsPaint) {
          if (clipRight <= clipLeft) {
            supported = false;
            break;
          }
          region.left = Math.max(region.left, clipLeft);
          region.right = Math.min(region.right, clipRight);
        }
        if (clipsY || containsPaint) {
          if (clipBottom <= clipTop) {
            supported = false;
            break;
          }
          region.top = Math.max(region.top, clipTop);
          region.bottom = Math.min(region.bottom, clipBottom);
        }
        supported = region.right > region.left && region.bottom > region.top;
      }

      visible = supported;
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
