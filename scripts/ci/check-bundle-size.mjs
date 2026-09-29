#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const MANIFEST_PATH = path.join(ROOT, "apps/web/dist/.vite/manifest.json");
export const BUDGETS_KB = Object.freeze({ agent: 350, portal: 200 });
export const KB_BYTES = 1000;

export function isWithinBudget(role, bytes) {
  return bytes < BUDGETS_KB[role] * KB_BYTES;
}

function sourceRole(key, entry) {
  const identity =
    `${key} ${entry.name ?? ""} ${entry.src ?? ""}`.toLowerCase();
  if (/portal/.test(identity)) return "portal";
  if (/agent/.test(identity)) return "agent";
  return undefined;
}

export function resolveEntries(manifest) {
  const entries = Object.entries(manifest).filter(
    ([, item]) => item.isEntry && /\.m?js$/.test(item.file),
  );
  if (entries.length === 0)
    throw new Error("Vite manifest contains no JavaScript entry bundle.");
  const roles = new Map();
  for (const [key, item] of entries) {
    const role = sourceRole(key, item);
    if (role) {
      if (roles.has(role))
        throw new Error(
          `Vite manifest contains more than one ${role} entry bundle.`,
        );
      roles.set(role, [key, item]);
    }
  }
  const unclassified = entries.filter(([key, item]) => !sourceRole(key, item));
  if (
    unclassified.length === 1 &&
    !roles.has("agent") &&
    (entries.length === 1 || roles.has("portal"))
  ) {
    // The current single app entry predates the split and stays agent when portal appears.
    roles.set("agent", unclassified[0]);
  } else if (unclassified.length > 0) {
    throw new Error(
      `Unclassified JavaScript entry bundle(s): ${unclassified.map(([key]) => key).join(", ")}. Name entries agent or portal so each budget is enforced.`,
    );
  }
  if (!roles.has("agent"))
    throw new Error("Vite manifest has no agent entry bundle.");
  return new Map(
    [...roles].sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function collectInitialAssets(manifest, entryKey) {
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    const item = manifest[key];
    if (!item) throw new Error(`Vite manifest import is missing: ${key}`);
    seen.add(key);
    for (const imported of item.imports ?? []) visit(imported);
  };
  visit(entryKey);
  const assets = new Set();
  for (const key of seen) {
    const item = manifest[key];
    assets.add(item.file);
    for (const css of item.css ?? []) assets.add(css);
  }
  return [...assets];
}

export async function measureEntry(manifest, entryKey, outputDir) {
  const assets = collectInitialAssets(manifest, entryKey);
  let bytes = 0;
  for (const asset of assets) {
    const assetPath = path.resolve(outputDir, asset);
    if (!assetPath.startsWith(`${path.resolve(outputDir)}${path.sep}`)) {
      throw new Error(`Manifest asset escapes the build directory: ${asset}`);
    }
    const contents = await readFile(assetPath);
    bytes += gzipSync(contents, { level: 9, mtime: 0 }).byteLength;
  }
  return { bytes, assets };
}

export async function checkBundleSizes({
  manifestPath = MANIFEST_PATH,
  outputDir = path.dirname(path.dirname(manifestPath)),
} = {}) {
  try {
    await stat(manifestPath);
  } catch {
    throw new Error(
      `Built web output is missing (${manifestPath}); run pnpm build before check:bundle-size.`,
    );
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const entries = resolveEntries(manifest);
  const results = [];
  for (const [role, [key]] of entries) {
    const measurement = await measureEntry(manifest, key, outputDir);
    const limit = BUDGETS_KB[role] * KB_BYTES;
    results.push({
      role,
      bytes: measurement.bytes,
      limit,
      assets: measurement.assets,
    });
  }
  return results;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    for (const result of await checkBundleSizes()) {
      const size = (result.bytes / KB_BYTES).toFixed(1);
      const budget = (result.limit / KB_BYTES).toFixed(0);
      console.log(
        `G11 ${result.role} initial bundle: ${size} KB gzip / ${budget} KB budget (${result.assets.length} assets)`,
      );
      if (!isWithinBudget(result.role, result.bytes))
        throw new Error(
          `G11 ${result.role} bundle is ${size} KB gzip; budget is strictly below ${budget} KB.`,
        );
    }
  } catch (error) {
    console.error(
      `check:bundle-size: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
