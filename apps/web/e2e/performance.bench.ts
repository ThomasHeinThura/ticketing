import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import { type Browser, expect, type Page, test } from "@playwright/test";
import {
  median,
  medianOfThreeWithRetry,
} from "../../../scripts/ci/lib/performance-budget.mjs";
import {
  assertCalibrationSourcePinned,
  CALIBRATED_METRICS,
  CALIBRATION_BATCHES,
  CALIBRATION_OPTIONS,
  CALIBRATION_SOURCE,
  type CalibratedMetricId,
  type Calibration,
  type CalibrationSample,
  calibratedMedianOfThreeWithRetry,
  describeHost,
  PERFORMANCE_REFERENCE,
  resolveJobCalibration,
} from "../../../scripts/ci/lib/performance-calibration.mjs";
import {
  BOARD_ITEM_COUNT,
  BOARD_PROJECT_KEY,
  boardItemId,
  type G11Window,
  type G13Transition,
  installPerformanceApiFixture,
  PERFORMANCE_BASE_URL,
  PROJECT_ID,
  WORK_ITEM_KEY,
  WORK_LIST_PATH,
  WORKSPACE_ID,
} from "./helpers/g11-performance-fixture";
import { installLastItemPaintRecorder } from "./helpers/last-item-paint-recorder";
import { attachPerformanceNetworkCapture } from "./helpers/performance-network-summary";

type BudgetMetric = {
  name: string;
  budget: number;
  sample: () => Promise<number>;
};

/**
 * How a metric is judged under the G11 speed calibration. `metric` names its entry in
 * CALIBRATED_METRICS (throttle state, scale, and sensitivity k, with recorded evidence); the
 * budget is unchanged. Metrics without a `calibration` are judged raw (not CPU-bound).
 */
type CalibratedBudgetMetric = Omit<BudgetMetric, "sample"> & {
  sample: () => Promise<CalibrationSample>;
  calibration: { metric: CalibratedMetricId };
};

const SCREENSHOT_DIR = "test-results/g11-screens";
let networkAttachmentSequence = 0;

