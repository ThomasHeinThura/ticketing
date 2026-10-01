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

const startRecording = async (page: Page, markup: string) => {
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
