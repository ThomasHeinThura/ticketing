import { mkdir } from "node:fs/promises";
import { type Browser, expect, type Page, test } from "@playwright/test";
import {
  median,
  medianOfThreeWithRetry,
} from "../../../scripts/ci/lib/performance-budget.mjs";
import {
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

async function withPerformancePage(
  browser: Browser,
  throttled: boolean,
  sample: (page: Page, resetFixture: () => void) => Promise<number>,
  fixtureOptions?: {
    authenticated?: boolean;
    dataDelayMs?: number;
    g13Windows?: boolean;
  },
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

async function openWorkList(page: Page) {
  await page.goto(WORK_LIST_PATH);
  const rows = page.locator("[data-testid=work-item-list-populated] tbody tr");
  try {
    await expect(rows).toHaveCount(500, { timeout: 30_000 });
  } catch (error) {
    const [rowCount, tableCount, testIdCount, bodyText] = await Promise.all([
      rows.count(),
      page.getByRole("table").count(),
      page.getByTestId("work-item-list-populated").count(),
      page.locator("body").innerText(),
    ]);
    console.error(
      "G11 list fixture did not render 500 rows:",
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

async function collectNavigationMetric(page: Page, name: "lcp" | "cls") {
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
  await page.getByLabel("Type").click();
  await page.getByRole("option", { name: "Task" }).click();
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
  await expect(
    page.getByRole("link", { name: "G11 interaction sample" }),
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
  await expect(page).toHaveURL(/\/dashboard(?:\/|$)/, { timeout: 15_000 });
  return clickToPaint;
}

async function collectCommandPaletteInteraction(
  page: Page,
  metric: "open" | "navigate" = "open",
) {
  await openWorkList(page);
  const palettePopup = page.locator('[data-slot="command-dialog-popup"]');
  await expect(palettePopup).toHaveCount(1);
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

async function openLegacyTaskDetails(page: Page) {
  await page.goto(
    `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/task/legacy-task-1`,
  );
  await expect(
    page.getByRole("button", { name: "Backlog", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
}

async function collectTaskStateChange(page: Page) {
  await openLegacyTaskDetails(page);
  await captureScreen(page, "legacy-task-state");
  await page.getByRole("button", { name: "Backlog", exact: true }).click();
  await page
    .getByRole("button", { name: /^In progress/ })
    .last()
    .click();
  await page.waitForFunction(
    () => (window as G11Window).__g11Metrics.statePaint > 0,
    undefined,
    { timeout: 15_000 },
  );
  const elapsed = await page.evaluate(
    () => (window as G11Window).__g11Metrics.statePaint,
  );
  await expect(
    page.locator('[data-slot="popover-trigger"]:visible').filter({
      hasText: "In progress",
    }),
  ).toBeVisible();
  return elapsed;
}

async function collectTaskAssignment(page: Page) {
  await openLegacyTaskDetails(page);
  await captureScreen(page, "legacy-task-assignment");
  await page
    .getByRole("button", { name: /Unassigned/ })
    .last()
    .click();
  await page
    .getByRole("button", { name: /G11 Agent/ })
    .last()
    .click();
  await page.waitForFunction(
    () => (window as G11Window).__g11Metrics.assignmentPaint > 0,
    undefined,
    { timeout: 15_000 },
  );
  const elapsed = await page.evaluate(
    () => (window as G11Window).__g11Metrics.assignmentPaint,
  );
  await expect(
    page.locator('[data-slot="popover-trigger"]:visible').filter({
      hasText: "G11 Agent",
    }),
  ).toBeVisible();
  return elapsed;
}

async function collectTaskComment(page: Page) {
  await openLegacyTaskDetails(page);
  await captureScreen(page, "legacy-task-comment");
  const editor = page
    .locator(".taskdesk-comment-editor-content [contenteditable=true]")
    .first();
  await editor.fill("G11 comment fixture");
  const submit = page.getByTestId("comment-submit");
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
  await expect(page.getByText("G11 comment fixture")).toBeVisible({
    timeout: 15_000,
  });
  return elapsed;
}

async function collectRouteTransition(page: Page) {
  await openWorkList(page);
  await page.getByRole("link", { name: WORK_ITEM_KEY, exact: true }).click();
  await expect(
    page.locator(
      '[data-testid="work-item-detail-loading"], [data-testid="work-item-detail"]',
    ),
  ).toBeVisible({ timeout: 15_000 });
  try {
    await page.waitForFunction(
      () => (window as G11Window).__g11Metrics.routePaint > 0,
      undefined,
      { timeout: 15_000 },
    );
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      metrics: (window as G11Window).__g11Metrics,
      url: location.href,
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

async function collectListRender(page: Page) {
  const rowSelector = "[data-testid=work-item-list-populated] tbody tr";
  await installLastItemPaintRecorder(page, {
    kind: "list",
    expectedCount: 500,
    metric: "listPaint",
  });
  await page.goto(WORK_LIST_PATH);
  await expect(page.locator(rowSelector)).toHaveCount(500, {
    timeout: 30_000,
  });
  try {
    await page.waitForFunction(
      () => (window as G11Window).__g11Metrics.listPaint > 0,
      undefined,
      { timeout: 10_000 },
    );
  } catch (error) {
    console.error(
      "G11 list paint recorder diagnostics",
      JSON.stringify(
        await page.evaluate(() => ({
          metrics: (window as G11Window).__g11Metrics,
          recorder: (window as Window & { __g11PaintDebug?: unknown })
            .__g11PaintDebug,
          rows: document.querySelectorAll(
            "[data-testid=work-item-list-populated] tbody tr",
          ).length,
        })),
      ),
    );
    throw error;
  }
  await captureScreen(page, "work-list");
  return page.evaluate(
    () =>
      (window as G11Window).__g11Metrics.listPaint -
      (window as G11Window).__g11Metrics.documentStart,
  );
}

async function openLegacyBoard(page: Page) {
  await page.goto(
    "/dashboard/workspace/" +
      WORKSPACE_ID +
      "/project/" +
      PROJECT_ID +
      "/board",
  );
  await expect(
    page.getByText("Seeded legacy task 200", { exact: true }),
  ).toHaveCount(1, { timeout: 30_000 });
}

async function collectBoardRender(page: Page) {
  await installLastItemPaintRecorder(page, {
    kind: "board",
    expectedCount: 200,
    metric: "boardPaint",
  });
  await page.goto(
    "/dashboard/workspace/" +
      WORKSPACE_ID +
      "/project/" +
      PROJECT_ID +
      "/board",
  );
  await expect(
    page.getByText("Seeded legacy task 200", { exact: true }),
  ).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator('[data-task-id^="legacy-task-"]')).toHaveCount(
    200,
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
  await openLegacyBoard(page);
  await page.waitForTimeout(400);

  let versionedWriteRequests = 0;
  let csrfIssuerRequests = 0;
  let csrfIssuerResponses = 0;
  const versionedWriteResults: Array<{
    taskId: string;
    ifMatch: string | undefined;
    csrfHeaderPresent: boolean;
    status: number;
  }> = [];
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      new URL(request.url()).pathname === "/api/me/csrf-token"
    ) {
      csrfIssuerRequests += 1;
    }
    if (
      request.method() === "PUT" &&
      new URL(request.url()).pathname.match(/^\/api\/v2\/task\/[^/]+$/)
    ) {
      versionedWriteRequests += 1;
    }
  });
  page.on("response", (response) => {
    const request = response.request();
    if (
      request.method() === "GET" &&
      new URL(response.url()).pathname === "/api/me/csrf-token" &&
      response.status() === 200
    ) {
      csrfIssuerResponses += 1;
    }
    if (
      request.method() === "PUT" &&
      new URL(response.url()).pathname.match(/^\/api\/v2\/task\/[^/]+$/)
    ) {
      const path = new URL(response.url()).pathname;
      versionedWriteResults.push({
        taskId: decodeURIComponent(path.slice("/api/v2/task/".length)),
        ifMatch: request.headers()["if-match"],
        csrfHeaderPresent: Boolean(request.headers()["x-taskdesk-csrf"]),
        status: response.status(),
      });
    }
  });

  const source = await page
    .getByText("Seeded legacy task 1", { exact: true })
    .boundingBox();
  const destination = await page
    .getByText("Seeded legacy task 51", { exact: true })
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
  await expect
    .poll(() => versionedWriteResults.length, { timeout: 30_000 })
    .toBe(100);

  const movedCardColumn = await page
    .locator('[data-task-id="legacy-task-1"]')
    .locator("xpath=ancestor::*[@data-column-id]")
    .getAttribute("data-column-id");
  const destinationCardColumn = await page
    .locator('[data-task-id="legacy-task-51"]')
    .locator("xpath=ancestor::*[@data-column-id]")
    .getAttribute("data-column-id");
  expect(movedCardColumn).toBe(destinationCardColumn);

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

  expect(versionedWriteRequests).toBe(100);
  expect(csrfIssuerRequests).toBeGreaterThan(0);
  expect(csrfIssuerResponses).toBe(csrfIssuerRequests);
  expect(versionedWriteResults).toHaveLength(versionedWriteRequests);
  expect(versionedWriteResults.every(({ status }) => status === 200)).toBe(
    true,
  );
  expect(
    versionedWriteResults.every(({ csrfHeaderPresent }) => csrfHeaderPresent),
  ).toBe(true);
  await page.reload();
  await expect(
    page.getByText("Seeded legacy task 1", { exact: true }),
  ).toHaveCount(1);
  const persistedTaskColumn = await page
    .locator('[data-task-id="legacy-task-1"]')
    .locator("xpath=ancestor::*[@data-column-id]")
    .getAttribute("data-column-id");
  expect(persistedTaskColumn).toBe("in-progress");
  console.info(
    "G11 board drag persisted versioned-write evidence",
    JSON.stringify({
      writes: versionedWriteResults,
      persistedTaskColumn,
    }),
  );
  return frameP95;
}

async function verifyBoardCardMenu(page: Page) {
  await openLegacyBoard(page);
  const card = page.getByText("Seeded legacy task 1", { exact: true });
  await card.click({ button: "right" });
  const copyLink = page.getByRole("menuitem", { name: "Copy link" });
  await expect(copyLink).toBeVisible();
  await captureScreen(page, "board-context-menu");
  await page.keyboard.press("Escape");
  await expect(copyLink).toHaveCount(0);

  const keyboardCard = page.locator(
    '[data-task-id="legacy-task-1"] > [role="button"]',
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

  await card.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete..." }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toBeVisible();
  await captureScreen(page, "board-delete-confirmation");
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(confirmation).toHaveCount(0);

  await keyboardCard.focus();
  await page.keyboard.press("Shift+F10");
  const deleteItem = page.getByRole("menuitem", { name: "Delete..." });
  await expect(deleteItem).toBeVisible();
  await deleteItem.focus();
  await page.keyboard.press("Enter");
  const deleteConfirmation = page.getByRole("alertdialog");
  await expect(deleteConfirmation).toBeVisible();
  await captureScreen(page, "board-delete-keyboard");
  const deleteButton = deleteConfirmation.getByRole("button", {
    name: "Delete Task",
    exact: true,
  });
  const deletionRequest = page.waitForRequest(
    (request) =>
      request.method() === "DELETE" &&
      request.url().endsWith("/api/task/legacy-task-1"),
  );
  await deleteButton.click();
  await deletionRequest;
  await expect(page.locator('[data-task-id="legacy-task-1"]')).toHaveCount(0);
}

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
  await threeSamplesWithOneRetry({
    name: "work-list render, 500 rows (ms; unthrottled)",
    budget: 500,
    sample: () =>
      withPerformancePage(browser, false, (page) => collectListRender(page)),
  });
});

test("G11: work-list LCP", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "work-list LCP (ms)",
    budget: 2500,
    sample: () =>
      withPerformancePage(browser, true, (page) =>
        collectNavigationMetric(page, "lcp"),
      ),
  });
});

test("G11: work-list CLS", async ({ browser }) => {
  test.setTimeout(120_000);
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
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "work-list to work-item route transition (ms)",
    budget: 300,
    sample: () =>
      withPerformancePage(browser, true, (page) =>
        collectRouteTransition(page),
      ),
  });
});

test("G13: detail layout shift from skeleton to content", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await threeSamplesWithInclusiveRetry({
    name: "detail skeleton-to-content CLS",
    budget: 0.1,
    sample: () =>
      withPerformancePage(
        browser,
        true,
        async (page) => {
          await openWorkList(page);
          await page
            .getByRole("link", { name: WORK_ITEM_KEY, exact: true })
            .click();
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
  test.setTimeout(120_000);
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
          await openLegacyBoard(page);
          return collectG13WindowCls(page, "board");
        },
        { dataDelayMs: 250, g13Windows: true },
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
          await openLegacyTaskDetails(page);
          return collectG13WindowCls(page, "legacy-task");
        },
        { dataDelayMs: 250, g13Windows: true },
      ),
  });
});

test("G13: Projects layout shift from skeleton to content", async ({
  browser,
}) => {
  test.setTimeout(120_000);
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
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "create-work-item interaction click-to-paint (ms)",
    budget: 200,
    sample: () =>
      withPerformancePage(browser, true, (page, resetFixture) =>
        collectCreateInteraction(page, resetFixture),
      ),
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
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "command-palette interaction click-to-paint (ms)",
    budget: 200,
    sample: () =>
      withPerformancePage(browser, true, (page) =>
        collectCommandPaletteInteraction(page),
      ),
  });
});

