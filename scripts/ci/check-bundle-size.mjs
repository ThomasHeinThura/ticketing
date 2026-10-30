#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const AGENT_MANIFEST_PATH = path.join(
  ROOT,
  "apps/web/dist/agent/.vite/manifest.json",
);
const PORTAL_MANIFEST_PATH = path.join(
  ROOT,
  "apps/web/dist/portal/.vite/manifest.json",
);
export const BUDGETS_KB = Object.freeze({
  agent: 350,
  "agent-work-list": 350,
  portal: 200,
});
export const KB_BYTES = 1000;
export const WORK_LIST_COMPONENT_SUFFIX =
  "/routes/agent/_layout/_authenticated/agent/projects/$projectKey/work.tsx?tsr-split=component";
export const INSTANCE_USERS_COMPONENT_SUFFIX =
  "/routes/agent/_layout/_authenticated/god-mode/users.tsx?tsr-split=component";
export const PENDING_ACTION_DETAIL_COMPONENT_SUFFIX =
  "/routes/agent/_layout/_authenticated/dashboard/settings/account/pending-actions/$id.tsx?tsr-split=component";

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

export function resolveEntries(manifest, { defaultRole = "agent" } = {}) {
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
    !roles.has(defaultRole) &&
    (entries.length === 1 ||
      roles.has(defaultRole === "agent" ? "portal" : "agent"))
  ) {
    roles.set(defaultRole, unclassified[0]);
  } else if (unclassified.length > 0) {
    throw new Error(
      `Unclassified JavaScript entry bundle(s): ${unclassified.map(([key]) => key).join(", ")}. Name entries agent or portal so each budget is enforced.`,
    );
  }
  if (!roles.has(defaultRole))
    throw new Error(`Vite manifest has no ${defaultRole} entry bundle.`);
  return new Map(
    [...roles].sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function collectInitialAssets(manifest, entryKey) {
  const initialModules = collectInitialModules(manifest, entryKey);
  const assets = new Set();
  for (const key of initialModules) {
    const item = manifest[key];
    assets.add(item.file);
    for (const css of item.css ?? []) assets.add(css);
  }
  return [...assets];
}

export function collectInitialModules(manifest, entryKey) {
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    const item = manifest[key];
    if (!item) throw new Error(`Vite manifest import is missing: ${key}`);
    seen.add(key);
    for (const imported of item.imports ?? []) visit(imported);
  };
  visit(entryKey);
  return seen;
}

export function assertDynamicModuleOutsideInitialGraphs(
  manifest,
  entryKeys,
  moduleKey,
) {
  const module = manifest[moduleKey];
  if (!module?.isDynamicEntry)
    throw new Error(`${moduleKey} is not a dynamic build entry.`);
  for (const entryKey of entryKeys) {
    if (collectInitialModules(manifest, entryKey).has(moduleKey))
      throw new Error(
        `${moduleKey} entered the ${entryKey} initial static graph.`,
      );
  }
}