async function captureScreen(page: Page, name: string) {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` });
}

async function installFast4gAndCpuThrottle(page: Page) {
  // Leave the current application document before changing the network profile.
  // Chromium reports ERR_NETWORK_CHANGED for asset requests that were in flight
  // on the existing Vite page when emulateNetworkConditions is applied.
  await page.goto("about:blank");
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: 200_000,
    uploadThroughput: 93_750,
    connectionType: "cellular4g",
  });
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  return session;
}

/**
 * Runs the pinned calibration workload in a fresh context of the same browser, in the same
 * CPU-throttle state (4x, or none) as the metric it normalises, and returns the per-run
 * durations with warm-up runs already discarded.
 */
async function measureCalibrationRuns(browser: Browser, throttled: boolean) {
  assertCalibrationSourcePinned();
  const context = await browser.newContext({
    baseURL: PERFORMANCE_BASE_URL,
    viewport: { width: 1280, height: 720 },
  });
  let session:
    | Awaited<ReturnType<typeof installFast4gAndCpuThrottle>>
    | undefined;
  try {
    const page = await context.newPage();
    if (throttled) session = await installFast4gAndCpuThrottle(page);
    else await page.goto("about:blank");
    return await page.evaluate<number[]>(
      `(${CALIBRATION_SOURCE})(${JSON.stringify(CALIBRATION_OPTIONS)})`,
    );
  } finally {
    await session?.detach().catch(() => undefined);
    await context.close();
  }
}

function readCpuinfo() {
  try {
    return readFileSync("/proc/cpuinfo", "utf8");
  } catch {
    return undefined;
  }
}

/** One calibration per throttle state per job, taken at job start and used by every set. */
const jobCalibrations: Partial<
  Record<"throttled" | "unthrottled", Calibration>
> = {};

test.beforeAll(async ({ browser }) => {
  const host = describeHost({
    cpuinfoText: readCpuinfo(),
    osCpuModel: os.cpus()[0]?.model,
    parallelism: os.availableParallelism(),
  });
  console.log(
    `G11 host: cpu model ${host.cpuModel}; nproc ${String(host.nproc)}`,
  );
  const pinned =
    PERFORMANCE_REFERENCE.unthrottledMs !== null ||
    PERFORMANCE_REFERENCE.throttledMs !== null;
  console.log(
    `G11 calibration reference R0: ${
      pinned
        ? JSON.stringify(PERFORMANCE_REFERENCE)
        : "UNPINNED; calibration-only, metrics are judged raw"
    }`,
  );
  for (const state of ["unthrottled", "throttled"] as const) {
    const batches: number[][] = [];
    for (let index = 0; index < CALIBRATION_BATCHES; index += 1)
      batches.push(
        await measureCalibrationRuns(browser, state === "throttled"),
      );
    const calibration = resolveJobCalibration({ batches, state });
    jobCalibrations[state] = calibration;
    calibration.batches.forEach((batch, index) => {
      console.log(
        `G11 calibration job batch ${index + 1} [${state}]: runs (${batch.runs
          .map((value) => value.toFixed(2))
          .join(
            ", ",
          )}); median ${batch.medianMs.toFixed(2)}; spread ${batch.spread.toFixed(3)}`,
      );
    });
    console.log(
      `G11 calibration job [${state}]: mode ${calibration.mode}; median of batch medians ${calibration.medianMs.toFixed(2)}; max spread ${calibration.spread.toFixed(3)}; R0 ${calibration.referenceMs ?? "unpinned"}; factor ${
        calibration.mode === "calibrated"
          ? calibration.factor.toFixed(3)
          : "1 (not applied)"
      }${calibration.note ? `; note ${calibration.note}` : ""}`,
    );
  }
});

async function withPerformancePage(
  browser: Browser,
  throttled: boolean,
  sample: (page: Page, resetFixture: () => void) => Promise<number>,
  fixtureOptions?: Parameters<typeof installPerformanceApiFixture>[1],
) {
  const context = await browser.newContext({
    baseURL: PERFORMANCE_BASE_URL,
    viewport: { width: 1280, height: 720 },
  });
  const networkCapture = attachPerformanceNetworkCapture(
    context,
    PERFORMANCE_BASE_URL,
  );
  let session:
    | Awaited<ReturnType<typeof installFast4gAndCpuThrottle>>
    | undefined;
  let sampleOutcome:
    | { status: "success"; value: number }
    | { status: "failure"; error: unknown }
    | undefined;

  try {
    const page = await context.newPage();
    const resetFixture = await installPerformanceApiFixture(
      page,
      fixtureOptions,
    );
    if (throttled) session = await installFast4gAndCpuThrottle(page);
    sampleOutcome = {
      status: "success",
      value: await sample(page, resetFixture),
    };
  } catch (error) {
    sampleOutcome = { status: "failure", error };
  } finally {
    const cleanupErrors: unknown[] = [];
    if (session) {
      try {
        await session.detach();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await context.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    let networkSummary: string | undefined;
    try {
      networkSummary = networkCapture.finish();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (networkSummary !== undefined) {
      networkAttachmentSequence += 1;
      try {
        await test
          .info()
          .attach(`g11-network-sample-${networkAttachmentSequence}.json`, {
            body: networkSummary,
            contentType: "application/json",
          });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      if (sampleOutcome?.status === "failure") {
        sampleOutcome = {
          status: "failure",
          error: new AggregateError(
            [sampleOutcome.error, ...cleanupErrors],
            "G11 sample and evidence cleanup failed.",
          ),
        };
      } else {
        sampleOutcome = {
          status: "failure",
          error: new AggregateError(
            cleanupErrors,
            "G11 sample evidence cleanup failed.",
          ),
        };
      }
    }
  }
  if (sampleOutcome?.status === "failure") throw sampleOutcome.error;
  if (sampleOutcome === undefined)
    throw new Error("G11 sample did not produce an outcome.");
  return sampleOutcome.value;
}

async function waitForTwoFrames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

/**
 * The route's default layout is Kaneo's grouped list. While the project states load it first
 * renders the full work-item table, then the grouped list (all 500 rows as the Suspense
 * fallback), then the grouped list's virtual window. "Open" means that settled grouped list:
 * no interim table, the Backlog group counting all 500 items, the virtual rows mounted and
 * their inline controls in place.
 */
async function openWorkList(page: Page) {
  await page.goto(WORK_LIST_PATH);
  const list = page.locator("div[data-testid=work-item-list-populated]");
  const rows = list.locator("[data-virtual-item-id] [data-task-id]");
  try {
    await expect(list).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator("table[data-testid=work-item-list-populated]"),
    ).toHaveCount(0, { timeout: 30_000 });
    await expect(
      list.getByRole("button", { name: "Backlog 500", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    // The rows' inline property controls replace their static fallback last; until then a
    // click can land on a row that is being swapped out.
    await expect(
      list
        .locator("[data-virtual-item-id]")
        .first()
        .getByTestId("work-item-inline-assignee"),
    ).toBeVisible({ timeout: 30_000 });
  } catch (error) {
    const [rowCount, tableCount, testIdCount, bodyText] = await Promise.all([
      rows.count(),
      page.getByRole("table").count(),
      page.getByTestId("work-item-list-populated").count(),
      page.locator("body").innerText(),
    ]);
    console.error(
      "G11 list fixture did not settle on the 500-item grouped list:",
      JSON.stringify({
        url: page.url(),
        rowCount,
        tableCount,
        testIdCount,
        bodyText: bodyText.slice(0, 1200),
      }),
    );
    throw error;
  }
}

/** A grouped-list row's work-item link (its name is "<key> <title>", not the bare key). */
function workItemLink(page: Page, key: string) {
  return page
    .locator("div[data-testid=work-item-list-populated]")
    .locator(`a[href="/agent/work-items/${key}"]`);
}

async function collectNavigationMetric(
  page: Page,
  name: "lcp" | "cls",
  report?: { domContentLoaded?: number },
) {
  await openWorkList(page);
  await waitForTwoFrames(page);
  const value = await page.evaluate(
    (requested) => (window as G11Window).__g11Metrics[requested],
    name,
  );
  if (name === "lcp") {
    const diagnostic = await page.evaluate(() => ({
      metrics: {
        lcp: (window as G11Window).__g11Metrics.lcp,
        element: (window as G11Window).__g11Metrics.lcpElement,
        text: (window as G11Window).__g11Metrics.lcpText,
        url: (window as G11Window).__g11Metrics.lcpUrl,
      },
      navigation: (() => {
        const entry = performance.getEntriesByType("navigation")[0] as
          | PerformanceNavigationTiming
          | undefined;
        return entry
          ? {
              responseStart: entry.responseStart,
              domInteractive: entry.domInteractive,
              domContentLoaded: entry.domContentLoadedEventEnd,
              load: entry.loadEventEnd,
              domComplete: entry.domComplete,
            }
          : null;
      })(),
      lateResources: performance
        .getEntriesByType("resource")
        .map((entry) => entry as PerformanceResourceTiming)
        .filter(
          (entry) =>
            entry.name.includes("/assets/") || entry.name.includes("/api/"),
        )
        .sort((a, b) => b.responseEnd - a.responseEnd)
        .slice(0, 12)
        .map((entry) => ({
          url: entry.name.split("/").slice(-1)[0],
          initiator: entry.initiatorType,
          start: Math.round(entry.startTime),
          end: Math.round(entry.responseEnd),
          duration: Math.round(entry.duration),
          transfer: entry.transferSize,
        })),
      criticalResources: performance
        .getEntriesByType("resource")
        .map((entry) => entry as PerformanceResourceTiming)
        .filter((entry) =>
          /en-US-|agent-initial-runtime|work-[\w-]+\.js|geist-latin-wght-normal/.test(
            entry.name,
          ),
        )
        .map((entry) => ({
          url: entry.name.split("/").slice(-1)[0],
          start: Math.round(entry.startTime),
          end: Math.round(entry.responseEnd),
          duration: Math.round(entry.duration),
          transfer: entry.transferSize,
        }))
        .sort((left, right) => left.start - right.start),
    }));
    if (report)
      report.domContentLoaded = diagnostic.navigation?.domContentLoaded;
    console.info("G11 LCP diagnostic", JSON.stringify(diagnostic));
  }
  if (name === "lcp" && value <= 0)
    throw new Error("The work-list navigation emitted no LCP entry.");
  if (name === "lcp") await captureScreen(page, "work-list");
  return value;
}

async function collectCreateInteraction(page: Page, resetFixture: () => void) {
  resetFixture();
  await openWorkList(page);
  await page.getByTestId("create-work-item-trigger").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await captureScreen(page, "create-dialog");
  // The type is a Kaneo picker popover, not a select.
  await page.getByRole("dialog").getByRole("button", { name: "Type" }).click();
  await page
    .locator('[data-slot="popover-popup"]')
    .getByRole("button", { name: "Task", exact: true })
    .click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("G11 interaction sample");
  const createButton = page.getByTestId("create-work-item-submit");
  await createButton.click();
  await expect(createButton).toHaveAttribute("aria-busy", "true");
  await page.waitForFunction(
    () => (window as G11Window).__g11Metrics.interactionPaint > 0,
    undefined,
    { timeout: 15_000 },
  );
  const clickToPaint = await page.evaluate(
    () => (window as G11Window).__g11Metrics.interactionPaint,
  );
  if (clickToPaint <= 0)
    throw new Error("The create submit click emitted no pending-state paint.");
  // The grouped list windows its rows; the created item is counted in its state group.
  await expect(
    page
      .locator("div[data-testid=work-item-list-populated]")
      .getByRole("button", { name: "Backlog 501", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  return clickToPaint;
}

async function collectSignInInteraction(page: Page) {
  await page.goto("/auth/sign-in");
  const email = page.getByLabel("Email", { exact: true });
  const password = page.locator('input[type="password"]');
  await email.fill("g11@example.test");
  await password.fill("correct-horse-battery-staple");
  const submit = page.locator('form button[type="submit"]');
  await captureScreen(page, "sign-in");
  await submit.click();
  await expect(submit).toBeDisabled();
  await page.waitForFunction(
    () => (window as G11Window).__g11Metrics.signInPaint > 0,
    undefined,
    { timeout: 15_000 },
  );
  const clickToPaint = await page.evaluate(
    () => (window as G11Window).__g11Metrics.signInPaint,
  );
  await expect(page).toHaveURL(/\/(?:dashboard|agent)(?:\/|$)/, {
    timeout: 15_000,
  });
  return clickToPaint;
}

async function collectCommandPaletteInteraction(
  page: Page,
  metric: "open" | "navigate" = "open",
) {
  await page.addInitScript(() => {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        const observer = new MutationObserver(() => {
          if (!document.querySelector('[data-slot="command-dialog-popup"]'))
            return;
          performance.mark("taskdesk.palette.popup-inserted");
          observer.disconnect();
        });
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });
      },
      { once: true },
    );
  });
  await openWorkList(page);
  const palettePopup = page.locator('[data-slot="command-dialog-popup"]');
  try {
    await expect(palettePopup).toHaveCount(1);
  } catch (error) {
    console.error(
      "G11 palette warmup failure evidence",
      await page.evaluate(() => ({
        atMs: performance.now(),
        primaryReady:
          document.querySelector("[data-primary-content-ready='true']") !==
          null,
        phases: performance
          .getEntriesByType("mark")
          .filter((entry) => entry.name.startsWith("taskdesk.palette."))
          .map((entry) => ({ name: entry.name, atMs: entry.startTime })),
        scripts: performance
          .getEntriesByType("resource")
          .filter(
            (entry) =>
              entry.name.includes("/assets/") && entry.name.endsWith(".js"),
          )
          .slice(-20)
          .map((entry) => ({
            file: entry.name.split("/").pop(),
            atMs: entry.startTime,
            durationMs: entry.duration,
          })),
      })),
    );
    throw error;
  }
  await expect(palettePopup).toBeHidden();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+k" : "Control+k",
  );
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByPlaceholder(/search/i)).toBeFocused();
  await page.waitForFunction(
    () => (window as G11Window).__g11Metrics.palettePaint > 0,
    undefined,
    { timeout: 15_000 },
  );
  const clickToPaint = await page.evaluate(
    () => (window as G11Window).__g11Metrics.palettePaint,
  );
  const insertion = await page.evaluate(
    () => (window as G11Window).__g11Metrics.paletteInsert,
  );
  console.info(
    "G11 palette timing",
    JSON.stringify({ insertion, paint: clickToPaint }),
  );
  await captureScreen(page, "command-palette");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  const projectsOption = page.getByRole("option", { name: "Projects" });
  const projectsOptionId = await projectsOption.getAttribute("id");
  await expect(dialog.getByPlaceholder(/search/i)).toHaveAttribute(
    "aria-activedescendant",
    projectsOptionId ?? "",
  );
  await page.keyboard.press("Enter");
  const readNavigationPaint = async () => {
    await page.waitForFunction(
      () => (window as G11Window).__g11Metrics.paletteNavigationPaint > 0,
      undefined,
      { timeout: 15_000 },
    );
    return page.evaluate(
      () => (window as G11Window).__g11Metrics.paletteNavigationPaint,
    );
  };
  let navigationPaint =
    metric === "navigate" ? await readNavigationPaint() : null;
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/workspace/${WORKSPACE_ID}`),
  );
  await expect(
    page.getByRole("main").getByText("Performance fixture", { exact: true }),
  ).toBeVisible();
  await captureScreen(page, "projects-from-command-palette");
  navigationPaint ??= await readNavigationPaint();
  console.info("G11 palette navigation timing", navigationPaint);
  if (metric === "navigate") return navigationPaint;
  return clickToPaint;
}

