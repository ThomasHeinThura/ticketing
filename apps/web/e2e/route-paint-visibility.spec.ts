import { expect, type Page, test } from "@playwright/test";
import { installRoutePaintRecorder } from "./helpers/route-paint-recorder";

type TestMetrics = {
  routeStart: number;
  routePaint: number;
  routePaintTarget: "" | "loading" | "detail";
  routeVisibilityProbeCount: number;
  routeVisibilityProbeTotalMs: number;
  routeVisibilityProbeMaxMs: number;
};

const frameCycles = async (page: Page, count = 6) =>
  page.evaluate(
    (frameCount) =>
      new Promise<void>((resolve) => {
        const next = (remaining: number) => {
          if (remaining === 0) {
            resolve();
            return;
          }
          requestAnimationFrame(() => next(remaining - 1));
        };
        next(frameCount);
      }),
    count,
  );

const startRecording = async (
  page: Page,
  markup: string,
  beforeClick?: () => Promise<void>,
) => {
  await page.setContent(
    `<!doctype html><a href="/agent/work-items/WLP-1">WLP-1</a>${markup}`,
  );
  await page.evaluate(() => {
    document.querySelector("a[href]")?.addEventListener("click", (event) => {
      event.preventDefault();
    });
    (window as Window & { __g11Metrics?: TestMetrics }).__g11Metrics = {
      routeStart: 0,
      routePaint: 0,
      routePaintTarget: "",
      routeVisibilityProbeCount: 0,
      routeVisibilityProbeTotalMs: 0,
      routeVisibilityProbeMaxMs: 0,
    };
  });
  await page.evaluate(installRoutePaintRecorder);
  await beforeClick?.();
  await page.getByRole("link", { name: "WLP-1" }).click();
  await frameCycles(page);
};

const readMetrics = (page: Page) =>
  page.evaluate(
    () => (window as Window & { __g11Metrics?: TestMetrics }).__g11Metrics,
  );

const waitForMark = async (page: Page) => {
  await page.waitForFunction(
    () =>
      ((window as Window & { __g11Metrics?: TestMetrics }).__g11Metrics
        ?.routePaint ?? 0) > 0,
    undefined,
    { timeout: 2_000 },
  );
};

const FRACTIONAL_CLIP_CASES = [
  {
    name: "fractional far X edge with right border",
    axis: "x" as const,
    containerStyle:
      "width:100.6px;height:100px;overflow:hidden;border-right:2.49px solid red",
    targetStyle: "position:relative;left:100.8px;width:0.25px;height:20px",
    measuredClient: "clientWidth" as const,
    expectedExtent: 100.6,
  },
  {
    name: "fractional far Y edge with bottom border",
    axis: "y" as const,
    containerStyle:
      "width:100px;height:100.6px;overflow:hidden;border-bottom:2.49px solid red",
    targetStyle: "position:relative;top:100.8px;width:20px;height:0.25px",
    measuredClient: "clientHeight" as const,
    expectedExtent: 100.6,
  },
  {
    name: "fractional left border offset under unsupported CSS zoom",
    axis: "left" as const,
    containerStyle:
      "zoom:1.25;width:100px;height:60px;overflow:hidden;border-left:2.49px solid red",
    targetStyle: "margin-left:-0.25px;width:0.2px;height:20px",
    measuredClient: "clientLeft" as const,
    expectedExtent: 2.49,
  },
  {
    name: "fractional top border offset under unsupported CSS zoom",
    axis: "top" as const,
    containerStyle:
      "zoom:1.25;width:100px;height:60px;overflow:hidden;border-top:2.49px solid red",
    targetStyle: "margin-top:-0.25px;width:20px;height:0.2px",
    measuredClient: "clientTop" as const,
    expectedExtent: 2.49,
  },
] as const;

