import { expect, test } from "@playwright/test";
import { installRoutePaintRecorder } from "./helpers/route-paint-recorder";

const HIDDEN_STYLES = [
  "display:none",
  "visibility:hidden",
  "width:0;height:0",
  "opacity:0",
] as const;

test.describe("G11 route-paint visibility marker", () => {
  test("does not mark a present hidden WLP-1 detail node before it becomes visible", async ({
    page,
  }) => {
    for (const hiddenStyle of HIDDEN_STYLES) {
      await page.setContent(`
        <a href="/agent/work-items/WLP-1">WLP-1</a>
        <main data-testid="work-item-detail" style="${hiddenStyle}">
          WLP-1 detail
        </main>
      `);
      await page.evaluate(() => {
        const link = document.querySelector("a[href]");
        link?.addEventListener("click", (event) => event.preventDefault());
        (
          window as Window & {
            __g11Metrics?: {
              routeStart: number;
              routePaint: number;
              routePaintTarget: "" | "loading" | "detail";
              routeVisibilityProbeCount: number;
              routeVisibilityProbeTotalMs: number;
              routeVisibilityProbeMaxMs: number;
            };
          }
        ).__g11Metrics = {
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
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve()),
                ),
              ),
            ),
          ),
      );
      const hiddenState = await page.evaluate(() => {
        const metrics = (
          window as Window & {
            __g11Metrics?: {
              routeStart: number;
              routePaint: number;
            };
          }
        ).__g11Metrics;
        return {
          connected: document.querySelector('[data-testid="work-item-detail"]')
            ?.isConnected,
          routeStart: metrics?.routeStart ?? 0,
          routePaint: metrics?.routePaint ?? 0,
        };
      });
      expect(hiddenState.connected).toBe(true);
      expect(hiddenState.routeStart).toBeGreaterThan(0);
      expect(hiddenState.routePaint).toBe(0);

      await page
        .locator('[data-testid="work-item-detail"]')
        .evaluate((node) => {
          node.removeAttribute("style");
        });
      await page.waitForFunction(
        () =>
          ((
            window as Window & {
              __g11Metrics?: { routePaint: number };
            }
          ).__g11Metrics?.routePaint ?? 0) > 0,
        undefined,
        { timeout: 2_000 },
      );
      const markedState = await page.evaluate(() => {
        const metrics = (
          window as Window & {
            __g11Metrics?: {
              routePaint: number;
              routePaintTarget: "" | "loading" | "detail";
              routeVisibilityProbeCount: number;
              routeVisibilityProbeTotalMs: number;
              routeVisibilityProbeMaxMs: number;
            };
          }
        ).__g11Metrics;
        const node = document.querySelector('[data-testid="work-item-detail"]');
        const rect = node?.getBoundingClientRect();
        return {
          routePaint: metrics?.routePaint ?? 0,
          routePaintTarget: metrics?.routePaintTarget ?? "",
          routeVisibilityProbeCount: metrics?.routeVisibilityProbeCount ?? 0,
          routeVisibilityProbeTotalMs:
            metrics?.routeVisibilityProbeTotalMs ?? 0,
          routeVisibilityProbeMaxMs: metrics?.routeVisibilityProbeMaxMs ?? 0,
          hasVisibleBox: Boolean(rect && rect.width > 0 && rect.height > 0),
        };
      });
      expect(markedState.routePaint).toBeGreaterThan(0);
      expect(markedState.routePaintTarget).toBe("detail");
      expect(markedState.routeVisibilityProbeCount).toBeGreaterThan(0);
      expect(markedState.routeVisibilityProbeTotalMs).toBeGreaterThanOrEqual(0);
      expect(markedState.routeVisibilityProbeMaxMs).toBeGreaterThanOrEqual(0);
      expect(markedState.hasVisibleBox).toBe(true);
    }
  });
});