/**
 * The legacy task page is gone: `/dashboard/.../task/{id}` now redirects to the canonical
 * work-item detail. The state, assignment and comment interactions are measured there, on the
 * same seeded item, with the same click-to-paint boundaries.
 */
async function openWorkItemDetails(page: Page) {
  await page.goto(`/agent/work-items/${WORK_ITEM_KEY}`);
  await expect(page.getByTestId("work-item-detail")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("work-item-state-control")).toHaveText(
    "Backlog",
    { timeout: 30_000 },
  );
}

async function collectTaskStateChange(page: Page) {
  await openWorkItemDetails(page);
  await captureScreen(page, "work-item-state");
  await page.getByTestId("work-item-state-control").click();
  await page
    .locator('[data-slot="popover-popup"]')
    .getByRole("button", { name: /^In progress/ })
    .click();
  await page.waitForFunction(
    () => (window as G11Window).__g11Metrics.statePaint > 0,
    undefined,
    { timeout: 15_000 },
  );
  const elapsed = await page.evaluate(
    () => (window as G11Window).__g11Metrics.statePaint,
  );
  await expect(page.getByTestId("work-item-state-control")).toHaveText(
    "In progress",
  );
  return elapsed;
}

async function collectTaskAssignment(page: Page) {
  await openWorkItemDetails(page);
  await captureScreen(page, "work-item-assignment");
  const assignee = page.getByTestId("work-item-assignee-control");
  await expect(assignee).toHaveText(/Unassigned/);
  await assignee.click();
  await page
    .locator('[data-slot="popover-popup"]')
    .getByRole("button", { name: /G11 Agent/ })
    .click();
  await page.waitForFunction(
    () => (window as G11Window).__g11Metrics.assignmentPaint > 0,
    undefined,
    { timeout: 15_000 },
  );
  const elapsed = await page.evaluate(
    () => (window as G11Window).__g11Metrics.assignmentPaint,
  );
  await expect(assignee).toHaveText(/G11 Agent/);
  return elapsed;
}

