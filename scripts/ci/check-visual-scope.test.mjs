import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { repoRoot } from "./lib/repo.mjs";
import {
  cleanUpScratchRepos,
  installFromRepo,
  runChecker,
  scratchDir,
  write,
} from "./lib/scratch-repo.mjs";

after(cleanUpScratchRepos);

const INVENTORY = [
  "| Work list | `/agent/projects/{key}/work?layout=list` | route | P1 | 🟡 |",
  "| Work item detail | `/agent/work-items/{key}` | route | P1 | ✅ |",
  "| Future inbox | `/agent/inbox` | route | P1 | ⬜ |",
].join("\n");

const SCREENS = [
  {
    name: "work-list",
    inventoryRoute: "/agent/projects/{key}/work?layout=list",
    applicationRoute: "/agent/projects/$projectKey/work",
    test: "work list @visual",
    screenshot: "work-list.png",
  },
  {
    name: "work-item-detail",
    inventoryRoute: "/agent/work-items/{key}",
    applicationRoute: "/agent/work-items/$key",
    test: "work item detail @visual",
    screenshot: "work-item-detail.png",
  },
];

function visualSpec(
  screens,
  {
    omitScreenshotFor,
    nestedScreenshotFor,
    disabledFor,
    wrongRouteFor,
    wrongQueryFor,
    additionalNavigationFor,
    helperNavigationFor,
    nestedNavigationFor,
    screenshotBeforeNavigationFor,
    earlyReturnFor,
    setContentAfterNavigationFor,
    documentInterceptFor,
    shadowedSettleHelperFor,
    shadowedFixtureHelperFor,
    setContentInApiRouteFor,
    computedTaggedSetContentInApiRouteFor,
    mutationInVisibilityFor,
    locatorScreenshotFor,
    viewportScreenshotFor,
  } = {},
) {
  const helper = `async function installAuthenticatedFixture(page: Page) {
  await page.route("**/api/**", async (route) => { await route.fulfill({ status: 200 }); });
}`;
  const tests = screens
    .map(({ test: testName, screenshot, applicationRoute, inventoryRoute }) => {
      const applicationPath = applicationRoute.replace(
        /\$[A-Za-z0-9_]+/gu,
        "sample",
      );
      const routeState = inventoryRoute
        ? new URL(inventoryRoute, "http://visual.invalid").search
        : "";
      const navigation =
        testName === wrongRouteFor
          ? "/agent/inbox"
          : `${applicationPath}${testName === wrongQueryFor ? "?layout=board" : routeState}`;
      const screenshotEvidence =
        testName === omitScreenshotFor
          ? ""
          : testName === nestedScreenshotFor
            ? `const unused = () => expect(page).toHaveScreenshot(${JSON.stringify(screenshot)});`
            : testName === locatorScreenshotFor
              ? `await expect(page.getByText("screen ready")).toHaveScreenshot(${JSON.stringify(screenshot)}, SCREENSHOT_OPTIONS);`
              : testName === viewportScreenshotFor
                ? `await expect(page).toHaveScreenshot(${JSON.stringify(screenshot)}, { fullPage: false });`
                : `await expect(page).toHaveScreenshot(${JSON.stringify(screenshot)}, SCREENSHOT_OPTIONS);`;
      const additionalNavigation =
        testName === additionalNavigationFor ? "await page.goto(target);" : "";
      const targetDeclaration =
        testName === additionalNavigationFor
          ? 'const target = "/agent/inbox";'
          : "";
      const nestedNavigation =
        testName === nestedNavigationFor
          ? "if (true) { await page.goto('/'); }"
          : "";
      const helperNavigation =
        testName === helperNavigationFor
          ? "await navigateElsewhere(page);"
          : "";
      const earlyReturn =
        testName === earlyReturnFor ? "if (process.env.CI) return;" : "";
      const setContent =
        testName === setContentAfterNavigationFor
          ? 'await page.setContent("<main>pretend screen</main>");'
          : "";
      const mutationInVisibility =
        testName === mutationInVisibilityFor
          ? 'await expect((page.setContent("<main>pretend screen</main>"), document.write("<main>pretend screen</main>"), page.getByText("screen ready"))).toBeVisible();'
          : "";
      const documentIntercept =
        testName === documentInterceptFor
          ? 'await page.route("**/*", (route) => route.fulfill({ body: "<main>pretend screen</main>" }));'
          : "";
      const setContentInApiRoute =
        testName === setContentInApiRouteFor
          ? 'await page.route("**/api/**", async (route) => { await page.setContent("<main>pretend screen</main>"); await route.fulfill({ status: 200 }); });'
          : "";
      const computedTaggedSetContentInApiRoute =
        testName === computedTaggedSetContentInApiRouteFor
          ? 'await page.route("**/api/**", async (route) => { await aliasedPage["setContent"]`<main>pretend screen</main>`; await route.fulfill({ status: 200 }); });'
          : "";
      const shadowedSettleHelper =
        testName === shadowedSettleHelperFor
          ? 'const settleVisuals = async (page) => page.setContent("<main>pretend screen</main>");'
          : "";
      const shadowedFixtureHelper =
        testName === shadowedFixtureHelperFor
          ? 'const installAuthenticatedFixture = async (page) => page.setContent("<main>pretend screen</main>");'
          : "";
      const useShadowedSettleHelper =
        testName === shadowedSettleHelperFor
          ? "await settleVisuals(page);"
          : "";
      const beforeNavigation =
        testName === screenshotBeforeNavigationFor
          ? `${screenshotEvidence} `
          : "";
      const afterNavigation =
        testName === screenshotBeforeNavigationFor ? "" : screenshotEvidence;
      return `test(${JSON.stringify(testName)}, async ({ page, page: aliasedPage }) => { ${
        testName === disabledFor
          ? 'if (process.env.CI) test.fixme(true, "known issue");'
          : ""
      } ${targetDeclaration} ${documentIntercept} ${setContentInApiRoute} ${computedTaggedSetContentInApiRoute} ${shadowedFixtureHelper} await installAuthenticatedFixture(page); ${beforeNavigation}await page.goto(${JSON.stringify(navigation)}); ${earlyReturn} ${setContent} ${additionalNavigation} ${nestedNavigation} ${helperNavigation} ${mutationInVisibility} ${testName === mutationInVisibilityFor ? "" : 'await expect(page.getByText("screen ready")).toBeVisible();'} ${shadowedSettleHelper} ${useShadowedSettleHelper} ${afterNavigation} });`;
    })
    .join("\n");
  return `const SCREENSHOT_OPTIONS = { fullPage: true };\n${helper}\n${tests}`;
}

