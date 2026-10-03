import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BUDGETS_KB,
  checkBundleSizes,
  collectInitialAssets,
  isWithinBudget,
  resolveEntries,
  WORK_LIST_COMPONENT_SUFFIX,
} from "./check-bundle-size.mjs";

const manifest = {
  "src/main.tsx": {
    file: "assets/main.js",
    isEntry: true,
    imports: ["chunks/shared.js"],
    dynamicImports: ["chunks/later.js"],
    css: ["assets/main.css"],
  },
  "chunks/shared.js": { file: "assets/shared.js", isDynamicEntry: false },
  "chunks/later.js": { file: "assets/later.js" },
};

test("G11: single legacy entry is measured as agent and portal budget is registered", () => {
  const entries = resolveEntries(manifest);
  assert.deepEqual([...entries.keys()], ["agent"]);
  assert.equal(BUDGETS_KB.agent, 350);
  assert.equal(BUDGETS_KB["agent-work-list"], 350);
  assert.equal(BUDGETS_KB.portal, 200);
  assert.equal(isWithinBudget("agent", 349_999), true);
  assert.equal(isWithinBudget("agent", 350_000), false);
  assert.equal(isWithinBudget("portal", 199_999), true);
  assert.equal(isWithinBudget("portal", 200_000), false);
});

test("G11: direct work-list budget includes its early-preloaded static graph", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "g11-work-list-bundle-"));
  try {
    const manifestPath = path.join(dir, ".vite", "manifest.json");
    await mkdir(path.dirname(manifestPath));
    const workRouteKey = `src${WORK_LIST_COMPONENT_SUFFIX}`;
    const routeManifest = {
      "src/main.tsx": {
        file: "assets/main.js",
        isEntry: true,
        imports: ["chunks/shared.js"],
      },
      "chunks/shared.js": { file: "assets/shared.js" },
      [workRouteKey]: {
        file: "assets/work.js",
        imports: ["chunks/route-only.js"],
        dynamicImports: ["chunks/later.js"],
      },
      "../../i18n/en-US.json": { file: "assets/en-US.js" },
      "../../i18n/el-GR.json": { file: "assets/el-GR.js" },
      "chunks/route-only.js": { file: "assets/route-only.js" },
      "chunks/later.js": { file: "assets/later.js" },
    };
    await writeFile(manifestPath, JSON.stringify(routeManifest));
    await mkdir(path.join(dir, "assets"));
    await mkdir(path.join(dir, "chunks"));
    await Promise.all(
      [
        "assets/main.js",
        "assets/shared.js",
        "assets/work.js",
        "assets/route-only.js",
        "assets/later.js",
        "assets/en-US.js",
        "assets/el-GR.js",
      ].map((file) => writeFile(path.join(dir, file), file)),
    );
    await writeFile(
      path.join(dir, "assets/en-US.js"),
      Buffer.from(Array.from({ length: 256 }, (_, index) => index)),
    );
    await writeFile(path.join(dir, "assets/el-GR.js"), "x");

    const results = await checkBundleSizes({ manifestPath, outputDir: dir });
    const workList = results.find(
      (result) => result.role === "agent-work-list",
    );
    assert.ok(workList);
    assert.deepEqual(workList.assets, [
      "assets/main.js",
      "assets/shared.js",
      "assets/work.js",
      "assets/route-only.js",
      "assets/en-US.js",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("G11: initial graph includes static imports and CSS but excludes dynamic imports", () => {
  assert.deepEqual(collectInitialAssets(manifest, "src/main.tsx"), [
    "assets/main.js",
    "assets/main.css",
    "assets/shared.js",
  ]);
});

test("G11: unclassified additional entries fail closed", () => {
  assert.throws(
    () =>
      resolveEntries({
        ...manifest,
        "src/other.tsx": { file: "assets/other.js", isEntry: true },
      }),
    /Unclassified JavaScript entry/,
  );
});

test("G11: future portal entry is automatically assigned its 200 KB budget", () => {
  const entries = resolveEntries({
    "src/entry.agent.tsx": { file: "assets/agent.js", isEntry: true },
    "src/entry.portal.tsx": { file: "assets/portal.js", isEntry: true },
  });
  assert.deepEqual([...entries.keys()], ["agent", "portal"]);
});

test("G11: portal output activates its budget while retaining the legacy agent entry", () => {
  const entries = resolveEntries({
    "src/main.tsx": { file: "assets/main.js", isEntry: true },
    "src/entry.portal.tsx": { file: "assets/portal.js", isEntry: true },
  });
  assert.deepEqual([...entries.keys()], ["agent", "portal"]);
});

test("G11: bundle check refuses absent build output and missing assets", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "g11-bundle-"));
  try {
    const manifestPath = path.join(dir, ".vite", "manifest.json");
    await mkdir(path.dirname(manifestPath));
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      checkBundleSizes({ manifestPath, outputDir: dir }),
      /ENOENT/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("G11: manifest cannot measure files outside the web build", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "g11-bundle-"));
  try {
    const manifestPath = path.join(dir, ".vite", "manifest.json");
    await mkdir(path.dirname(manifestPath));
    await writeFile(
      manifestPath,
      JSON.stringify({
        "src/main.tsx": { file: "../secret.js", isEntry: true },
      }),
    );
    await assert.rejects(
      checkBundleSizes({ manifestPath, outputDir: dir }),
      /escapes the build directory/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("G11: independently built agent and portal roots are measured from separate manifests", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "g11-two-roots-"));
  const agentDir = path.join(root, "agent");
  const portalDir = path.join(root, "portal");
  const agentManifestPath = path.join(agentDir, ".vite", "manifest.json");
  const portalManifestPath = path.join(portalDir, ".vite", "manifest.json");
  try {
    await mkdir(path.dirname(agentManifestPath), { recursive: true });
    await mkdir(path.dirname(portalManifestPath), { recursive: true });
    const workKey = `src${WORK_LIST_COMPONENT_SUFFIX}`;
    await writeFile(
      agentManifestPath,
      JSON.stringify({
        "src/main.tsx": {
          file: "assets/agent.js",
          isEntry: true,
          imports: ["chunks/shared.js"],
          css: ["assets/agent.css"],
        },
        "chunks/shared.js": { file: "assets/shared.js" },
        [workKey]: { file: "assets/work.js", imports: ["chunks/shared.js"] },
        "../../i18n/en-US.json": { file: "assets/en-US.js" },
      }),
    );
    await writeFile(
      portalManifestPath,
      JSON.stringify({
        "src/main.portal.tsx": {
          file: "assets/portal.js",
          isEntry: true,
          css: ["assets/portal.css"],
        },
      }),
    );
    for (const [directory, files] of [
      [
        agentDir,
        [
          "assets/agent.js",
          "assets/agent.css",
          "assets/shared.js",
          "assets/work.js",
          "assets/en-US.js",
        ],
      ],
      [portalDir, ["assets/portal.js", "assets/portal.css"]],
    ]) {
      await mkdir(path.join(directory, "assets"), { recursive: true });
      await Promise.all(
        files.map((file) => writeFile(path.join(directory, file), file)),
      );
    }
    const results = await checkBundleSizes({
      manifestPath: agentManifestPath,
      portalManifestPath,
    });
    assert.deepEqual(
      results.map(({ role }) => role),
      ["agent", "agent-work-list", "portal"],
    );
    assert.ok(results.every(({ bytes }) => bytes > 0));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
