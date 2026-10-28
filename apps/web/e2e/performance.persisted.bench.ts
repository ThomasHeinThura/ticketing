import os from "node:os";
import { expect, test } from "@playwright/test";
import {
  assertCalibrationSourcePinned,
  CALIBRATION_BATCHES,
  CALIBRATION_OPTIONS,
  CALIBRATION_SOURCE,
  type Calibration,
  calibratedMedianOfThreeWithRetry,
  describeHost,
  resolveJobCalibration,
} from "../../../scripts/ci/lib/performance-calibration.mjs";
import {
  appendAllListPages,
  authenticatedContext,
  CANONICAL_SELECTORS,
  readPersistedInput,
  verifyPersistedFixture,
} from "./helpers/g11-persisted-fixture";
import { installLastItemPaintRecorder } from "./helpers/last-item-paint-recorder";
import { redactSecretErrorContext } from "./helpers/redact-secret-error-context";

// Deliberately a first read-only slice: passing these two tests is NOT a full G11 pass.
// No route interception, server, seed, direct DB writes or synthetic session cookies.
let calibration: Calibration;
test.afterEach(async (_fixtures, info) => redactSecretErrorContext(info));
test.beforeAll(async ({ browser }, info) => {
  assertCalibrationSourcePinned();
  const batches: number[][] = [];
  for (let index = 0; index < CALIBRATION_BATCHES; index++) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    try {
      const page = await context.newPage();
      await page.goto("about:blank");
      batches.push(
        await page.evaluate<number[]>(
          `(${CALIBRATION_SOURCE})(${JSON.stringify(CALIBRATION_OPTIONS)})`,
        ),
      );
    } finally {
      await context.close();
    }
  }
  calibration = resolveJobCalibration({ batches, state: "unthrottled" });
  await info.attach("calibration", {
    contentType: "application/json",
    body: JSON.stringify({
      host: describeHost({
        osCpuModel: os.cpus()[0]?.model,
        parallelism: os.availableParallelism(),
      }),
      calibration,
    }),
  });
  const input = readPersistedInput(
    String(info.config.metadata.persistedG11Input),
  );
  const context = await authenticatedContext(browser, input);
  try {
    await verifyPersistedFixture(context.request, input, input.list);
    await verifyPersistedFixture(context.request, input, input.board);
  } finally {
    await context.close();
  }
});

for (const kind of ["list", "board"] as const) {
  test(`persisted canonical ${kind}: ${kind === "list" ? 500 : 200} real items, document start to last paint <500ms`, async ({
    browser,
  }, info) => {
    const input = readPersistedInput(
      String(info.config.metadata.persistedG11Input),
    );
    const fixture = input[kind];
    const result = await calibratedMedianOfThreeWithRetry({
      metric: kind,
      budget: 500,
      calibration,
      sample: async () => {
        const context = await authenticatedContext(browser, input);
        try {
          const page = await context.newPage();
          await page.addInitScript(() => {
            (
              window as Window & { __g11Metrics?: Record<string, number> }
            ).__g11Metrics = { documentStart: performance.now() };
          });
          const expectedIds = fixture.items.map((item) => item.id);
          await installLastItemPaintRecorder(
            page,
            kind === "list"
              ? {
                  kind,
                  metric: "listPaint",
                  expectedCount: 500,
                  canonical: {
                    selector: CANONICAL_SELECTORS.list,
                    expectedIds,
                  },
                }
              : {
                  kind,
                  metric: "boardPaint",
                  expectedCount: 200,
                  canonical: {
                    selector: CANONICAL_SELECTORS.board,
                    expectedIds,
                  },
                },
          );
          const url = new URL(
            `/agent/projects/${encodeURIComponent(fixture.projectKey)}/work`,
            input.agentOrigin,
          );
          url.searchParams.set("layout", kind);
          url.searchParams.set("sort", "position");
          url.searchParams.set("dir", "asc");
          await page.goto(url.href, { waitUntil: "domcontentloaded" });
          // Time remains document-relative throughout all real Load more clicks and paints.
          if (kind === "list") await appendAllListPages(page, expectedIds);
          const metric = kind === "list" ? "listPaint" : "boardPaint";
          await page.waitForFunction(
            (name) =>
              ((window as Window & { __g11Metrics?: Record<string, number> })
                .__g11Metrics?.[name] ?? 0) > 0,
            metric,
          );
          return await page.evaluate((name) => {
            const metrics = (
              window as Window & { __g11Metrics?: Record<string, number> }
            ).__g11Metrics!;
            return metrics[name] - metrics.documentStart;
          }, metric);
        } finally {
          await context.close();
        }
      },
    });
    await info.attach(`${kind}-samples`, {
      contentType: "application/json",
      body: JSON.stringify(result),
    });
    expect(result.result).toBeLessThan(500);
  });
}