function storybookSpec({
  emptyCallback = false,
  detachedIndex = false,
  omitStoryNavigation = false,
  conditionalSkip = false,
  describeSkip = false,
  describeConfigureSkip = false,
  describeConfigureDynamic = false,
  skipStoryCaptureInCi = false,
} = {}) {
  const body = [
    ...(conditionalSkip
      ? ['if (process.env.CI) test.skip(true, "temporarily disabled");']
      : []),
    ...(emptyCallback
      ? ["await page.goto('/');"]
      : [
          'const response = await fetch("http://127.0.0.1:6006/index.json");',
          detachedIndex
            ? 'const index = { entries: { fake: { id: "Button--primary", type: "story" } } };'
            : "const index = await response.json();",
          'const stories = Object.values(index.entries).filter((entry) => entry.type === "story").sort((left, right) => left.id.localeCompare(right.id));',
          "expect(stories.length).toBeGreaterThan(0);",
          "for (const story of stories) {",
          ...(omitStoryNavigation
            ? []
            : [
                "  await page.goto(`http://127.0.0.1:6006/iframe.html?id=\u0024{story.id}&viewMode=story`);",
              ]),
          ...(skipStoryCaptureInCi ? ["  if (process.env.CI) continue;"] : []),
          "  await expect(page).toHaveScreenshot(`\u0024{story.id}.png`, { fullPage: true });",
          "}",
        ]),
  ].join("\n");
  const testCase = `test("every exported Storybook story has a visual baseline @visual", async ({ page }) => {\n${body}\n});`;
  if (describeSkip) {
    return `test.describe.skip("visual Storybook coverage", () => {\n${testCase}\n});`;
  }
  if (describeConfigureSkip) {
    return `test.describe.configure({ mode: "skip" });\n${testCase}`;
  }
  if (describeConfigureDynamic) {
    return `test.describe.configure({ mode: process.env.CI ? "skip" : "default" });\n${testCase}`;
  }
  return testCase;
}

function routeTree(routes) {
  return routes.map((route) => `fullPath: '${route}'`).join("\n");
}

