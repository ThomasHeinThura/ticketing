import { mkdir } from "node:fs/promises";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { medianOfThreeWithRetry } from "../../../scripts/ci/lib/performance-budget.mjs";

type BrowserMetrics = {
  lcp: number;
  cls: number;
  interactionStart: number;
  interactionPaint: number;
  routeStart: number;
  routePaint: number;
  documentStart: number;
  lcpElement: string;
  lcpText: string;
  lcpUrl: string;
  dragFrameTimes?: number[];
};

type G11Window = Window & { __g11Metrics: BrowserMetrics };

type BudgetMetric = {
  name: string;
  budget: number;
  sample: () => Promise<number>;
};

const WORK_LIST_PATH = "/agent/projects/WLP/work?layout=list";
const PERFORMANCE_BASE_URL = "http://127.0.0.1:4178";
const WORK_ITEM_KEY = "WLP-1";
const WORKSPACE_ID = "ws-g11";
const PROJECT_ID = "project-g11";
const TYPE_ID = "type-g11";
const SCREENSHOT_DIR = "test-results/g11-screens";

async function captureScreen(page: Page, name: string) {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` });
}

const SESSION = {
  session: {
    id: "session-g11",
    userId: "user-g11",
    token: "g11",
    expiresAt: "2026-10-01T00:00:00.000Z",
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    activeOrganizationId: WORKSPACE_ID,
  },
  user: {
    id: "user-g11",
    name: "G11 Agent",
    email: "g11@example.test",
    emailVerified: true,
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
  },
};

const PROJECT = {
  id: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  slug: "WLP",
  name: "Performance fixture",
  description: null,
  icon: null,
  defaultCommentVisibility: "internal",
  createdAt: "2026-09-30T00:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  purgeAfter: null,
  position: 1,
  lastTaskNumber: 500,
  statistics: {
    completionPercentage: 0,
    totalTasks: 500,
    dueDate: null,
  },
  archivedTasks: [],
  plannedTasks: [],
  columns: [],
};

function makeWorkItem(number: number) {
  return {
    id: `work-item-${number}`,
    projectId: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    typeId: TYPE_ID,
    number,
    key: `WLP-${number}`,
    title: `Seeded work item ${number}`,
    description: null,
    stateId: "state-g11",
    stateName: "Backlog",
    stateCategory: "backlog",
    priority: number % 4 === 0 ? null : "medium",
    assigneeId: null,
    assigneeName: null,
    requesterId: null,
    parentId: null,
    position: number.toFixed(10),
    customerVisibility: "private",
    startDate: null,
    dueDate: null,
    archivedAt: null,
    deletedAt: null,
    version: 1,
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
  };
}

function makeDetailItem() {
  return {
    ...makeWorkItem(1),
    title: "Seeded work item 1",
  };
}

function makeBoardProject() {
  const columns = [
    { id: "backlog", name: "Backlog", slug: "backlog", isFinal: false },
    {
      id: "in-progress",
      name: "In progress",
      slug: "in-progress",
      isFinal: false,
    },
    { id: "review", name: "Review", slug: "review", isFinal: false },
    { id: "done", name: "Done", slug: "done", isFinal: true },
  ].map((column, columnIndex) => ({
    ...column,
    icon: null,
    color: null,
    position: columnIndex,
    tasks: Array.from({ length: 50 }, (_, index) => {
      const number = columnIndex * 50 + index + 1;
      return {
        id: `legacy-task-${number}`,
        title: `Seeded legacy task ${number}`,
        number,
        description: null,
        status: column.slug,
        priority: null,
        startDate: null,
        dueDate: null,
        position: index,
        createdAt: "2026-09-30T00:00:00.000Z",
        updatedAt: "2026-09-30T00:00:00.000Z",
        userId: null,
        assigneeId: null,
        assigneeName: null,
        projectId: PROJECT_ID,
        columnId: column.id,
        labels: [],
        externalLinks: [],
      };
    }),
  }));

  return {
    id: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    slug: "WLP",
    name: "Performance fixture",
    icon: null,
    description: "",
    columns,
    archivedTasks: [],
    plannedTasks: [],
  };
}

const SEEDED_ITEMS = Array.from({ length: 500 }, (_, index) =>
  makeWorkItem(index + 1),
);

async function installPerformanceApiFixture(page: Page) {
  let createdItem: ReturnType<typeof makeWorkItem> | undefined;

  await page.routeWebSocket(/\/api\/ws\/project-g11(?:\?|$)/, (socket) => {
    socket.onMessage((message) => {
      if (typeof message === "string" && message.includes('"type":"ping"'))
        socket.send(JSON.stringify({ type: "pong" }));
    });
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/\/+$/, "");
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: {
          "Access-Control-Allow-Origin": "http://127.0.0.1:4178",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Headers":
            "Content-Type, X-TaskDesk-Window-Id, If-Match",
          "Access-Control-Allow-Methods":
            "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        },
        body: JSON.stringify(body),
      });

    if (request.method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "http://127.0.0.1:4178",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Headers":
            "Content-Type, X-TaskDesk-Window-Id, If-Match",
          "Access-Control-Allow-Methods":
            "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        },
      });

    if (path.endsWith("/auth/get-session")) return json(SESSION);
    if (path === "/api/config")
      return json({
        disableRegistration: false,
        disablePasswordRegistration: false,
        disableEmailOtpSignIn: true,
        disableWorkspaceCreation: false,
        hasSmtp: false,
        hasGithubSignIn: false,
        hasGoogleSignIn: false,
        hasDiscordSignIn: false,
        hasCustomOAuth: false,
        disableLoginForm: false,
        customOAuthAutoLogin: false,
        customOAuthLogoutUrl: null,
      });
    if (path === "/api/workspace" && request.method() === "GET")
      return json([
        {
          id: WORKSPACE_ID,
          name: "Performance workspace",
          slug: "performance",
          logo: null,
          description: null,
          createdAt: "2026-09-30T00:00:00.000Z",
        },
      ]);
    if (path === "/api/project" && request.method() === "GET")
      return json([PROJECT]);
    if (path === `/api/project/${PROJECT_ID}` && request.method() === "GET")
      return json(PROJECT);
    if (path === "/api/capabilities")
      return json({
        manageProjects: false,
        manageProjectSettings: false,
        createProjects: false,
        updateProjects: false,
        deleteProjects: false,
        updateTasks: true,
        createTasks: true,
        deleteTasks: true,
        assignTasks: true,
        createLabels: false,
        updateLabels: false,
        deleteLabels: false,
        manageWorkspace: false,
        deleteWorkspace: false,
        inviteUsers: false,
        manageTeam: false,
        removeMembers: false,
        createPublicComments: true,
        createInternalComments: true,
      });
    if (path === `/api/workspace/${WORKSPACE_ID}/work-item-types`)
      return json([{ id: TYPE_ID, key: "task", name: "Task" }]);
    if (
      path === `/api/workspace/${WORKSPACE_ID}/members` &&
      request.method() === "GET"
    )
      return json([
        {
          id: SESSION.user.id,
          name: SESSION.user.name,
          email: SESSION.user.email,
          image: null,
          role: "owner",
        },
      ]);
    if (
      path === `/api/label/workspace/${WORKSPACE_ID}` &&
      request.method() === "GET"
    )
      return json([]);
    if (path === `/api/task/tasks/${PROJECT_ID}` && request.method() === "GET")
      return json({
        data: makeBoardProject(),
        pagination: {
          total: 200,
          page: 1,
          pageSize: 200,
          totalPages: 1,
        },
      });
    if (path.startsWith("/api/task/") && request.method() === "PUT")
      return json({ id: path.split("/").at(-1), ...request.postDataJSON() });
    if (
      path === `/api/projects/${PROJECT_ID}/work-items` &&
      request.method() === "GET"
    )
      return json({
        data: createdItem ? [...SEEDED_ITEMS, createdItem] : SEEDED_ITEMS,
        page: { hasMore: false, nextCursor: null },
        meta: {},
      });
    if (
      path === `/api/projects/${PROJECT_ID}/work-items` &&
      request.method() === "POST"
    ) {
      // Keep the mocked mutation pending long enough for the browser to paint the
      // genuine busy state before the response resolves under a zero-latency route stub.
      await new Promise((resolve) => setTimeout(resolve, 250));
      createdItem = {
        ...makeWorkItem(501),
        title: String(request.postDataJSON().title),
      };
      return json(createdItem);
    }
    if (
      path === `/api/work-items/${WORK_ITEM_KEY}` &&
      request.method() === "GET"
    )
      return json(makeDetailItem());

    return json({ message: "Not found in the G11 browser fixture" }, 404);
  });

  await page.addInitScript(() => {
    const metrics: BrowserMetrics = {
      lcp: 0,
      cls: 0,
      interactionStart: 0,
      interactionPaint: 0,
      routeStart: 0,
      routePaint: 0,
      documentStart: performance.now(),
      lcpElement: "",
      lcpText: "",
      lcpUrl: "",
    };
    Object.defineProperty(window, "__g11Metrics", {
      value: metrics,
      configurable: true,
    });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const lcp = entry as PerformanceEntry & {
          element?: Element | null;
          url?: string;
        };
        metrics.lcp = lcp.startTime;
        metrics.lcpElement = lcp.element
          ? `${lcp.element.tagName.toLowerCase()}${lcp.element.id ? `#${lcp.element.id}` : ""}${lcp.element.classList.length ? `.${Array.from(lcp.element.classList).slice(0, 3).join(".")}` : ""}`
          : "(no element)";
        metrics.lcpText = lcp.element?.textContent?.trim().slice(0, 160) ?? "";
        metrics.lcpUrl = lcp.url ?? "";
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (
          !(entry as PerformanceEntry & { hadRecentInput?: boolean })
            .hadRecentInput
        )
          metrics.cls += (entry as PerformanceEntry & { value: number }).value;
      }
    }).observe({ type: "layout-shift", buffered: true });

    const responseIsVisible = (kind: "interaction" | "route") => {
      if (kind === "interaction") {
        return (
          (document.querySelector(
            '[data-testid="create-work-item-submit"][aria-busy="true"]',
          ) as HTMLButtonElement | null) !== null
        );
      }
      return (
        document.querySelector(
          '[data-testid="work-item-detail-loading"], [data-testid="work-item-detail"]',
        ) !== null
      );
    };
    const paintPending = { interaction: false, route: false };
    const recordAfterPaint = (kind: "interaction" | "route") => {
      const start =
        kind === "interaction" ? metrics.interactionStart : metrics.routeStart;
      const paint =
        kind === "interaction" ? metrics.interactionPaint : metrics.routePaint;
      if (
        start <= 0 ||
        paint > 0 ||
        paintPending[kind] ||
        !responseIsVisible(kind)
      )
        return;
      paintPending[kind] = true;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!responseIsVisible(kind)) {
            paintPending[kind] = false;
            return;
          }
          const elapsed = performance.now() - start;
          if (kind === "interaction") metrics.interactionPaint = elapsed;
          else metrics.routePaint = elapsed;
        }),
      );
    };
    const watchForPaint = (kind: "interaction" | "route") => {
      const poll = () => {
        const paint =
          kind === "interaction"
            ? metrics.interactionPaint
            : metrics.routePaint;
        if (paint > 0) return;
        recordAfterPaint(kind);
        requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    };
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target as Element | null;
        const button = target?.closest("button");
        const label = button?.textContent?.trim();
        if (label === "Create") {
          metrics.interactionStart = performance.now();
          watchForPaint("interaction");
        }
        if (
          target
            ?.closest("a[href]")
            ?.getAttribute("href")
            ?.includes("/agent/work-items/" + "WLP-1")
        ) {
          metrics.routeStart = performance.now();
          watchForPaint("route");
        }
      },
      { capture: true },
    );
  });

  return () => {
    createdItem = undefined;
  };
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
) {
  const context = await browser.newContext({
    baseURL: PERFORMANCE_BASE_URL,
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  const resetFixture = await installPerformanceApiFixture(page);
  let session:
    | Awaited<ReturnType<typeof installFast4gAndCpuThrottle>>
    | undefined;

  try {
    if (throttled) session = await installFast4gAndCpuThrottle(page);
    return await sample(page, resetFixture);
  } finally {
    if (session) await session.detach();
    await context.close();
  }
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

async function collectListRender(page: Page) {
  await openWorkList(page);
  const lastRow = page
    .locator("[data-testid=work-item-list-populated] tbody tr")
    .last();
  await lastRow.scrollIntoViewIfNeeded();
  await waitForTwoFrames(page);
  await captureScreen(page, "work-list");
  return page.evaluate(
    () => performance.now() - (window as G11Window).__g11Metrics.documentStart,
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
  await openLegacyBoard(page);
  await page
    .getByText("Seeded legacy task 200", { exact: true })
    .scrollIntoViewIfNeeded();
  await waitForTwoFrames(page);
  await captureScreen(page, "board");
  return page.evaluate(
    () => performance.now() - (window as G11Window).__g11Metrics.documentStart,
  );
}

async function collectBoardDragFrameP95(page: Page) {
  await openLegacyBoard(page);
  await page.waitForTimeout(400);

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
  await page.waitForTimeout(250);

  const frameTimes = await page.evaluate(
    () => (window as G11Window).__g11Metrics.dragFrameTimes ?? [],
  );
  if (frameTimes.length < 60)
    throw new Error(
      "The 2.2 second board drag captured too few animation frames: " +
        frameTimes.length,
    );
  const ordered = [...frameTimes].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1];
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

  const trigger = page
    .locator('[data-slot="context-menu-trigger"]')
    .filter({ has: card });
  await expect(trigger).toHaveCount(1);
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Shift+F10");
  await expect(copyLink).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(copyLink).toHaveCount(0);

  await trigger.focus();
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
}

async function threeSamplesWithOneRetry(metric: BudgetMetric) {
  const { result, values, retried } = await medianOfThreeWithRetry(
    metric.sample,
    metric.budget,
  );
  console.log(
    "G11 " +
      metric.name +
      ": median " +
      result.toFixed(1) +
      " (" +
      values.map((value) => value.toFixed(1)).join(", ") +
      "); budget < " +
      metric.budget +
      (retried ? "; one retry set used" : ""),
  );
  return { ...metric, result, values };
}

test("G11: seeded work-list journeys meet browser performance budgets", async ({
  browser,
}) => {
  test.setTimeout(360_000);
  const results = [];

  results.push(
    await threeSamplesWithOneRetry({
      name: "work-list render, 500 rows (ms; unthrottled)",
      budget: 500,
      sample: () =>
        withPerformancePage(browser, false, (page) => collectListRender(page)),
    }),
  );

  results.push(
    await threeSamplesWithOneRetry({
      name: "work-list LCP (ms)",
      budget: 2500,
      sample: () =>
        withPerformancePage(browser, true, (page) =>
          collectNavigationMetric(page, "lcp"),
        ),
    }),
  );
  results.push(
    await threeSamplesWithOneRetry({
      name: "work-list CLS",
      budget: 0.1,
      sample: () =>
        withPerformancePage(browser, true, (page) =>
          collectNavigationMetric(page, "cls"),
        ),
    }),
  );
  results.push(
    await threeSamplesWithOneRetry({
      name: "work-list to work-item route transition (ms)",
      budget: 300,
      sample: () =>
        withPerformancePage(browser, true, (page) =>
          collectRouteTransition(page),
        ),
    }),
  );
  results.push(
    await threeSamplesWithOneRetry({
      name: "create-work-item interaction click-to-paint (ms)",
      budget: 200,
      sample: () =>
        withPerformancePage(browser, true, (page, resetFixture) =>
          collectCreateInteraction(page, resetFixture),
        ),
    }),
  );

  results.push(
    await threeSamplesWithOneRetry({
      name: "board render, 200 tasks (ms; unthrottled)",
      budget: 500,
      sample: () =>
        withPerformancePage(browser, false, (page) => collectBoardRender(page)),
    }),
  );
  results.push(
    await threeSamplesWithOneRetry({
      name: "board drag p95 frame time (ms; unthrottled)",
      budget: 20,
      sample: () =>
        withPerformancePage(browser, false, (page) =>
          collectBoardDragFrameP95(page),
        ),
    }),
  );

  const failures = results.filter((result) => result.result >= result.budget);
  expect(
    failures.map(
      ({ name, result, budget }) =>
        `${name}: ${result.toFixed(1)} (budget < ${budget})`,
    ),
    "G11 browser performance budget failures",
  ).toEqual([]);
});

test("G11: board context menu supports keyboard and delete cancel", async ({
  browser,
}) => {
  await withPerformancePage(browser, false, (page) =>
    verifyBoardCardMenu(page),
  );
});
