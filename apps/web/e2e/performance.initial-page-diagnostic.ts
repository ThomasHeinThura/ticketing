import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  PERFORMANCE_BASE_URL,
  PROJECT_ID,
  WORK_LIST_PATH,
  WORKSPACE_ID,
} from "./helpers/g11-performance-fixture";
import { attachPerformanceNetworkCapture } from "./helpers/performance-network-summary";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const ORIGIN = PERFORMANCE_BASE_URL;
const RESULT_DIR = path.join(
  ROOT,
  "apps/web/test-results/g11-initial-page-diagnostic",
);

type CpuProfile = {
  nodes: Array<{
    id: number;
    children?: number[];
    callFrame: {
      functionName: string;
      url: string;
      lineNumber: number;
      columnNumber: number;
    };
  }>;
  samples?: number[];
  timeDeltas?: number[];
};

function sanitizeCpuProfile(profile: CpuProfile) {
  const nodeIds = new Set(profile.nodes.map((node) => node.id));
  const samples = profile.samples ?? [];
  const timeDeltas = profile.timeDeltas ?? [];
  if (samples.length !== timeDeltas.length)
    throw new Error("The diagnostic CPU profile has unpaired samples.");
  for (const node of profile.nodes) {
    if (node.children?.some((childId) => !nodeIds.has(childId)))
      throw new Error("The diagnostic CPU profile contains an unknown child.");
  }
  if (samples.some((nodeId) => !nodeIds.has(nodeId)))
    throw new Error("The diagnostic CPU profile contains an unknown sample.");

  return {
    nodes: profile.nodes.map((node) => {
      let asset = "runtime";
      if (node.callFrame.url) {
        try {
          const frameUrl = new URL(node.callFrame.url, ORIGIN);
          asset =
            frameUrl.origin === ORIGIN &&
            frameUrl.pathname.startsWith("/assets/")
              ? path.posix.basename(frameUrl.pathname)
              : "non-asset";
        } catch {
          asset = "non-asset";
        }
      }
      return {
        id: node.id,
        children: node.children ?? [],
        functionName: node.callFrame.functionName.slice(0, 160),
        asset,
        line: node.callFrame.lineNumber + 1,
        column: node.callFrame.columnNumber + 1,
      };
    }),
    samples,
    timeDeltasMicroseconds: timeDeltas,
  };
}

type InitialDocumentMetrics = {
  lcp: {
    startTime: number;
    element: string;
    textLength: number;
    url: string;
  } | null;
  heading: { found: boolean; tag: string | null; textLength: number };
  navigation: {
    responseStart: number;
    domInteractive: number;
    load: number;
  } | null;
  resources: Array<{
    kind: string;
    asset: string;
    start: number;
    responseStart: number;
    end: number;
    transferBytes: number;
  }>;
  longTasks: Array<{ start: number; duration: number }>;
};

declare global {
  interface Window {
    __g11InitialDiagnostic?: {
      lcp: { startTime: number; element: string; textLength: number } | null;
      longTasks: Array<{ start: number; duration: number }>;
    };
  }
}

function digest(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function safeAssetName(value: string) {
  try {
    const parsed = new URL(value, ORIGIN);
    if (parsed.origin !== ORIGIN) return "external";
    return path.posix.basename(parsed.pathname) || "document";
  } catch {
    return "unrecognized";
  }
}

function sampledFrames(
  profile: CpuProfile,
  modulesByAsset: Record<string, string[]>,
) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const weights = new Map<number, number>();
  for (const [index, nodeId] of (profile.samples ?? []).entries()) {
    weights.set(
      nodeId,
      (weights.get(nodeId) ?? 0) + (profile.timeDeltas?.[index] ?? 0),
    );
  }
  return [...weights]
    .map(([nodeId, sampledMicroseconds]) => {
      const frame = nodes.get(nodeId)?.callFrame;
      if (!frame?.url.startsWith(`${ORIGIN}/assets/`)) return undefined;
      const asset = safeAssetName(frame.url);
      return {
        asset,
        functionName: frame.functionName || "(anonymous)",
        line: frame.lineNumber + 1,
        column: frame.columnNumber + 1,
        sampledMicroseconds,
        sourceModuleCount: modulesByAsset[asset]?.length ?? 0,
      };
    })
    .filter((frame): frame is NonNullable<typeof frame> => frame !== undefined)
    .sort((left, right) => right.sampledMicroseconds - left.sampledMicroseconds)
    .slice(0, 60);
}