async function collectTaskComment(page: Page) {
  await openWorkItemDetails(page);
  await captureScreen(page, "work-item-comment");
  const composer = page.getByTestId("work-item-comment-composer");
  const editor = composer
    .locator(".taskdesk-comment-editor-content [contenteditable=true]")
    .first();
  await editor.fill("G11 comment fixture");
  // The composer's send control is the one button in it that carries `aria-busy`.
  const submit = composer.locator("button[aria-busy]");
  await expect(submit).toHaveCount(1);
  await submit.click();
  await expect(submit).toHaveAttribute("aria-busy", "true");
  await page.waitForFunction(
    () => (window as G11Window).__g11Metrics.commentPaint > 0,
    undefined,
    { timeout: 15_000 },
  );
  const elapsed = await page.evaluate(
    () => (window as G11Window).__g11Metrics.commentPaint,
  );
  // Sent: the composer clears and the comment is in the item's activity.
  await expect(editor).toHaveText("", { timeout: 15_000 });
  await expect(
    page
      .getByTestId("work-item-detail")
      .getByText("G11 comment fixture", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  return elapsed;
}

async function collectRouteTransition(page: Page) {
  await openWorkList(page);
  await workItemLink(page, WORK_ITEM_KEY).click();
  try {
    await page.waitForFunction(
      () => (window as G11Window).__g11Metrics.routePaint > 0,
      undefined,
      { timeout: 15_000 },
    );
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      metrics: (window as G11Window).__g11Metrics,
      loading: !!document.querySelector(
        '[data-testid="work-item-detail-loading"]',
      ),
      detail: !!document.querySelector('[data-testid="work-item-detail"]'),
    }));
    throw new Error(
      `Timed out recording the route paint: ${JSON.stringify(diagnostic)}`,
      { cause: error },
    );
  }
  const clickToPaint = await page.evaluate(
    () => (window as G11Window).__g11Metrics.routePaint,
  );
  if (clickToPaint <= 0)
    throw new Error("The detail route emitted no loading/content paint.");
  // A pending visibility assertion serializes Playwright's failure ARIA snapshot.
  // Keep that diagnostic work outside the independently recorded paint interval.
  await expect(
    page.locator(
      '[data-testid="work-item-detail-loading"], [data-testid="work-item-detail"]',
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("work-item-detail")).toBeVisible({
    timeout: 15_000,
  });
  await captureScreen(page, "work-item-detail");
  return clickToPaint;
}

async function collectG13WindowCls(page: Page, transition: G13Transition) {
  await page.waitForFunction(
    (requested) =>
      (window as G11Window).__g11Metrics.g13[requested].contentMark > 0,
    transition,
    { timeout: 15_000 },
  );
  await waitForTwoFrames(page);
  const measurement = await page.evaluate(
    (requested) => (window as G11Window).__g11Metrics.g13[requested],
    transition,
  );
  expect(
    measurement.skeletonMark,
    `G13 requires the ${transition} loading skeleton to be observed before content`,
  ).toBeGreaterThan(0);
  expect(measurement.contentMark).toBeGreaterThan(measurement.skeletonMark);
  console.info(`G13 ${transition} skeleton-to-content CLS`, measurement);
  return measurement.cls;
}

async function collectG13WindowMeasurement(
  page: Page,
  transition: G13Transition,
) {
  await page.waitForFunction(
    (requested) =>
      (window as G11Window).__g11Metrics.g13[requested].contentMark > 0,
    transition,
    { timeout: 15_000 },
  );
  await waitForTwoFrames(page);
  return page.evaluate(
    (requested) => (window as G11Window).__g11Metrics.g13[requested],
    transition,
  );
}

/**
 * The 500-row render metric measures the work route's table layout (`?layout=table`), the
 * feature-contracts-p1 "table with 500 rows", not the grouped list's interim fallback table.
 * Approved by Thomas on 27 Oct 2026: only the opened URL and the table's row selector changed.
 *
 * Thomas decided on 28 Oct 2026 what is counted: the virtualized table's first painted
 * viewport with all 500 rows loaded (the table's `aria-rowcount`), recorded by
 * `installLastItemPaintRecorder`'s list kind. The virtualized table windows its rows and never
 * mounts 500 `tbody tr`, so nothing here counts them. The budget (< 500 ms), sampling, retries
 * and calibration are unchanged.
 */
const WORK_TABLE_PATH = WORK_LIST_PATH.replace("layout=list", "layout=table");
const WORK_TABLE_SELECTOR =
  'table[data-testid=work-item-list-populated][data-virtualized-table="true"]';

async function collectListRender(page: Page) {
  await installLastItemPaintRecorder(page, {
    kind: "list",
    expectedCount: 500,
    metric: "listPaint",
  });
  await page.goto(WORK_TABLE_PATH);
  // Wait on the recorder's mark (polled per animation frame), not on locator assertions: a
  // retrying assertion over the page's DOM while the table loads competes with the render it
  // measures. The loaded row count is asserted once the mark is in.
  try {
    await page.waitForFunction(
      () => (window as G11Window).__g11Metrics.listPaint > 0,
      undefined,
      { timeout: 30_000 },
    );
  } catch (error) {
    console.error(
      "G11 list paint recorder diagnostics",
      JSON.stringify(
        await page.evaluate((selector) => {
          const table = document.querySelector(selector);
          return {
            metrics: (window as G11Window).__g11Metrics,
            recorder: (window as Window & { __g11PaintDebug?: unknown })
              .__g11PaintDebug,
            rowCount: table?.getAttribute("aria-rowcount"),
            mountedRows: table?.querySelectorAll(
              "tbody tr[data-virtual-row-id]",
            ).length,
          };
        }, WORK_TABLE_SELECTOR),
      ),
    );
    throw error;
  }
  await expect(page.locator(WORK_TABLE_SELECTOR)).toHaveAttribute(
    "aria-rowcount",
    "501",
  );
  await captureScreen(page, "work-list");
  return page.evaluate(
    () =>
      (window as G11Window).__g11Metrics.listPaint -
      (window as G11Window).__g11Metrics.documentStart,
  );
}