export async function measureAssets(assets, outputDir) {
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

export async function measureEntry(manifest, entryKey, outputDir) {
  return measureAssets(collectInitialAssets(manifest, entryKey), outputDir);
}

export async function checkBundleSizes({
  manifestPath = AGENT_MANIFEST_PATH,
  portalManifestPath = manifestPath === AGENT_MANIFEST_PATH
    ? PORTAL_MANIFEST_PATH
    : undefined,
  outputDir = path.dirname(path.dirname(manifestPath)),
} = {}) {
  const manifests = [
    { role: "agent", path: manifestPath, defaultRole: "agent", outputDir },
  ];
  if (portalManifestPath)
    manifests.push({
      role: "portal",
      path: portalManifestPath,
      defaultRole: "portal",
      outputDir: path.dirname(path.dirname(portalManifestPath)),
    });
  const results = [];
  for (const {
    role: expectedRole,
    path: currentManifestPath,
    defaultRole,
    outputDir: currentOutputDir,
  } of manifests) {
    try {
      await stat(currentManifestPath);
    } catch {
      throw new Error(
        `Built ${expectedRole} web output is missing (${currentManifestPath}); run pnpm build before check:bundle-size.`,
      );
    }
    const manifest = JSON.parse(await readFile(currentManifestPath, "utf8"));
    const entries = resolveEntries(manifest, { defaultRole });
    if (entries.size !== 1 || !entries.has(expectedRole))
      throw new Error(
        `${expectedRole} output must contain exactly one ${expectedRole} JavaScript entry.`,
      );
    for (const [role, [key]] of entries) {
      const measurement = await measureEntry(manifest, key, currentOutputDir);
      const limit = BUDGETS_KB[role] * KB_BYTES;
      results.push({
        role,
        bytes: measurement.bytes,
        limit,
        assets: measurement.assets,
      });

      if (role === "agent") {
        const workRouteKey = Object.keys(manifest).find((candidate) =>
          candidate.endsWith(WORK_LIST_COMPONENT_SUFFIX),
        );
        if (!workRouteKey)
          throw new Error(
            `G11 work-list route bundle is missing from the Vite manifest (expected a key ending in ${WORK_LIST_COMPONENT_SUFFIX}).`,
          );
        const createFormKey = Object.keys(manifest).find((candidate) =>
          candidate.endsWith(
            "/components/work-item/create-work-item-dialog-form.tsx",
          ),
        );
        if (!createFormKey)
          throw new Error(
            "G11 create-work-item dialog form is missing from the agent build manifest.",
          );
        assertDynamicModuleOutsideInitialGraphs(
          manifest,
          [key, workRouteKey],
          createFormKey,
        );
        for (const [label, suffix] of [
          ["God Mode Users", INSTANCE_USERS_COMPONENT_SUFFIX],
          ["pending-action detail", PENDING_ACTION_DETAIL_COMPONENT_SUFFIX],
        ]) {
          const componentKey = Object.keys(manifest).find((candidate) =>
            candidate.endsWith(suffix),
          );
          if (!componentKey)
            throw new Error(
              `G11 ${label} component is missing from the agent build manifest (expected a key ending in ${suffix}).`,
            );
          assertDynamicModuleOutsideInitialGraphs(
            manifest,
            [key, workRouteKey],
            componentKey,
          );
        }
        const workListAssets = new Set([
          ...measurement.assets,
          ...collectInitialAssets(manifest, workRouteKey),
        ]);
        // These lazy modules are also HTML-preloaded for a direct work visit.
        // Count their complete static closures, even though the route manifest's
        // static imports alone do not reach them.
        for (const [preloadKey, entry] of Object.entries(manifest)) {
          if (
            entry.name === "project-layout" ||
            entry.name === "work-items-panel" ||
            preloadKey.endsWith("/components/common/project-layout.tsx") ||
            preloadKey.endsWith("/components/work-item/work-items-panel.tsx") ||
            preloadKey.endsWith("/lib/i18n/group-loaders-slim.ts") ||
            preloadKey.endsWith(
              "/routes/agent/_layout/_authenticated/agent/projects/$projectKey.tsx?tsr-split=component",
            )
          ) {
            for (const asset of collectInitialAssets(manifest, preloadKey))
              workListAssets.add(asset);
          }
        }
        const slimLocaleEntries = Object.keys(manifest).filter((candidate) =>
          candidate.startsWith("virtual:taskdesk-i18n/slim-"),
        );
        // Production work visits fetch a slim locale, not the deferred full catalog.
        // Older/simple manifests without namespace groups retain full-catalog accounting.
        const localeEntries =
          slimLocaleEntries.length > 0
            ? slimLocaleEntries
            : Object.keys(manifest).filter(
                (candidate) =>
                  candidate.includes("/i18n/") && candidate.endsWith(".json"),
              );
        // i18next also fetches English fallback namespaces for non-English users.
        const fallbackLocaleKey = localeEntries.find(
          (candidate) =>
            candidate.endsWith("/slim-en-US") ||
            candidate.endsWith("/i18n/en-US.json"),
        );
        const fallbackAssets = fallbackLocaleKey
          ? collectInitialAssets(manifest, fallbackLocaleKey)
          : [];
        const localeMeasurements = await Promise.all(
          localeEntries.map(async (localeKey) => {
            const assets = [
              ...new Set([
                ...collectInitialAssets(manifest, localeKey),
                ...fallbackAssets,
              ]),
            ];
            return {
              assets,
              measurement: await measureAssets(assets, currentOutputDir),
            };
          }),
        );
        const largestLocale = localeMeasurements.sort(
          (left, right) => right.measurement.bytes - left.measurement.bytes,
        )[0];
        for (const asset of largestLocale?.assets ?? [])
          workListAssets.add(asset);
        const workListMeasurement = await measureAssets(
          [...workListAssets],
          currentOutputDir,
        );
        results.push({
          role: "agent-work-list",
          bytes: workListMeasurement.bytes,
          limit: BUDGETS_KB["agent-work-list"] * KB_BYTES,
          assets: workListMeasurement.assets,
        });
      }
    }
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
      const label =
        result.role === "agent-work-list"
          ? "agent work-list initial route graph"
          : `${result.role} initial bundle`;
      console.log(
        `G11 ${label}: ${size} KB gzip / ${budget} KB budget (${result.assets.length} assets)`,
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
