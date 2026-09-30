import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { medianOfThreeWithRetry } from "../../../scripts/ci/lib/performance-budget.mjs";

type BudgetMetric = {
  name: string;
  budget: number;
  sample: () => Promise<number>;
};

async function threeSamplesWithOneRetry(metric: BudgetMetric) {
  const { result, values } = await medianOfThreeWithRetry(
    metric.sample,
    metric.budget,
  );
  console.log(
    `G11 ${metric.name}: median ${result.toFixed(1)} (${values.map((value) => value.toFixed(1)).join(", ")}); budget < ${metric.budget}`,
  );
  return { ...metric, result, values };
}

async function installConfigFixture(context: BrowserContext) {
  await context.route("**/api/config", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Origin": "http://127.0.0.1:4178",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type, X-TaskDesk-Window-Id",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
      body: JSON.stringify({
        disableRegistration: false,
        disablePasswordRegistration: false,
        disableEmailOtpSignIn: false,
        disableWorkspaceCreation: false,
        hasSmtp: false,
        hasGithubSignIn: false,
        hasGoogleSignIn: false,
        hasDiscordSignIn: false,
        hasCustomOAuth: false,
        disableLoginForm: false,
        customOAuthAutoLogin: false,
        customOAuthLogoutUrl: null,
      }),
    }),
  );
  await context.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Origin": "http://127.0.0.1:4178",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type, X-TaskDesk-Window-Id",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
      body: "null",
    }),
  );
}

async function installFast4gAndCpuThrottle(page: Page) {
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditionsByRule", {
    offline: false,
    matchedNetworkConditions: [
      {
        urlPattern: "",
        latency: 150,
        downloadThroughput: 200_000,
        uploadThroughput: 93_750,
      },
    ],
  });
  await session.send("Network.overrideNetworkState", {
    offline: false,
    latency: 150,
    downloadThroughput: 200_000,
    uploadThroughput: 93_750,
  });
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  return session;
}

async function sampleOnFreshContext<T>(
  browser: Browser,
  sample: (page: Page) => Promise<T>,
) {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4178",
    locale: "en-US",
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  await installConfigFixture(context);
  await installPerformanceObserver(context);
  const page = await context.newPage();
  const session = await installFast4gAndCpuThrottle(page);
  try {
    return await sample(page);
  } finally {
    await session.detach();
    await context.close();
  }
}

async function installPerformanceObserver(context: BrowserContext) {
  await context.addInitScript(() => {
    const metrics = {
      lcp: 0,
      cls: 0,
      clickPaint: Number.POSITIVE_INFINITY,
      routeStart: 0,
    };
    Object.defineProperty(window, "__g11Metrics", {
      value: metrics,
      configurable: true,
    });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        metrics.lcp = (
          entry as PerformanceEntry & { startTime: number }
        ).startTime;
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
    document.addEventListener(
      "pointerdown",
      (event) => {
        const target = (event.target as Element | null)?.closest("button");
        if (target?.type === "submit") {
          const start = performance.now();
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              metrics.clickPaint = performance.now() - start;
            }),
          );
        }
        if (
          (event.target as Element | null)?.closest('a[href="/auth/sign-up"]')
        )
          metrics.routeStart = performance.now();
      },
      { capture: true },
    );
  });
}

async function openSignIn(page: Page) {
  await page.goto("/auth/sign-in");
  const email = page.locator('input[type="email"]');
  await expect(email).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible({
    timeout: 15_000,
  });
}

async function collectNavigationMetric(page: Page, name: "lcp" | "cls") {
  await openSignIn(page);
  await page.waitForLoadState("networkidle");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  return page.evaluate((requested) => {
    const values = (
      window as Window & { __g11Metrics: { lcp: number; cls: number } }
    ).__g11Metrics;
    return requested === "lcp" ? values.lcp : values.cls;
  }, name);
}

async function collectClickToPaint(page: Page) {
  await openSignIn(page);
  const submit = page.getByRole("button", { name: /sign in/i });
  await page.evaluate(() => {
    (
      window as Window & { __g11Metrics: { clickPaint: number } }
    ).__g11Metrics.clickPaint = Number.POSITIVE_INFINITY;
  });
  await submit.click();
  await expect(page.locator('input[type="email"]')).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __g11Metrics: { clickPaint: number } })
            .__g11Metrics.clickPaint,
      ),
    )
    .not.toBe(Number.POSITIVE_INFINITY);
  return page.evaluate(
    () =>
      (window as Window & { __g11Metrics: { clickPaint: number } }).__g11Metrics
        .clickPaint,
  );
}

async function collectRouteTransition(page: Page) {
  await openSignIn(page);
  await page.getByRole("link", { name: /sign up|create account/i }).click();
  await expect(page).toHaveURL(/\/auth\/sign-up/);
  await expect(page.locator('input[type="email"]')).toBeVisible({
    timeout: 15_000,
  });
  return page.evaluate(() => {
    const started = (
      window as Window & { __g11Metrics: { routeStart: number } }
    ).__g11Metrics.routeStart;
    return performance.now() - started;
  });
}

test("G11: current sign-in journey meets browser performance budgets", async ({
  browser,
}) => {
  const results = [];
  results.push(
    await threeSamplesWithOneRetry({
      name: "sign-in LCP",
      budget: 2500,
      sample: () =>
        sampleOnFreshContext(browser, (page) =>
          collectNavigationMetric(page, "lcp"),
        ),
    }),
  );
  results.push(
    await threeSamplesWithOneRetry({
      name: "sign-in CLS",
      budget: 0.1,
      sample: () =>
        sampleOnFreshContext(browser, (page) =>
          collectNavigationMetric(page, "cls"),
        ),
    }),
  );
  results.push(
    await threeSamplesWithOneRetry({
      name: "sign-in interaction click-to-paint",
      budget: 200,
      sample: () => sampleOnFreshContext(browser, collectClickToPaint),
    }),
  );
  results.push(
    await threeSamplesWithOneRetry({
      name: "sign-in → sign-up route transition",
      budget: 300,
      sample: () => sampleOnFreshContext(browser, collectRouteTransition),
    }),
  );
  for (const result of results) {
    const values = result.values.map((value) => value.toFixed(1)).join(", ");
    console.log(
      `G11 ${result.name}: median ${result.result.toFixed(1)} (${values}); budget < ${result.budget}`,
    );
  }
  const failures = results.filter((result) => result.result >= result.budget);
  expect(
    failures.map(
      ({ name, result, budget }) =>
        `${name} ${result.toFixed(1)} (budget < ${budget})`,
    ),
    "G11 browser performance budget failures",
  ).toEqual([]);
});