/**
 * The legacy board is gone: `/dashboard/.../project/{id}/board` now redirects to the canonical
 * work-item board. Board scenarios run on that board for the fixture's 200-item `BRD` project
 * (50 cards in each of four states, the legacy board's shape).
 */
const BOARD_PATH = `/agent/projects/${BOARD_PROJECT_KEY}/work?layout=board`;
const BOARD_CARD_SELECTOR =
  '[data-testid="work-item-board-card"] [data-task-id]';
const BOARD_FIXTURE = { boardProject: true, workflowCapabilities: true };

function boardCard(page: Page, number: number) {
  return page.locator(
    `[data-testid="work-item-board-card"] [data-task-id="${boardItemId(number)}"]`,
  );
}

function boardColumnOf(page: Page, number: number) {
  return page
    .locator(
      `[data-testid="work-item-board-column"]:has([data-task-id="${boardItemId(number)}"])`,
    )
    .getAttribute("data-state-id");
}

async function openCanonicalBoard(page: Page) {
  await page.goto(BOARD_PATH);
  await expect(page.locator(BOARD_CARD_SELECTOR)).toHaveCount(
    BOARD_ITEM_COUNT,
    { timeout: 30_000 },
  );
  await expect(
    page.getByText(`Seeded board item ${BOARD_ITEM_COUNT}`, { exact: true }),
  ).toHaveCount(1);
}

async function collectBoardRender(page: Page) {
  await installLastItemPaintRecorder(page, {
    kind: "board",
    expectedCount: 200,
    metric: "boardPaint",
    canonical: {
      selector: BOARD_CARD_SELECTOR,
      expectedIds: Array.from({ length: BOARD_ITEM_COUNT }, (_, index) =>
        boardItemId(index + 1),
      ),
    },
  });
  await page.goto(BOARD_PATH);
  await expect(page.locator(BOARD_CARD_SELECTOR)).toHaveCount(
    BOARD_ITEM_COUNT,
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    () => (window as G11Window).__g11Metrics.boardPaint > 0,
    undefined,
    { timeout: 10_000 },
  );
  await captureScreen(page, "board");
  return page.evaluate(
    () =>
      (window as G11Window).__g11Metrics.boardPaint -
      (window as G11Window).__g11Metrics.documentStart,
  );
}

async function collectBoardDragFrameP95(page: Page) {
  await openCanonicalBoard(page);
  await page.waitForTimeout(400);

  // A canonical cross-column drop is a transition (plus a rank next to the drop target when
  // the board is in manual order; rank is exempt from If-Match). Writes are CSRF-protected.
  const movePath = /^\/api\/work-items\/BRD-1\/(transition|rank)$/;
  let csrfIssuerRequests = 0;
  let csrfIssuerResponses = 0;
  const writeRequests: string[] = [];
  const writeResults: Array<{
    write: string;
    csrfHeaderPresent: boolean;
    status: number;
  }> = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === "/api/me/csrf-token")
      csrfIssuerRequests += 1;
    const write = movePath.exec(path)?.[1];
    if (request.method() === "POST" && write) writeRequests.push(write);
  });
  page.on("response", (response) => {
    const request = response.request();
    const path = new URL(response.url()).pathname;
    if (
      request.method() === "GET" &&
      path === "/api/me/csrf-token" &&
      response.status() === 200
    )
      csrfIssuerResponses += 1;
    const write = movePath.exec(path)?.[1];
    if (request.method() === "POST" && write)
      writeResults.push({
        write,
        csrfHeaderPresent: Boolean(request.headers()["x-taskdesk-csrf"]),
        status: response.status(),
      });
  });

  const source = await page
    .getByText("Seeded board item 1", { exact: true })
    .boundingBox();
  const destination = await page
    .getByText("Seeded board item 51", { exact: true })
    .boundingBox();
  if (!source || !destination)
    throw new Error("The seeded board cards have no browser bounding boxes.");

  await page.evaluate(() => {
    const metrics = (window as G11Window).__g11Metrics;
    const frameTimes: number[] = [];
    metrics.dragFrameTimes = frameTimes;
    let previous: number | undefined;
    const stopAt = performance.now() + 2200;
    const sampleFrame = (now: number) => {
      if (previous !== undefined) frameTimes.push(now - previous);
      previous = now;
      if (now < stopAt) requestAnimationFrame(sampleFrame);
    };
    requestAnimationFrame(sampleFrame);
  });

  const fromX = source.x + source.width / 2;
  const fromY = source.y + source.height / 2;
  const toX = destination.x + destination.width / 2;
  const toY = destination.y + destination.height / 2;
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  for (let step = 1; step <= 125; step += 1) {
    const progress = step / 125;
    await page.mouse.move(
      fromX + (toX - fromX) * progress,
      fromY + (toY - fromY) * progress,
    );
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await expect.poll(() => writeResults.length, { timeout: 30_000 }).toBe(1);

  await expect
    .poll(() => boardColumnOf(page, 1), { timeout: 15_000 })
    .toBe(await boardColumnOf(page, 51));

  const frameTimes = await page.evaluate(
    () => (window as G11Window).__g11Metrics.dragFrameTimes ?? [],
  );
  if (frameTimes.length < 60)
    throw new Error(
      "The 2.2 second board drag captured too few animation frames: " +
        frameTimes.length,
    );
  const ordered = [...frameTimes].sort((left, right) => left - right);
  const frameP95 = ordered[Math.ceil(ordered.length * 0.95) - 1];

  // The board opens in key order, where manual rank is not offered: the drop is one transition.
  expect(writeRequests).toEqual(["transition"]);
  expect(csrfIssuerRequests).toBeGreaterThan(0);
  expect(csrfIssuerResponses).toBe(csrfIssuerRequests);
  expect(writeResults.map(({ write }) => write)).toEqual(writeRequests);
  expect(writeResults.every(({ status }) => status === 200)).toBe(true);
  expect(writeResults.every(({ csrfHeaderPresent }) => csrfHeaderPresent)).toBe(
    true,
  );
  await page.reload();
  await expect(boardCard(page, 1)).toHaveCount(1, { timeout: 30_000 });
  const persistedTaskColumn = await boardColumnOf(page, 1);
  expect(persistedTaskColumn).toBe("state-brd-progress");
  console.info(
    "G11 board drag persisted canonical-write evidence",
    JSON.stringify({ writes: writeResults, persistedTaskColumn }),
  );
  return frameP95;
}

