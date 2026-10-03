#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./lib/repo.mjs";
import {
  expectedRouteMetadata,
  METADATA_PATH,
  renderRouteMetadata,
} from "./lib/route-metadata.mjs";

const inventoryPath = "docs/02-design/screen-inventory.md";
const routeRegistryPath = "apps/web/src/lib/routes.ts";

export function canonicalRoute(value) {
  return (
    value
      .split("?")[0]
      .replace(/\$[A-Za-z0-9_]+/gu, "{}")
      .replace(/\{[^}]+\}/gu, "{}")
      .replace(/\/$/u, "") || "/"
  );
}

export function inventoryRouteSet(source, { activeOnly = false } = {}) {
  const routes = new Set();
  for (const line of source.split(/\r?\n/u)) {
    const columns = line.split("|").map((cell) => cell.trim());
    if (columns[3] !== "route") continue;
    if (activeOnly && !["🟡", "✅"].includes(columns[5])) continue;
    const match = /^`([^`]+)`$/u.exec(columns[2] ?? "");
    if (match && match[1] !== "*") routes.add(canonicalRoute(match[1]));
  }
  return routes;
}

export async function checkInventory(root = repoRoot) {
  const metadata = await expectedRouteMetadata(root);
  const expected = renderRouteMetadata(metadata);
  const [actual, inventory, routeRegistry] = await Promise.all([
    readFile(path.join(root, METADATA_PATH), "utf8"),
    readFile(path.join(root, inventoryPath), "utf8"),
    readFile(path.join(root, routeRegistryPath), "utf8"),
  ]);
  const failures = [];
  if (actual !== expected)
    failures.push(
      `${METADATA_PATH} is stale; run pnpm generate:route-metadata after the router generators.`,
    );
  if (
    !routeRegistry.includes(
      'export { generatedRouteMetadata } from "./generated-route-metadata";',
    )
  )
    failures.push(
      `${routeRegistryPath} must expose the generated route metadata as the G5 registry.`,
    );
  const declaredCount = Number(
    /\| \*\*Total\*\* \| \*\*(\d+)\*\*/u.exec(inventory)?.[1],
  );
  const inventoryRows = inventory.split(/\r?\n/u).filter((line) => {
    const columns = line.split("|").map((cell) => cell.trim());
    return ["route", "section", "overlay", "dialog"].includes(columns[3]);
  });
  if (!Number.isFinite(declaredCount) || declaredCount !== inventoryRows.length)
    failures.push(
      `Screen inventory total ${declaredCount || "missing"} does not match ${inventoryRows.length} screen rows.`,
    );
  const documented = inventoryRouteSet(inventory, { activeOnly: true });
  const allDocumented = inventoryRouteSet(inventory);
  const generated = new Set(Object.values(metadata).flat().map(canonicalRoute));
  const activeUnbuilt = [...documented].filter(
    (route) => !generated.has(route),
  );
  if (activeUnbuilt.length)
    failures.push(
      `In-progress or complete inventory route(s) missing from the generated agent/portal trees: ${activeUnbuilt.join(", ")}`,
    );
  return {
    failures,
    generatedRouteCount: generated.size,
    activeInventoryRouteCount: documented.size,
    plannedInventoryRouteCount: allDocumented.size - documented.size,
    generatedLegacyOrUnlistedCount: [...generated].filter(
      (route) => !documented.has(route),
    ).length,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await checkInventory();
    for (const failure of result.failures)
      console.error(`check:inventory: ${failure}`);
    if (result.failures.length) process.exitCode = 1;
    else
      console.log(
        `G5 metadata matches ${result.generatedRouteCount} canonical generated routes; all ${result.activeInventoryRouteCount} in-progress or complete inventory routes exist in those trees. ${result.plannedInventoryRouteCount} planned route URLs remain unimplemented, and ${result.generatedLegacyOrUnlistedCount} generated routes are inherited or otherwise outside the active v2 inventory.`,
      );
  } catch (error) {
    console.error(
      `check:inventory: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
