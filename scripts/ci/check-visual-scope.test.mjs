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

function visualSpec(screens, { omitScreenshotFor, nestedScreenshotFor } = {}) {
  return screens
    .map(
      ({ test: testName, screenshot }) =>
        `test(${JSON.stringify(testName)}, async ({ page }) => { ${
          testName === omitScreenshotFor
            ? "await page.goto('/');"
            : testName === nestedScreenshotFor
              ? `const unused = () => expect(page).toHaveScreenshot(${JSON.stringify(screenshot)}); await page.goto('/');`
              : `await expect(page).toHaveScreenshot(${JSON.stringify(screenshot)});`
        } });`,
    )
    .join("\n");
}

function storybookSpec({
  emptyCallback = false,
  detachedIndex = false,
  omitStoryNavigation = false,
} = {}) {
  const body = emptyCallback
    ? "await page.goto('/');"
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
        "  await expect(page).toHaveScreenshot(`\u0024{story.id}.png`, options);",
        "}",
      ].join("\n");
  return `test("every exported Storybook story has a visual baseline @visual", async ({ page }) => {\n${body}\n});`;
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
  assert.match(source, /toHaveScreenshot\("work-item-detail\.png"\)/);

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