async function verifyBoardCardMenu(page: Page) {
  await openCanonicalBoard(page);
  const card = page.getByText("Seeded board item 1", { exact: true });
  await card.click({ button: "right" });
  const copyLink = page.getByRole("menuitem", { name: "Copy link" });
  await expect(copyLink).toBeVisible();
  await captureScreen(page, "board-context-menu");
  await page.keyboard.press("Escape");
  await expect(copyLink).toHaveCount(0);

  const keyboardCard = page.locator(
    `[data-task-id="${boardItemId(1)}"][aria-roledescription="sortable"]`,
  );
  await expect(keyboardCard).toHaveCount(1);
  await keyboardCard.focus();
  await expect(keyboardCard).toBeFocused();
  await page.keyboard.press("Shift+F10");
  await expect(copyLink).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(copyLink).toHaveCount(0);

  await keyboardCard.focus();
  await page.keyboard.press("ContextMenu");
  await expect(copyLink).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(copyLink).toHaveCount(0);

  // P0: Delete requests a pending action and opens its approval in place; cancelling the
  // request leaves the card where it was.
  const deletionRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "DELETE" &&
      new URL(request.url()).pathname.startsWith("/api/work-items/")
    )
      deletionRequests.push(new URL(request.url()).pathname);
  });
  const approval = page
    .getByRole("dialog")
    .filter({ hasText: `${BOARD_PROJECT_KEY}-1` });
  await card.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Delete/ }).click();
  await expect(approval).toBeVisible();
  await captureScreen(page, "board-delete-confirmation");
  await approval.getByRole("button", { name: "Cancel request" }).click();
  await expect(approval).toHaveCount(0);
  await expect(boardCard(page, 1)).toHaveCount(1);
  expect(deletionRequests).toEqual([`/api/work-items/${BOARD_PROJECT_KEY}-1`]);

  await keyboardCard.focus();
  await page.keyboard.press("Shift+F10");
  const deleteItem = page.getByRole("menuitem", { name: /^Delete/ });
  await expect(deleteItem).toBeVisible();
  await deleteItem.focus();
  await page.keyboard.press("Enter");
  await expect(approval).toBeVisible();
  await captureScreen(page, "board-delete-keyboard");
  const approvalRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      /\/api\/me\/pending-actions\/[^/]+\/approve$/.test(request.url()),
  );
  await approval.getByRole("button", { name: "Delete", exact: true }).click();
  await approvalRequest;
  expect(deletionRequests).toHaveLength(2);
  await expect(boardCard(page, 1)).toHaveCount(0, { timeout: 15_000 });
}

/**
 * Harness time only (no budget, sample count or retry rule changes): a throttled sample that
 * opens the settled grouped list takes about 15-20 s on a fast machine, so six samples (one
 * retry set) no longer fit the former 120 s.
 */
const SETTLED_LIST_TEST_TIMEOUT_MS = 360_000;

async function threeSamplesWithOneRetry(metric: BudgetMetric) {
  const { result, values, retried } = await medianOfThreeWithRetry(
    metric.sample,
    metric.budget,
  );
  console.log(
    "Performance " +
      metric.name +
      ": median " +
      result.toFixed(1) +
      " (" +
      values.map((value) => value.toFixed(1)).join(", ") +
      "); budget < " +
      metric.budget +
      (retried ? "; one retry set used" : ""),
  );
  expect(
    result,
    `${metric.name} must be strictly below ${metric.budget} (got ${result.toFixed(1)})`,
  ).toBeLessThan(metric.budget);
  return { ...metric, result, values };
}

/**
 * Same median-of-three rule and one retry set, but each set is preceded by the pinned
 * calibration workload and judged normalised to reference speed. While R0 is unpinned this
 * measures and logs the calibration and judges the raw value exactly as before.
 */
async function threeSamplesWithCalibratedRetry(metric: CalibratedBudgetMetric) {
  const { metric: metricId } = metric.calibration;
  const { state, k } = CALIBRATED_METRICS[metricId];
  const calibration = jobCalibrations[state];
  if (!calibration)
    throw new Error(`The G11 ${state} job calibration was not taken.`);
  const { result, retried, sets } = await calibratedMedianOfThreeWithRetry({
    sample: metric.sample,
    budget: metric.budget,
    metric: metricId,
    calibration,
  });
  const format = (values: number[]) =>
    values.map((value) => value.toFixed(1)).join(", ");
  console.log(
    `G11 calibration ${metric.name} [${state}]: mode ${calibration.mode}; job factor ${
      calibration.mode === "calibrated"
        ? calibration.factor.toFixed(3)
        : "1 (not applied)"
    }; k ${k}${
      calibration.mode === "calibrated"
        ? `; applied F^k ${(calibration.factor ** k).toFixed(3)}`
        : ""
    }`,
  );
  sets.forEach((set, index) => {
    console.log(
      "G11 samples " +
        metric.name +
        " set " +
        (index + 1) +
        ": raw (" +
        format(set.raw) +
        "); raw median " +
        set.rawMedian.toFixed(1) +
        "; normalised (" +
        format(set.normalised) +
        "); normalised median " +
        set.result.toFixed(1),
    );
  });
  console.log(
    "Performance " +
      metric.name +
      ": median " +
      result.toFixed(1) +
      " (" +
      format(sets[sets.length - 1].normalised) +
      "); budget < " +
      metric.budget +
      (retried ? "; one retry set used" : ""),
  );
  expect(
    result,
    `${metric.name} must be strictly below ${metric.budget} (got ${result.toFixed(1)})`,
  ).toBeLessThan(metric.budget);
  return { ...metric, result, sets };
}