async function runVisualScope({
  screens = SCREENS,
  routes = [],
  source = visualSpec(screens),
  storySource = storybookSpec(),
} = {}) {
  const dir = scratchDir("visual-scope-");
  installFromRepo(dir, "scripts/ci/check-visual-scope.mjs");
  installFromRepo(dir, "scripts/ci/lib/repo.mjs");
  symlinkSync(
    path.join(repoRoot, "node_modules"),
    path.join(dir, "node_modules"),
    "dir",
  );

  write(dir, "docs/02-design/screen-inventory.md", INVENTORY);
  write(dir, "apps/web/src/routeTree.gen.ts", routeTree(routes));
  write(dir, "apps/web/e2e/visual-screens.json", JSON.stringify(screens));
  write(
    dir,
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: { target: "ESNext", module: "ESNext" },
      include: ["apps/web/e2e/*.ts"],
    }),
  );
  write(dir, "apps/web/e2e/visual.spec.ts", source);
  write(dir, "apps/web/e2e/storybook-visual.spec.ts", storySource);

  for (const screen of screens) {
    write(
      dir,
      `apps/web/e2e/visual.spec.ts-snapshots/${screen.screenshot.replace(/\.png$/, "")}-linux.png`,
      "fixture baseline",
    );
  }

  return runChecker(dir, "check-visual-scope.mjs");
}

const ACTIVE_ROUTES = [
  "/agent/projects/$projectKey/work",
  "/agent/work-items/$key",
];

test("G8 accepts active inventory routes and leaves not-started routes pending", async () => {
  const result = await runVisualScope({ routes: ACTIVE_ROUTES });

  assert.equal(result.status, 0, result.output);
  assert.match(
    result.output,
    /2 screenshot cases, 2 active inventory route rows mapped \(2 in-progress or complete among 3 route rows\)/,
  );
});

test("G8 fails when an active inventory route has no manifest baseline", async () => {
  const result = await runVisualScope({
    screens: SCREENS.slice(0, 1),
    routes: ACTIVE_ROUTES,
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /in-progress or complete inventory route Work item detail .* has no G8 test\/baseline manifest entry/,
  );
});

test("G8 binds each declared screenshot to its own named test", async () => {
  const source = visualSpec(SCREENS, {
    omitScreenshotFor: "work list @visual",
  });
  assert.doesNotMatch(source, /work-list\.png/);
  assert.match(source, /toHaveScreenshot\("work-item-detail\.png"/);

  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    source,
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /work-list test does not capture its declared screenshot baseline/,
  );
});

test("G8 rejects a visual test that navigates to another application route", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    source: visualSpec(SCREENS, { wrongRouteFor: "work list @visual" }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /work-list visual test must have exactly one direct awaited literal navigation/,
  );
});

test("G8 binds each visual test to its declared application route and query state", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    source: visualSpec(SCREENS, { wrongQueryFor: "work list @visual" }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /must have exactly one direct awaited literal navigation/,
  );
});

test("G8 rejects an additional nonliteral route navigation", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    source: visualSpec(SCREENS, {
      additionalNavigationFor: "work list @visual",
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /work-list visual test must have exactly one direct awaited literal navigation/,
  );
});

test("G8 rejects a nested conditional route navigation", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    source: visualSpec(SCREENS, {
      nestedNavigationFor: "work list @visual",
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /work-list visual test must have exactly one direct awaited literal navigation/,
  );
});

test("G8 rejects route navigation hidden in an external helper", async () => {
  const source = `async function navigateElsewhere(page) { await page.goto("/agent/inbox"); }\n${visualSpec(
    SCREENS,
    {
      helperNavigationFor: "work list @visual",
    },
  )}`;
  const result = await runVisualScope({ routes: ACTIVE_ROUTES, source });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /visual\.spec\.ts contains page navigation or screenshot assertions outside its named visual tests/,
  );
});

test("G8 requires the screenshot capture to follow its declared route navigation", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    source: visualSpec(SCREENS, {
      screenshotBeforeNavigationFor: "work list @visual",
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /work-list visual test captures its screenshot before navigating to its declared route/,
  );
});

test("G8 rejects an early return that makes the screenshot unreachable", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    source: visualSpec(SCREENS, { earlyReturnFor: "work list @visual" }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /work-list visual test can return before its route screenshot assertion/,
  );
});

test("G8 rejects replacing the declared route document before capture", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    source: visualSpec(SCREENS, {
      setContentAfterNavigationFor: "work list @visual",
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /work-list visual test must use only API fixture setup before navigation/,
  );
});

test("G8 rejects a shadowed visual helper that can replace the page document", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    source: visualSpec(SCREENS, {
      shadowedSettleHelperFor: "work list @visual",
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /work-list visual test must use only API fixture setup before navigation/,
  );
});

