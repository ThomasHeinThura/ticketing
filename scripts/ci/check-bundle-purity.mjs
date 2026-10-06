#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const PORTAL_ROOT = path.join(ROOT, "apps/web/dist/portal");

function normalizedModuleId(value) {
  return value.replaceAll("\\", "/").split("?")[0];
}

export function findPortalModuleViolations(graph) {
  if (graph?.version !== 1 || !Array.isArray(graph.chunks))
    throw new Error("Portal module graph metadata is missing or unsupported.");
  const byFile = new Map(graph.chunks.map((chunk) => [chunk.file, chunk]));
  const entries = graph.chunks.filter((chunk) => chunk.isEntry);
  // The plugin metadata deliberately does not infer entry status. The HTML entry
  // is the only JS entry reachable from the portal root, so use the manifest's
  // `index.html` record to identify it in the caller and pass its output file.
  const visited = new Set();
  const visit = (file) => {
    if (visited.has(file)) return;
    const chunk = byFile.get(file);
    if (!chunk)
      throw new Error(`Portal module graph references missing chunk ${file}.`);
    visited.add(file);
    for (const imported of [
      ...(chunk.imports ?? []),
      ...(chunk.dynamicImports ?? []),
    ])
      visit(imported);
  };
  if (entries.length !== 1)
    throw new Error(
      "Portal module graph must contain exactly one manifest-declared entry.",
    );
  visit(entries[0].file);
  const violations = [];
  for (const file of visited) {
    const chunk = byFile.get(file);
    for (const rawId of chunk.modules ?? []) {
      const id = normalizedModuleId(rawId);
      if (
        /(?:^|\/)routes\/agent\//u.test(id) ||
        /(?:^|\/)components\/god-mode\//u.test(id)
      )
        violations.push({ file, module: rawId });
    }
  }
  return violations;
}

export async function checkBundlePurity({
  graphPath = path.join(PORTAL_ROOT, ".vite/module-graph.json"),
  manifestPath = path.join(PORTAL_ROOT, ".vite/manifest.json"),
} = {}) {
  const [graph, manifest] = await Promise.all([
    readFile(graphPath, "utf8").then(JSON.parse),
    readFile(manifestPath, "utf8").then(JSON.parse),
  ]);
  const entry = manifest["index.html"];
  if (!entry?.isEntry || !entry.file)
    throw new Error("Portal Vite manifest is missing its index.html entry.");
  const graphEntry = graph.chunks.find((chunk) => chunk.file === entry.file);
  if (!graphEntry)
    throw new Error(
      `Portal graph is missing its manifest entry ${entry.file}.`,
    );
  graphEntry.isEntry = true;
  const violations = findPortalModuleViolations(graph);
  if (violations.length)
    throw new Error(
      `G12 portal graph contains forbidden agent modules: ${violations.map(({ module }) => module).join(", ")}`,
    );
  return graph.chunks.filter((chunk) => chunk.isEntry).length;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const count = await checkBundlePurity();
    console.log(
      `G12 portal bundle graph is clean (${count} entry, static and dynamic imports checked).`,
    );
  } catch (error) {
    console.error(
      `check:bundle-purity: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