test("G11: command-palette keyboard navigation click-to-paint", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "command-palette keyboard navigation click-to-paint (ms)",
    budget: 200,
    sample: () =>
      withPerformancePage(browser, true, (page) =>
        collectCommandPaletteInteraction(page, "navigate"),
      ),
  });
});

test("G11: change task state click-to-paint", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "task-state interaction click-to-paint (ms)",
    budget: 200,
    sample: () =>
      withPerformancePage(browser, true, (page) =>
        collectTaskStateChange(page),
      ),
  });
});

test("G11: assign task click-to-paint", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "task-assignment interaction click-to-paint (ms)",
    budget: 200,
    sample: () =>
      withPerformancePage(browser, true, (page) => collectTaskAssignment(page)),
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
  await threeSamplesWithOneRetry({
    name: "board render, 200 tasks (ms; unthrottled)",
    budget: 500,
    sample: () =>
      withPerformancePage(browser, false, (page) => collectBoardRender(page)),
  });
});

test("G11: board drag p95 frame time", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "board drag p95 frame time (ms; unthrottled)",
    budget: 20,
    sample: () =>
      withPerformancePage(browser, false, (page) =>
        collectBoardDragFrameP95(page),
      ),
  });
});

test("G11: board context menu supports keyboard and delete cancel", async ({
  browser,
}) => {
  await withPerformancePage(browser, false, (page) =>
    verifyBoardCardMenu(page),
  );
});

test("G11: 500-row list remains reachable at 200% zoom", async ({
  browser,
}) => {
  await withPerformancePage(browser, false, async (page) => {
    await page.addInitScript(() => {
      document.documentElement.style.zoom = "2";
    });
    await openWorkList(page);
    const rows = page.locator(
      "[data-testid=work-item-list-populated] tbody tr",
    );
    await expect(rows).toHaveCount(500);

    const lastRow = rows.last();
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