async function threeSamplesWithInclusiveRetry(metric: BudgetMetric) {
  const sampleSet = async () => {
    const values = [];
    for (let index = 0; index < 3; index += 1)
      values.push(await metric.sample());
    return values;
  };
  let values = await sampleSet();
  let result = median(values);
  let retried = false;
  if (result > metric.budget) {
    values = await sampleSet();
    result = median(values);
    retried = true;
  }
  console.log(
    "Performance " +
      metric.name +
      ": median " +
      result.toFixed(4) +
      " (" +
      values.map((value) => value.toFixed(4)).join(", ") +
      "); budget ≤ " +
      metric.budget +
      (retried ? "; one retry set used" : ""),
  );
  expect(
    result,
    `${metric.name} must be at most ${metric.budget} (got ${result.toFixed(4)})`,
  ).toBeLessThanOrEqual(metric.budget);
  return { ...metric, result, values };
}

test("G11: work-list render, 500 rows", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithCalibratedRetry({
    name: "work-list render, 500 rows (ms; unthrottled)",
    budget: 500,
    sample: () =>
      withPerformancePage(browser, false, (page) => collectListRender(page)),
    calibration: { metric: "list" },
  });
});

test("G11: work-list LCP", async ({ browser }) => {
  test.setTimeout(SETTLED_LIST_TEST_TIMEOUT_MS);
  await threeSamplesWithCalibratedRetry({
    name: "work-list LCP (ms)",
    budget: 2500,
    sample: async () => {
      const report: { domContentLoaded?: number } = {};
      const value = await withPerformancePage(browser, true, (page) =>
        collectNavigationMetric(page, "lcp", report),
      );
      return { value, floorMs: report.domContentLoaded };
    },
    calibration: { metric: "lcp" },
  });
});

test("G11: work-list CLS", async ({ browser }) => {
  test.setTimeout(SETTLED_LIST_TEST_TIMEOUT_MS);
  await threeSamplesWithOneRetry({
    name: "work-list CLS",
    budget: 0.1,
    sample: () =>
      withPerformancePage(browser, true, (page) =>
        collectNavigationMetric(page, "cls"),
      ),
  });
});

test("G11: work-list to detail route first paint", async ({ browser }) => {
  test.setTimeout(SETTLED_LIST_TEST_TIMEOUT_MS);
  await threeSamplesWithCalibratedRetry({
    name: "work-list to work-item route transition (ms)",
    budget: 300,
    sample: () =>
      withPerformancePage(browser, true, (page) =>
        collectRouteTransition(page),
      ),
    calibration: { metric: "route" },
  });
});

test("G13: detail layout shift from skeleton to content", async ({
  browser,
}) => {
  test.setTimeout(SETTLED_LIST_TEST_TIMEOUT_MS);
  await threeSamplesWithInclusiveRetry({
    name: "detail skeleton-to-content CLS",
    budget: 0.1,
    sample: () =>
      withPerformancePage(
        browser,
        true,
        async (page) => {
          await openWorkList(page);
          await workItemLink(page, WORK_ITEM_KEY).click();
          await expect(page.getByTestId("work-item-detail")).toBeVisible({
            timeout: 15_000,
          });
          return collectG13WindowCls(page, "detail");
        },
        { dataDelayMs: 250, g13Windows: true },
      ),
  });
});

test("G13: work-list layout shift from skeleton to content", async ({
  browser,
}) => {
  test.setTimeout(SETTLED_LIST_TEST_TIMEOUT_MS);
  await threeSamplesWithInclusiveRetry({
    name: "work-list skeleton-to-content CLS",
    budget: 0.1,
    sample: () =>
      withPerformancePage(
        browser,
        true,
        async (page) => {
          await openWorkList(page);
          return collectG13WindowCls(page, "work-list");
        },
        { dataDelayMs: 250, g13Windows: true },
      ),
  });
});

test("G13: board layout shift from skeleton to content", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await threeSamplesWithInclusiveRetry({
    name: "board skeleton-to-content CLS",
    budget: 0.1,
    sample: () =>
      withPerformancePage(
        browser,
        false,
        async (page) => {
          await openCanonicalBoard(page);
          return collectG13WindowCls(page, "board");
        },
        { ...BOARD_FIXTURE, dataDelayMs: 250, g13Windows: true },
      ),
  });
});

test("G13: legacy task layout shift from skeleton to content", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await threeSamplesWithInclusiveRetry({
    name: "legacy-task skeleton-to-content CLS",
    budget: 0.1,
    sample: () =>
      withPerformancePage(
        browser,
        true,
        async (page) => {
          // An old legacy task link: its skeleton, the redirect, then the canonical detail.
          await page.goto(
            `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/task/legacy-task-1`,
          );
          await expect(page).toHaveURL(
            new RegExp(`/agent/work-items/${WORK_ITEM_KEY}$`),
            { timeout: 30_000 },
          );
          await expect(page.getByTestId("work-item-detail")).toBeVisible({
            timeout: 15_000,
          });
          return collectG13WindowCls(page, "legacy-task");
        },
        { dataDelayMs: 250, g13Windows: true },
      ),
  });
});

test("G13: Projects layout shift from skeleton to content", async ({
  browser,
}) => {
  test.setTimeout(SETTLED_LIST_TEST_TIMEOUT_MS);
  await threeSamplesWithInclusiveRetry({
    name: "Projects skeleton-to-content CLS",
    budget: 0.1,
    sample: () =>
      withPerformancePage(
        browser,
        true,
        async (page) => {
          await collectCommandPaletteInteraction(page, "navigate");
          return collectG13WindowCls(page, "projects");
        },
        { dataDelayMs: 250, g13Windows: true },
      ),
  });
});

test("G13: sign-in layout shift from skeleton to content", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await threeSamplesWithInclusiveRetry({
    name: "sign-in skeleton-to-content CLS",
    budget: 0.1,
    sample: () =>
      withPerformancePage(
        browser,
        true,
        async (page) => {
          await page.goto("/auth/sign-in");
          await expect(
            page.locator('form button[type="submit"]'),
          ).toBeVisible();
          return collectG13WindowCls(page, "sign-in");
        },
        { authenticated: false, dataDelayMs: 250, g13Windows: true },
      ),
  });
});