test.describe("G11 route-paint visibility marker", () => {
  test("waits for zero-area overflow clip boxes to expose detail", async ({
    page,
  }) => {
    const clippedParents = [
      { name: "overflow hidden", style: "overflow:hidden;width:0;height:0" },
      { name: "overflow clip", style: "overflow:clip;width:0;height:0" },
      {
        name: "empty inner box behind borders",
        style:
          "box-sizing:content-box;overflow:hidden;width:0;height:0;border:4px solid red",
      },
    ];

    for (const clippedParent of clippedParents) {
      await startRecording(
        page,
        `<section id="clip" style="${clippedParent.style}">
          <main data-testid="work-item-detail" style="width:100px;height:40px">WLP-1 detail</main>
        </section>`,
      );
      const clippedState = await page.evaluate(() => {
        const metrics = (window as Window & { __g11Metrics?: TestMetrics })
          .__g11Metrics;
        const target = document.querySelector(
          '[data-testid="work-item-detail"]',
        );
        const ancestor = document.querySelector("#clip");
        return {
          routePaint: metrics?.routePaint ?? 0,
          targetWidth: target?.getBoundingClientRect().width ?? 0,
          clipClientWidth: ancestor?.clientWidth ?? 0,
          clipClientHeight: ancestor?.clientHeight ?? 0,
        };
      });
      expect(clippedState.targetWidth).toBe(100);
      expect(clippedState.clipClientWidth).toBe(0);
      expect(clippedState.clipClientHeight).toBe(0);
      expect(clippedState.routePaint, clippedParent.name).toBe(0);

      await page.locator("#clip").evaluate((node) => {
        (node as HTMLElement).style.width = "100px";
        (node as HTMLElement).style.height = "60px";
      });
      await waitForMark(page);
      const visibleMetrics = await readMetrics(page);
      expect(visibleMetrics?.routePaintTarget, clippedParent.name).toBe(
        "detail",
      );
      expect(
        visibleMetrics?.routePaint ?? 0,
        clippedParent.name,
      ).toBeGreaterThan(0);
      expect(visibleMetrics?.routeVisibilityProbeCount ?? 0).toBeGreaterThan(0);
      expect(
        visibleMetrics?.routeVisibilityProbeTotalMs ?? -1,
      ).toBeGreaterThanOrEqual(0);
      expect(
        visibleMetrics?.routeVisibilityProbeMaxMs ?? -1,
      ).toBeGreaterThanOrEqual(0);
    }
  });

  for (const geometry of FRACTIONAL_CLIP_CASES) {
    test(`uses conservative subpixel clip bounds: ${geometry.name}`, async ({
      page,
    }) => {
      await startRecording(
        page,
        `<section id="clip" style="${geometry.containerStyle}">
          <main id="target" data-testid="work-item-detail" style="${geometry.targetStyle}">fractional detail</main>
        </section>`,
      );
      const observed = await page.evaluate((axis) => {
        const clip = document.querySelector("#clip") as HTMLElement;
        const target = document.querySelector("#target") as HTMLElement;
        const clipRect = clip.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const style = getComputedStyle(clip);
        const borderLeft = Number.parseFloat(style.borderLeftWidth);
        const borderTop = Number.parseFloat(style.borderTopWidth);
        const borderRight = Number.parseFloat(style.borderRightWidth);
        const borderBottom = Number.parseFloat(style.borderBottomWidth);
        const zoom = Number.parseFloat(style.zoom);
        const actualEdge =
          axis === "x"
            ? clipRect.right - borderRight
            : axis === "y"
              ? clipRect.bottom - borderBottom
              : axis === "left"
                ? clipRect.left + borderLeft * zoom
                : clipRect.top + borderTop * zoom;
        const targetNear =
          axis === "x"
            ? targetRect.left
            : axis === "y"
              ? targetRect.top
              : axis === "left"
                ? targetRect.right
                : targetRect.bottom;
        const roundedEdge =
          axis === "x"
            ? clipRect.left + clip.clientLeft + clip.clientWidth
            : axis === "y"
              ? clipRect.top + clip.clientTop + clip.clientHeight
              : axis === "left"
                ? clipRect.left + clip.clientLeft
                : clipRect.top + clip.clientTop;
        const measured =
          axis === "x"
            ? clip.clientWidth
            : axis === "y"
              ? clip.clientHeight
              : axis === "left"
                ? clip.clientLeft
                : clip.clientTop;
        const metrics = (window as Window & { __g11Metrics?: TestMetrics })
          .__g11Metrics;
        return {
          routePaint: metrics?.routePaint ?? 0,
          clientLeft: clip.clientLeft,
          clientTop: clip.clientTop,
          clientWidth: clip.clientWidth,
          clientHeight: clip.clientHeight,
          clipRect: {
            left: clipRect.left,
            right: clipRect.right,
            top: clipRect.top,
            bottom: clipRect.bottom,
          },
          targetRect: {
            left: targetRect.left,
            right: targetRect.right,
            top: targetRect.top,
            bottom: targetRect.bottom,
          },
          actualEdge,
          targetNear,
          roundedEdge,
          measured,
          borderLeft,
          borderTop,
          borderRight,
          borderBottom,
          zoom,
          effectiveBorderOffset:
            axis === "left"
              ? borderLeft * zoom
              : axis === "top"
                ? borderTop * zoom
                : 0,
        };
      }, geometry.axis);
      expect(
        geometry.measuredClient === "clientWidth"
          ? observed.clientWidth > geometry.expectedExtent
          : geometry.measuredClient === "clientHeight"
            ? observed.clientHeight > geometry.expectedExtent
            : geometry.measuredClient === "clientLeft"
              ? observed.clientLeft < geometry.expectedExtent
              : observed.clientTop < geometry.expectedExtent,
      ).toBe(true);
      if (geometry.axis === "x" || geometry.axis === "y") {
        expect(observed.targetNear).toBeGreaterThan(observed.actualEdge);
        expect(observed.targetNear).toBeLessThan(observed.roundedEdge);
      } else {
        expect(observed.zoom).toBe(1.25);
        expect(observed.measured).toBeLessThan(observed.effectiveBorderOffset);
        expect(observed.targetNear).toBeLessThan(observed.actualEdge);
        expect(observed.targetNear).toBeGreaterThan(observed.roundedEdge);
      }
      expect(observed.routePaint, JSON.stringify(observed)).toBe(0);

      await page.locator("#clip").evaluate((node) => {
        (node as HTMLElement).style.width = "150px";
        (node as HTMLElement).style.height = "150px";
        (node as HTMLElement).style.zoom = "1";
      });
      await page.locator("#target").evaluate((node) => {
        const target = node as HTMLElement;
        target.style.position = "static";
        target.style.left = "0";
        target.style.top = "0";
        target.style.margin = "0";
        target.style.width = "10px";
        target.style.height = "20px";
      });
      await waitForMark(page);
      expect((await readMetrics(page))?.routePaintTarget).toBe("detail");
    });
  }

  test("uses conservative viewport bounds for a fractional edge intersection", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await startRecording(
      page,
      `<style>body{margin:0}</style><main id="target" data-testid="work-item-detail" style="position:relative;left:799.5px;width:0.25px;height:20px">fractional viewport edge</main>`,
    );
    const edgeState = await page.evaluate(() => {
      const target = document.querySelector("#target") as HTMLElement;
      const rect = target.getBoundingClientRect();
      const width = document.documentElement.clientWidth;
      const metrics = (window as Window & { __g11Metrics?: TestMetrics })
        .__g11Metrics;
      return {
        routePaint: metrics?.routePaint ?? 0,
        width,
        left: rect.left,
        right: rect.right,
      };
    });
    expect(edgeState.width).toBe(800);
    expect(edgeState.left).toBeGreaterThan(edgeState.width - 1);
    expect(edgeState.right).toBeLessThan(edgeState.width);
    expect(edgeState.routePaint).toBe(0);

    await page.locator("#target").evaluate((node) => {
      const target = node as HTMLElement;
      target.style.left = "20px";
      target.style.width = "10px";
    });
    await waitForMark(page);
    expect((await readMetrics(page))?.routePaintTarget).toBe("detail");
  });

  test("waits for viewport intersection and accepts partial scrollport visibility", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await startRecording(
      page,
      `<main id="target" data-testid="work-item-detail" style="margin-top:1200px;height:40px">WLP-1 detail</main>`,
    );
    const outsideState = await page.evaluate(() => {
      const target = document.querySelector("#target");
      const rect = target?.getBoundingClientRect();
      return {
        metrics: (window as Window & { __g11Metrics?: TestMetrics })
          .__g11Metrics,
        viewport: {
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          scrollY: window.scrollY,
        },
        rect: rect && { top: rect.top, bottom: rect.bottom },
      };
    });
    expect(
      outsideState.metrics?.routePaint ?? 0,
      JSON.stringify(outsideState),
    ).toBe(0);
    await page.locator("#target").evaluate((node) => {
      (node as HTMLElement).style.marginTop = "0";
    });
    await waitForMark(page);
    expect((await readMetrics(page))?.routePaintTarget).toBe("detail");

    await startRecording(
      page,
      `<section style="box-sizing:border-box;display:flex;flex-direction:column;gap:4px;width:220px;height:100px;overflow-y:auto;padding:24px;margin-top:40px">
        <div style="height:50px;flex:none"></div>
        <main data-testid="work-item-detail" style="height:40px;flex:none">partly visible detail</main>
      </section>`,
    );
    const partial = await page.evaluate(() => {
      const target = document.querySelector('[data-testid="work-item-detail"]');
      const clip = document.querySelector("section") as HTMLElement | null;
      const targetRect = target?.getBoundingClientRect();
      const clipRect = clip?.getBoundingClientRect();
      const clipTop = (clipRect?.top ?? 0) + (clip?.clientTop ?? 0);
      const clipBottom = clipTop + (clip?.clientHeight ?? 0);
      return {
        routePaint:
          (window as Window & { __g11Metrics?: TestMetrics }).__g11Metrics
            ?.routePaint ?? 0,
        visibleHeight:
          targetRect && clipRect
            ? Math.max(
                0,
                Math.min(targetRect.bottom, clipBottom) -
                  Math.max(targetRect.top, clipTop),
              )
            : 0,
      };
    });
    expect(partial.visibleHeight).toBeGreaterThan(0);
    expect(partial.visibleHeight).toBeLessThan(40);
    expect(partial.routePaint).toBeGreaterThan(0);
    expect((await readMetrics(page))?.routePaintTarget).toBe("detail");
  });

  test("may fail closed inside the viewport's uncertain far-edge strip", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await startRecording(
      page,
      `<main id="target" data-testid="work-item-detail" style="display:block;width:0.25px;height:20px;margin-left:calc(100vw - 8.5px)">near viewport edge</main>`,
    );
    const edgeState = await page.evaluate(() => {
      const target = document.querySelector("#target") as HTMLElement;
      const rect = target.getBoundingClientRect();
      const width = document.documentElement.clientWidth;
      return {
        routePaint:
          (window as Window & { __g11Metrics?: TestMetrics }).__g11Metrics
            ?.routePaint ?? 0,
        width,
        left: rect.left,
        right: rect.right,
      };
    });
    expect(edgeState.width).toBe(800);
    expect(edgeState.left).toBeGreaterThan(edgeState.width - 1);
    expect(edgeState.right).toBeLessThan(edgeState.width);
    expect(edgeState.routePaint).toBe(0);

    await page.locator("#target").evaluate((node) => {
      const target = node as HTMLElement;
      target.style.marginLeft = "20px";
      target.style.width = "10px";
    });
    await waitForMark(page);
    expect((await readMetrics(page))?.routePaintTarget).toBe("detail");
  });

  test("checks RTL scrollbars when present and fails closed on overlay ambiguity", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await startRecording(
      page,
      `<section id="rtl-scroll" dir="rtl" style="box-sizing:border-box;width:120px;height:100px;overflow-y:scroll;scrollbar-gutter:stable;">
        <main id="target" data-testid="work-item-detail" style="position:relative;width:2px;height:20px">RTL detail</main>
        <div style="height:400px;width:200px"></div>
      </section>`,
      async () => {
        await page.locator("#target").evaluate((node) => {
          const target = node as HTMLElement;
          const clip = document.querySelector("#rtl-scroll") as HTMLElement;
          const clipRect = clip.getBoundingClientRect();
          const targetRect = target.getBoundingClientRect();
          const borderLeft = Number.parseFloat(
            getComputedStyle(clip).borderLeftWidth,
          );
          const gutter = clip.clientLeft - borderLeft;
          if (gutter <= 0) return;
          const destination =
            clipRect.left + borderLeft + gutter / 2 - targetRect.width / 2;
          target.style.left = `${destination - targetRect.left}px`;
        });
      },
    );
    const scrollbar = await page.evaluate(() => {
      const clip = document.querySelector("#rtl-scroll") as HTMLElement;
      const rect = clip.getBoundingClientRect();
      const style = getComputedStyle(clip);
      return {
        clientLeft: clip.clientLeft,
        clientWidth: clip.clientWidth,
        offsetWidth: clip.offsetWidth,
        borderLeft: Number.parseFloat(style.borderLeftWidth),
        left: rect.left,
        right: rect.right,
      };
    });
    const leftGutter = scrollbar.clientLeft - scrollbar.borderLeft;
    if (leftGutter > 0) {
      expect(scrollbar.offsetWidth - scrollbar.clientWidth).toBeGreaterThan(0);
      const gutterTarget = await page.locator("#target").evaluate((node) => {
        const target = node as HTMLElement;
        const clip = document.querySelector("#rtl-scroll") as HTMLElement;
        const clipRect = clip.getBoundingClientRect();
        const borderLeft = Number.parseFloat(
          getComputedStyle(clip).borderLeftWidth,
        );
        const clipEdge = clipRect.left + clip.clientLeft;
        return {
          clipEdge,
          borderLeft,
          rect: target.getBoundingClientRect().toJSON(),
        };
      });
      expect(gutterTarget.rect.left).toBeGreaterThanOrEqual(
        scrollbar.left + gutterTarget.borderLeft,
      );
      expect(gutterTarget.rect.right).toBeLessThan(gutterTarget.clipEdge);
      await frameCycles(page);
      expect((await readMetrics(page))?.routePaint ?? 0).toBe(0);
      const visibleGeometry = await page.locator("#target").evaluate((node) => {
        const target = node as HTMLElement;
        const clip = document.querySelector("#rtl-scroll") as HTMLElement;
        const clipRect = clip.getBoundingClientRect();
        const previousLeft = Number.parseFloat(target.style.left) || 0;
        target.style.width = "12px";
        const targetRect = target.getBoundingClientRect();
        const destination = clipRect.left + clip.clientLeft + 8;
        // `left` is a relative-position offset from the static position. Add
        // the desired physical delta to the existing CSS offset; replacing it
        // with `destination - currentRect.left` applies the original static
        // offset a second time and can leave the target clipped on Linux.
        target.style.left = `${previousLeft + destination - targetRect.left}px`;
        const visibleRect = target.getBoundingClientRect();
        const safeLeft = clipRect.left + clip.clientLeft + 1;
        const safeTop = clipRect.top + clip.clientTop + 1;
        const safeRight =
          clipRect.left + clip.clientLeft + clip.clientWidth - 2;
        const safeBottom =
          clipRect.top + clip.clientTop + clip.clientHeight - 2;
        return {
          safeIntersectionWidth: Math.max(
            0,
            Math.min(visibleRect.right, safeRight) -
              Math.max(visibleRect.left, safeLeft),
          ),
          safeIntersectionHeight: Math.max(
            0,
            Math.min(visibleRect.bottom, safeBottom) -
              Math.max(visibleRect.top, safeTop),
          ),
        };
      });
      expect(visibleGeometry.safeIntersectionWidth).toBeGreaterThan(2);
      expect(visibleGeometry.safeIntersectionHeight).toBeGreaterThan(2);
      await waitForMark(page);
      expect((await readMetrics(page))?.routePaintTarget).toBe("detail");
      return;
    }

    expect(scrollbar.offsetWidth).toBe(scrollbar.clientWidth);
    await startRecording(
      page,
      `<style>html{direction:rtl;overflow-y:scroll}body{min-height:2000px}</style>
      <main data-testid="work-item-detail" style="width:20px;height:20px">RTL root detail</main>`,
    );
    const rootGeometry = await page.evaluate(() => ({
      routePaint:
        (window as Window & { __g11Metrics?: TestMetrics }).__g11Metrics
          ?.routePaint ?? 0,
      rootWidth: document.documentElement.clientWidth,
      rootOffsetWidth: document.documentElement.offsetWidth,
      rootHeight: document.documentElement.clientHeight,
      rootScrollHeight: document.documentElement.scrollHeight,
      direction: getComputedStyle(document.documentElement).direction,
    }));
    expect(rootGeometry.direction).toBe("rtl");
    expect(rootGeometry.rootScrollHeight).toBeGreaterThan(
      rootGeometry.rootHeight,
    );
    expect(rootGeometry.rootOffsetWidth).toBe(rootGeometry.rootWidth);
    expect(rootGeometry.routePaint).toBe(0);
  });

  test("fails closed for unsupported clipping and preserves hidden-style checks", async ({
    page,
  }) => {
    const hiddenStyles = [
      "display:none",
      "visibility:hidden",
      "width:0;height:0",
      "opacity:0",
    ];
    for (const hiddenStyle of hiddenStyles) {
      await startRecording(
        page,
        `<main data-testid="work-item-detail" style="${hiddenStyle}">WLP-1 detail</main>`,
      );
      expect((await readMetrics(page))?.routePaint ?? 0, hiddenStyle).toBe(0);
      await page
        .locator('[data-testid="work-item-detail"]')
        .evaluate((node) => node.removeAttribute("style"));
      await waitForMark(page);
      expect((await readMetrics(page))?.routePaintTarget, hiddenStyle).toBe(
        "detail",
      );
    }

    const unsupportedGeometry = [
      {
        name: "nonrectangular clip path",
        markup: `<section style="clip-path:inset(0 100% 0 0)"><main data-testid="work-item-detail" style="width:100px;height:40px">detail</main></section>`,
      },
      {
        name: "transformed ancestor",
        markup: `<section style="transform:translateX(1px)"><main data-testid="work-item-detail" style="width:100px;height:40px">detail</main></section>`,
      },
      {
        name: "out-of-flow target",
        markup: `<main data-testid="work-item-detail" style="position:absolute;width:100px;height:40px">detail</main>`,
      },
      {
        name: "masked ancestor",
        markup: `<section style="mask-image:linear-gradient(black, transparent)"><main data-testid="work-item-detail" style="width:100px;height:40px">detail</main></section>`,
      },
      {
        name: "fragmented inline target",
        markup: `<div style="width:50px"><span data-testid="work-item-detail" style="display:inline">fragmented detail text that wraps over several lines</span></div>`,
      },
    ];
    for (const geometry of unsupportedGeometry) {
      await startRecording(page, geometry.markup);
      expect((await readMetrics(page))?.routePaint ?? 0, geometry.name).toBe(0);
    }
  });

  test("selects visible loading over clipped detail and permits direct detail", async ({
    page,
  }) => {
    await startRecording(
      page,
      `<section style="overflow:hidden;width:0;height:0">
        <main data-testid="work-item-detail" style="width:100px;height:40px">clipped detail</main>
      </section>
      <main data-testid="work-item-detail-loading" style="width:100px;height:40px">loading</main>`,
    );
    expect((await readMetrics(page))?.routePaintTarget).toBe("loading");

    await startRecording(
      page,
      `<main data-testid="work-item-detail" style="width:100px;height:40px">direct detail</main>`,
    );
    expect((await readMetrics(page))?.routePaintTarget).toBe("detail");
  });
});
