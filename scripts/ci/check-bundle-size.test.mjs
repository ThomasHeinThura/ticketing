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
  assert.equal(BUDGETS_KB.portal, 200);
  assert.equal(isWithinBudget("agent", 349_999), true);
  assert.equal(isWithinBudget("agent", 350_000), false);
  assert.equal(isWithinBudget("portal", 199_999), true);
  assert.equal(isWithinBudget("portal", 200_000), false);
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