test("G8 rejects page document replacement hidden in a visible assertion argument", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    source: visualSpec(SCREENS, {
      mutationInVisibilityFor: "work list @visual",
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /work-list visual test must use only API fixture setup before navigation/,
  );
});

test("G8 requires screen visual baselines to capture the whole page", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    source: visualSpec(SCREENS, { locatorScreenshotFor: "work list @visual" }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /work-list test does not capture its declared screenshot baseline/,
  );
});

test("G8 rejects viewport-only screenshots as the route baseline", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    source: visualSpec(SCREENS, { viewportScreenshotFor: "work list @visual" }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /work-list test does not capture its declared screenshot baseline/,
  );
});

test("G8 rejects a shadowed pre-navigation fixture helper", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    source: visualSpec(SCREENS, {
      shadowedFixtureHelperFor: "work list @visual",
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /work-list visual test must use only API fixture setup before navigation/,
  );
});

test("G8 rejects route interception that can replace the application document", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    source: visualSpec(SCREENS, {
      documentInterceptFor: "work list @visual",
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /visual\.spec\.ts contains page navigation or screenshot assertions outside its named visual tests, or intercepts a non-API document route/,
  );
});

test("G8 rejects DOM mutation inside an API fixture route handler", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    source: visualSpec(SCREENS, {
      setContentInApiRouteFor: "work list @visual",
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /work-list visual test must use only API fixture setup before navigation/,
  );
});

test("G8 rejects computed tagged-template mutation through an aliased page fixture", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    source: visualSpec(SCREENS, {
      computedTaggedSetContentInApiRouteFor: "work list @visual",
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /work-list visual test must use only API fixture setup before navigation/,
  );
});

test("G8 does not accept a nested screenshot helper as a route assertion", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    source: visualSpec(SCREENS, {
      nestedScreenshotFor: "work list @visual",
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /work-list test does not capture its declared screenshot baseline/,
  );
});

test("G8 rejects a visual route test that conditionally calls test.fixme", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    source: visualSpec(SCREENS, { disabledFor: "work list @visual" }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /work-list visual test cannot be skipped or fixme/,
  );
});

test("G8 fails when the Storybook test title remains but its coverage loop is removed", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    storySource: storybookSpec({ emptyCallback: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index, enumerate every story, reject an empty set, and await its per-story screenshot baseline/,
  );
});

test("G8 rejects a Storybook callback that conditionally calls test.skip", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    storySource: storybookSpec({ conditionalSkip: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test cannot be skipped or fixme/,
  );
});

test("G8 rejects a Storybook loop that continues before its screenshot in CI", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    storySource: storybookSpec({ skipStoryCaptureInCi: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index, enumerate every story, reject an empty set, and await its per-story screenshot baseline/,
  );
});

test("G8 rejects a Storybook visual test inside a skipped describe block", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    storySource: storybookSpec({ describeSkip: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /storybook-visual\.spec\.ts cannot disable tests/,
  );
});

test("G8 rejects a Storybook file configured to skip its suite", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    storySource: storybookSpec({ describeConfigureSkip: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /storybook-visual\.spec\.ts cannot disable tests/,
  );
});

test("G8 rejects a Storybook suite whose mode can conditionally skip", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    storySource: storybookSpec({ describeConfigureDynamic: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /storybook-visual\.spec\.ts cannot disable tests/,
  );
});

test("G8 requires each Storybook screenshot to visit that story's iframe", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    storySource: storybookSpec({ omitStoryNavigation: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index, enumerate every story, reject an empty set, and await its per-story screenshot baseline/,
  );
});

test("G8 rejects a disconnected hard-coded Storybook story list", async () => {
  const result = await runVisualScope({
    routes: ACTIVE_ROUTES,
    storySource: storybookSpec({ detachedIndex: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index, enumerate every story, reject an empty set, and await its per-story screenshot baseline/,
  );
});

test("G8 fails when a registered future route remains marked not started", async () => {
  const result = await runVisualScope({
    routes: [...ACTIVE_ROUTES, "/agent/inbox"],
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /registered inventory route \/agent\/inbox has no row marked in progress or complete/,
  );
});

test("G8 rejects a baseline manifest entry before its inventory route starts", async () => {
  const result = await runVisualScope({
    screens: [
      ...SCREENS,
      {
        name: "future-inbox",
        inventoryRoute: "/agent/inbox",
        applicationRoute: "/agent/inbox",
        test: "future inbox @visual",
        screenshot: "future-inbox.png",
      },
    ],
    routes: [...ACTIVE_ROUTES, "/agent/inbox"],
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /future-inbox is not an in-progress or complete route row/,
  );
});
