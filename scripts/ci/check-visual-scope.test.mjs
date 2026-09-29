import assert from "node:assert/strict";
import { after, test } from "node:test";
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

function visualSpec(screens) {
  return screens
    .map(
      ({ test: testName, screenshot }) =>
        `test(${JSON.stringify(testName)}, async ({ page }) => { await expect(page).toHaveScreenshot(${JSON.stringify(screenshot)}); });`,
    )
    .join("\n");
}

function routeTree(routes) {
  return routes.map((route) => `fullPath: '${route}'`).join("\n");
}

async function runVisualScope({ screens = SCREENS, routes = [] } = {}) {
  const dir = scratchDir("visual-scope-");
  installFromRepo(dir, "scripts/ci/check-visual-scope.mjs");
  installFromRepo(dir, "scripts/ci/lib/repo.mjs");

  write(dir, "docs/02-design/screen-inventory.md", INVENTORY);
  write(dir, "apps/web/src/routeTree.gen.ts", routeTree(routes));
  write(dir, "apps/web/e2e/visual-screens.json", JSON.stringify(screens));
  write(dir, "apps/web/e2e/visual.spec.ts", visualSpec(screens));
  write(
    dir,
    "apps/web/e2e/storybook-visual.spec.ts",
    'test("every exported Storybook story has a visual baseline @visual", () => {});',
  );

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