async function getBuildIdentity(profileAssetNames: Set<string>) {
  const manifestPath = path.join(
    ROOT,
    "apps/web/dist/agent/.vite/manifest.json",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
    string,
    { file?: string; imports?: string[]; isEntry?: boolean; src?: string }
  >;
  const entry = Object.entries(manifest).find(
    ([key, value]) =>
      value.isEntry && (key === "index.html" || value.src === "index.html"),
  );
  if (!entry)
    throw new Error(
      "The emitted agent entry was absent from the Vite manifest.",
    );

  const reachable = new Set<string>();
  const visit = (key: string) => {
    if (reachable.has(key)) return;
    reachable.add(key);
    for (const dependency of manifest[key]?.imports ?? []) visit(dependency);
  };
  visit(entry[0]);

  const initialFiles = new Set(
    [...reachable]
      .map((key) => manifest[key]?.file)
      .filter((file): file is string => file !== undefined),
  );
  const profileFiles = new Set(
    Object.values(manifest)
      .map((item) => item.file)
      .filter(
        (file): file is string =>
          file !== undefined &&
          profileAssetNames.has(path.posix.basename(file)),
      ),
  );
  const relevantFiles = new Set([...initialFiles, ...profileFiles]);
  const assets = await Promise.all(
    [...relevantFiles].flatMap((file) => {
      const assetPath = path.join(ROOT, "apps/web/dist/agent", file);
      return [
        (async () => ({
          file,
          sha256: digest(await readFile(assetPath)),
        }))(),
      ];
    }),
  );
  const maps = await Promise.all(
    [...relevantFiles].map(async (file) => {
      if (!file.endsWith(".js"))
        return [path.posix.basename(file), []] as const;
      try {
        const map = JSON.parse(
          await readFile(
            path.join(ROOT, "apps/web/dist/agent", `${file}.map`),
            "utf8",
          ),
        ) as { sources?: string[] };
        return [path.posix.basename(file), map.sources ?? []] as const;
      } catch {
        return [path.posix.basename(file), []] as const;
      }
    }),
  );
  const moduleMapSources = Object.fromEntries(maps);
  const unmappedJavaScriptAssets = [...relevantFiles]
    .filter((file) => file.endsWith(".js"))
    .filter((file) => moduleMapSources[path.posix.basename(file)]?.length === 0)
    .map((file) => path.posix.basename(file))
    .sort();
  return {
    sourceSha: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim(),
    manifestSha256: digest(await readFile(manifestPath)),
    canonicalFixtureSha256: digest(
      await readFile(
        path.join(ROOT, "apps/web/e2e/helpers/g11-performance-fixture.ts"),
      ),
    ),
    initialAssets: assets.filter((asset) => initialFiles.has(asset.file)),
    profiledAssets: assets.filter((asset) => profileFiles.has(asset.file)),
    modulesByAsset: moduleMapSources,
    moduleMapCoverage: {
      mappedJavaScriptAssets:
        [...relevantFiles].filter((file) => file.endsWith(".js")).length -
        unmappedJavaScriptAssets.length,
      javascriptAssets: [...relevantFiles].filter((file) =>
        file.endsWith(".js"),
      ).length,
      unmappedJavaScriptAssets,
    },
  };
}

async function collectDocumentMetrics(
  page: Page,
): Promise<InitialDocumentMetrics> {
  return page.evaluate((origin) => {
    const lcp = window.__g11InitialDiagnostic?.lcp;
    const heading = document.querySelector("h1");
    const navigation = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    return {
      lcp: lcp
        ? {
            ...lcp,
            url: "",
          }
        : null,
      heading: {
        found: Boolean(heading?.getClientRects().length),
        tag: heading?.tagName.toLowerCase() ?? null,
        textLength: heading?.textContent?.trim().length ?? 0,
      },
      navigation: navigation
        ? {
            responseStart: navigation.responseStart,
            domInteractive: navigation.domInteractive,
            load: navigation.loadEventEnd,
          }
        : null,
      resources: performance
        .getEntriesByType("resource")
        .map((entry) => entry as PerformanceResourceTiming)
        .filter((entry) => entry.name.startsWith(`${origin}/`))
        .map((entry) => ({
          kind: entry.initiatorType,
          asset: new URL(entry.name).pathname.split("/").at(-1) ?? "",
          start: entry.startTime,
          responseStart: entry.responseStart,
          end: entry.responseEnd,
          transferBytes: entry.transferSize,
        }))
        .sort((left, right) => left.start - right.start),
      longTasks: window.__g11InitialDiagnostic?.longTasks ?? [],
    };
  }, ORIGIN);
}

type DiagnosticCapture = {
  name: string;
  profile: CpuProfile;
  metrics: InitialDocumentMetrics;
  network: ReturnType<typeof JSON.parse>;
};

async function withDiagnosticProfile(
  browser: import("@playwright/test").Browser,
  name: string,
  throttled: boolean,
  prepare: (page: Page) => Promise<void>,
  visit: (page: Page) => Promise<void>,
): Promise<DiagnosticCapture> {
  const context = await browser.newContext({
    baseURL: ORIGIN,
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  const networkCapture = attachPerformanceNetworkCapture(context, ORIGIN, {
    maxRequests: 512,
    maxAttachmentBytes: 128 * 1024,
  });
  const cdp = await context.newCDPSession(page);
  let profile: CpuProfile | undefined;
  let metrics: InitialDocumentMetrics | undefined;
  await installPerformanceApiFixture(page);
  await page.addInitScript(() => {
    const state = {
      lcp: null as {
        startTime: number;
        element: string;
        textLength: number;
      } | null,
      longTasks: [] as Array<{ start: number; duration: number }>,
    };
    window.__g11InitialDiagnostic = state;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const candidate = entry as PerformanceEntry & {
          element?: Element | null;
        };
        state.lcp = {
          startTime: candidate.startTime,
          element: candidate.element?.tagName.toLowerCase() ?? "no-element",
          textLength: candidate.element?.textContent?.trim().length ?? 0,
        };
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          state.longTasks.push({
            start: entry.startTime,
            duration: entry.duration,
          });
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // Long-task observation is browser-dependent; CPUProfile and LCP remain required.
    }
  });

  try {
    if (throttled) {
      // Keep this aligned with installFast4gAndCpuThrottle in the canonical G11 suite.
      await page.goto("about:blank");
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 150,
        downloadThroughput: 200_000,
        uploadThroughput: 93_750,
        connectionType: "cellular4g",
      });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    }
    await prepare(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.start");
    console.info(`G11 diagnostic phase started: ${name}`);
    await visit(page);
    const stopped = await cdp.send("Profiler.stop");
    profile = stopped.profile as CpuProfile;
    metrics = await collectDocumentMetrics(page);
    console.info(`G11 diagnostic phase completed: ${name}`);
  } finally {
    await cdp.detach();
    await context.close();
  }
  if (!profile || !metrics)
    throw new Error(`The ${name} diagnostic profile did not finish.`);
  return {
    name,
    profile,
    metrics,
    network: JSON.parse(networkCapture.finish()),
  };
}

async function visitInitialWorkList(page: Page) {
  await page.goto(WORK_LIST_PATH, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await expect(page.locator("h1")).toBeVisible();
  await page.waitForFunction(
    () => Boolean(window.__g11InitialDiagnostic?.lcp),
    undefined,
    { timeout: 45_000 },
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}

async function prepareTaskState(page: Page) {
  await page.goto(
    `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/task/legacy-task-1`,
    { waitUntil: "domcontentloaded" },
  );
  await page.getByRole("button", { name: "Backlog", exact: true }).waitFor({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Backlog", exact: true }).click();
}

async function visitTaskState(page: Page) {
  await page
    .getByRole("button", { name: /^In progress/ })
    .last()
    .click();
  await expect(
    page.locator('[data-slot="popover-trigger"]:visible').filter({
      hasText: "In progress",
    }),
  ).toBeVisible();
}

async function prepareTaskAssignment(page: Page) {
  await page.goto(
    `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/task/legacy-task-1`,
    { waitUntil: "domcontentloaded" },
  );
  await page
    .getByRole("button", { name: /Unassigned/ })
    .last()
    .click({ timeout: 30_000 });
}

async function visitTaskAssignment(page: Page) {
  await page
    .getByRole("button", { name: /G11 Agent/ })
    .last()
    .click({ timeout: 30_000 });
  await expect(
    page.locator('[data-slot="popover-trigger"]:visible').filter({
      hasText: "G11 Agent",
    }),
  ).toBeVisible();
}

async function visitBoard(page: Page) {
  await page.goto(
    `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/board`,
    { waitUntil: "domcontentloaded" },
  );
  await expect(page.locator('[data-task-id^="legacy-task-"]')).toHaveCount(
    200,
    { timeout: 30_000 },
  );
}

async function visitBoardTaskDetailsSheet(page: Page) {
  await page.goto(
    `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/board`,
    { waitUntil: "domcontentloaded" },
  );
  const firstTaskCard = page.locator('[data-task-id^="legacy-task-"]').first();
  await expect(firstTaskCard).toBeVisible({ timeout: 30_000 });
  const taskId = await firstTaskCard.getAttribute("data-task-id");
  if (!taskId) throw new Error("The first board card had no task identity.");

  await firstTaskCard.click();
  await expect(page).toHaveURL(new RegExp(`[?&]taskId=${taskId}(?:&|$)`));
  await expect(
    page.locator('.taskdesk-tiptap-prose[contenteditable="true"]'),
  ).toBeVisible({
    timeout: 30_000,
  });

  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/[?&]taskId=/);
  await expect(
    page.locator('.taskdesk-tiptap-prose[contenteditable="true"]'),
  ).toHaveCount(0);
}

test("diagnostic: source-bound G11 failure-path CPU profiles", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const captures = [
    await withDiagnosticProfile(
      browser,
      "initial work-list navigation to LCP",
      true,
      async () => {},
      visitInitialWorkList,
    ),
    await withDiagnosticProfile(
      browser,
      "task-state option selection click-to-paint",
      true,
      prepareTaskState,
      visitTaskState,
    ),
    await withDiagnosticProfile(
      browser,
      "task-assignment option selection click-to-paint",
      true,
      prepareTaskAssignment,
      visitTaskAssignment,
    ),
    await withDiagnosticProfile(
      browser,
      "board navigation to all 200 cards rendered",
      false,
      async () => {},
      visitBoard,
    ),
    await withDiagnosticProfile(
      browser,
      "board task selection opens editor and Escape closes sheet",
      false,
      async () => {},
      visitBoardTaskDetailsSheet,
    ),
  ];
  const profileAssetNames = new Set(
    captures.flatMap(({ profile }) =>
      profile.nodes
        .map((node) => node.callFrame.url)
        .filter((url) => url.startsWith(`${ORIGIN}/assets/`))
        .map(safeAssetName),
    ),
  );
  const build = await getBuildIdentity(profileAssetNames);
  const profileWindows = captures.map(({ name, profile }) => ({
    name,
    topCpuFrames: sampledFrames(profile, build.modulesByAsset),
    cpuProfileTree: sanitizeCpuProfile(profile),
  }));
  const initial = captures[0];
  const result = {
    schemaVersion: 2,
    diagnosticOnly: true,
    capturedAfterCanonicalG11: true,
    fixture:
      "canonical G11 installPerformanceApiFixture (500 work items, 200 board cards)",
    sourceAndBuild: build,
    profileModes: {
      lcpStateAssignment: "150ms latency, 200KB/s down, 93.75KB/s up, 4x CPU",
      boardRender:
        "unthrottled, matching canonical G11 board-render measurement",
    },
    route: WORK_LIST_PATH,
    profileWindows,
    initialDocument: initial.metrics,
    networkByWindow: captures.map(({ name, network }) => ({ name, network })),
  };
  await mkdir(RESULT_DIR, { recursive: true });
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  await writeFile(
    path.join(RESULT_DIR, "initial-page-profile.json"),
    serialized,
    { mode: 0o600 },
  );
  await test.info().attach("g11-initial-page-profile.json", {
    body: serialized,
    contentType: "application/json",
  });
  expect(
    initial.metrics.lcp,
    "The real page LCP entry must be observed.",
  ).not.toBeNull();
  expect(
    initial.metrics.heading.found,
    "The real work-list heading must be visible.",
  ).toBe(true);
  expect(profileWindows).toHaveLength(5);
  expect(
    profileWindows.every((window) => window.topCpuFrames.length > 0),
    "Each hosted failure class must include sampled app JavaScript frames.",
  ).toBe(true);
  expect(
    captures.every(
      ({ network }) => !network.truncated && network.droppedCount === 0,
    ),
    "The diagnostic must retain all observed requests without truncation.",
  ).toBe(true);
});