test("G13 observer detects a click-initiated skeleton-to-content shift", async ({
  browser,
}) => {
  await withPerformancePage(
    browser,
    false,
    async (page) => {
      await page.goto("/");
      await page.evaluate(() => {
        document.body.innerHTML = `
        <button type="button" data-testid="g13-probe-action">Load content</button>
        <div data-testid="g13-red-probe-loading" style="height:40px">Loading</div>
        <main style="height:700px">
          <p>Visible content below the skeleton</p>
        </main>
      `;
      });
      await page.waitForFunction(
        () =>
          (window as G11Window).__g11Metrics.g13["red-probe"].skeletonMark > 0,
      );
      await page.getByTestId("g13-probe-action").click();
      await page.evaluate(() => {
        const skeleton = document.querySelector(
          '[data-testid="g13-red-probe-loading"]',
        );
        const content = document.createElement("div");
        content.dataset.testid = "g13-red-probe-content";
        content.style.height = "800px";
        content.textContent = "Loaded content";
        skeleton?.replaceWith(content);
      });

      const measurement = await collectG13WindowMeasurement(page, "red-probe");
      expect(measurement.contentMark).toBeGreaterThan(measurement.skeletonMark);
      expect(measurement.cls).toBeGreaterThan(0.1);
      expect(measurement.inputShiftCount).toBeGreaterThan(0);
    },
    { g13Windows: true },
  );
});

test("G11: create-work-item click-to-paint", async ({ browser }) => {
  test.setTimeout(SETTLED_LIST_TEST_TIMEOUT_MS);
  await threeSamplesWithCalibratedRetry({
    name: "create-work-item interaction click-to-paint (ms)",
    budget: 200,
    sample: () =>
      withPerformancePage(browser, true, (page, resetFixture) =>
        collectCreateInteraction(page, resetFixture),
      ),
    calibration: { metric: "create" },
  });
});

test("G11: sign-in click-to-paint", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "sign-in interaction click-to-paint (ms)",
    budget: 200,
    sample: () =>
      withPerformancePage(
        browser,
        true,
        (page) => collectSignInInteraction(page),
        { authenticated: false },
      ),
  });
});

test("G11: command-palette click-to-paint", async ({ browser }) => {
  test.setTimeout(SETTLED_LIST_TEST_TIMEOUT_MS);
  await threeSamplesWithCalibratedRetry({
    name: "command-palette interaction click-to-paint (ms)",
    budget: 200,
    sample: () =>
      withPerformancePage(browser, true, (page) =>
        collectCommandPaletteInteraction(page),
      ),
    calibration: { metric: "palette" },
  });
});

test("G11: command-palette keyboard navigation click-to-paint", async ({
  browser,
}) => {
  test.setTimeout(SETTLED_LIST_TEST_TIMEOUT_MS);
  await threeSamplesWithCalibratedRetry({
    name: "command-palette keyboard navigation click-to-paint (ms)",
    budget: 200,
    sample: () =>
      withPerformancePage(browser, true, (page) =>
        collectCommandPaletteInteraction(page, "navigate"),
      ),
    calibration: { metric: "paletteNav" },
  });
});

test("G11: change task state click-to-paint", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithCalibratedRetry({
    name: "task-state interaction click-to-paint (ms)",
    budget: 200,
    sample: () =>
      withPerformancePage(
        browser,
        true,
        (page) => collectTaskStateChange(page),
        { workflowCapabilities: true },
      ),
    calibration: { metric: "taskState" },
  });
});

test("G11: assign task click-to-paint", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithCalibratedRetry({
    name: "task-assignment interaction click-to-paint (ms)",
    budget: 200,
    sample: () =>
      withPerformancePage(browser, true, (page) => collectTaskAssignment(page)),
    calibration: { metric: "taskAssign" },
  });
});

test("G11: comment click-to-paint", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "task-comment interaction click-to-paint (ms)",
    budget: 200,
    sample: () =>
      withPerformancePage(browser, true, (page) => collectTaskComment(page)),
  });
});

test("G11: board render, 200 tasks", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithCalibratedRetry({
    name: "board render, 200 tasks (ms; unthrottled)",
    budget: 500,
    sample: () =>
      withPerformancePage(
        browser,
        false,
        (page) => collectBoardRender(page),
        BOARD_FIXTURE,
      ),
    calibration: { metric: "board" },
  });
});

test("G11: board drag p95 frame time", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "board drag p95 frame time (ms; unthrottled)",
    budget: 20,
    sample: () =>
      withPerformancePage(
        browser,
        false,
        (page) => collectBoardDragFrameP95(page),
        BOARD_FIXTURE,
      ),
  });
});

test("G11: board context menu supports keyboard and delete cancel", async ({
  browser,
}) => {
  await withPerformancePage(
    browser,
    false,
    (page) => verifyBoardCardMenu(page),
    BOARD_FIXTURE,
  );
});

test("G11: 500-row list remains reachable at 200% zoom", async ({
  browser,
}) => {
  await withPerformancePage(browser, false, async (page) => {
    await page.addInitScript(() => {
      document.documentElement.style.zoom = "2";
    });
    // The grouped list counts all 500 items and windows its rows, so the last row is
    // reached by scrolling the list, as a reader would.
    await openWorkList(page);
    const lastRow = page.locator(
      'div[data-testid=work-item-list-populated] [data-task-id="work-item-500"]',
    );
    const firstRow = page
      .locator("div[data-testid=work-item-list-populated] [data-task-id]")
      .first();
    const listBox = await firstRow.boundingBox();
    if (!listBox) throw new Error("The 200%-zoom work list has no layout box.");
    await page.mouse.move(
      listBox.x + listBox.width / 2,
      Math.min(listBox.y + listBox.height / 2, 700),
    );
    for (let step = 0; step < 400 && (await lastRow.count()) === 0; step += 1)
      await page.mouse.wheel(0, 1200);
    await expect(lastRow).toHaveCount(1);
    await lastRow.scrollIntoViewIfNeeded();
    await waitForTwoFrames(page);
    const firstBox = await lastRow.boundingBox();
    await waitForTwoFrames(page);
    const stableBox = await lastRow.boundingBox();
    if (!firstBox || !stableBox)
      throw new Error("The last 200%-zoom work-item row has no layout box.");
    expect(stableBox.y).toBeGreaterThanOrEqual(0);
    expect(stableBox.y + stableBox.height).toBeLessThanOrEqual(720);
    expect(Math.abs(stableBox.y - firstBox.y)).toBeLessThan(1);
    await captureScreen(page, "work-list-200-percent-zoom-last-row");
  });
});
