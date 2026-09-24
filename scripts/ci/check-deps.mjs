#!/usr/bin/env node
/**
 * check:deps — enforce the workspace dependency graph and documented package boundaries.
 *
 * Runtime workspace edges come from package manifests so a cycle cannot hide in an
 * import path that the source scanner missed. Source imports are inspected for documented
 * cross-package boundaries. See docs/01-architecture/monorepo-layout.md#package-boundaries.
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { finish, repoRoot, violation, walk } from "./lib/repo.mjs";

const NAME = "check:deps";
const PURE_LEAF_PACKAGES = new Set([
  "@taskdesk/domain",
  "@taskdesk/permissions",
  "@taskdesk/plugins-contracts",
]);
const DOMAIN_ALLOWED_NODE_BUILTINS = new Set(["node:crypto"]);
const UI_RUNTIME_IMPORTS = new Set([
  "@base-ui/react",
  "class-variance-authority",
  "clsx",
  "lucide-react",
  "react",
  "tailwind-merge",
]);
const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];
const IMPORT_SPECIFIER =
  /\b(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)["']([^"']+)["']/g;

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== "..")
  );
}

async function listWorkspaceManifests(root) {
  const manifests = [];
  for (const top of ["apps", "packages"]) {
    const topPath = path.join(root, top);
    let entries;
    try {
      entries = await fs.readdir(topPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(topPath, entry.name, "package.json");
      try {
        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        if (typeof manifest.name === "string") {
          manifests.push({
            name: manifest.name,
            path: path.dirname(manifestPath),
            manifest,
            manifestPath,
          });
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  return manifests.sort((a, b) => a.name.localeCompare(b.name));
}

function workspaceNameForSpecifier(specifier) {
  if (!specifier.startsWith("@taskdesk/")) return null;
  return specifier.split("/").slice(0, 2).join("/");
}

function packageNameForSpecifier(specifier) {
  if (specifier.startsWith(".")) return null;
  if (specifier.startsWith("node:")) return specifier;
  return specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
}

function isTestSource(relativeFile) {
  return /(?:^|\/)(?:__tests__\/|tests?\/|[^/]+\.(?:test|spec)\.[^.]+$)/.test(
    relativeFile,
  );
}

function runtimeWorkspaceEdges(manifests) {
  const names = new Set(manifests.map(({ name }) => name));
  return new Map(
    manifests.map(({ name, manifest }) => {
      const dependencies = {
        ...manifest.dependencies,
        ...manifest.optionalDependencies,
        ...manifest.peerDependencies,
      };
      const edges = Object.entries(dependencies ?? {})
        .filter(
          ([dependency, version]) =>
            names.has(dependency) && String(version).startsWith("workspace:"),
        )
        .map(([dependency]) => dependency)
        .sort();
      return [name, edges];
    }),
  );
}

function findCycles(graph) {
  const state = new Map();
  const stack = [];
  const cycles = [];
  const known = new Set();

  function visit(node) {
    const current = state.get(node) ?? 0;
    if (current === 2) return;
    if (current === 1) {
      const start = stack.indexOf(node);
      const cycle = [...stack.slice(start), node];
      const canonical = cycle.slice(0, -1);
      const rotations = canonical.map((_, index) => [
        ...canonical.slice(index),
        ...canonical.slice(0, index),
      ]);
      const key = rotations.map((rotation) => rotation.join(" -> ")).sort()[0];
      if (!known.has(key)) {
        known.add(key);
        cycles.push(cycle);
      }
      return;
    }
    state.set(node, 1);
    stack.push(node);
    for (const dependency of graph.get(node) ?? []) visit(dependency);
    stack.pop();
    state.set(node, 2);
  }

  for (const node of [...graph.keys()].sort()) visit(node);
  return cycles;
}

function sourceImports(source) {
  const imports = [];
  for (const match of source.matchAll(IMPORT_SPECIFIER)) {
    const before = source.slice(0, match.index);
    const line = source.slice(0, match.index).split("\n").length;
    const declaration = [...before.matchAll(/\b(?:import|export)\b/g)].at(-1);
    const beginsRuntimeCall = /^(?:import|require)\s*\(/.test(match[0]);
    const typeOnly =
      !beginsRuntimeCall &&
      declaration !== undefined &&
      /^(?:import|export)\s+type\b/.test(before.slice(declaration.index));
    imports.push({ specifier: match[1], line, typeOnly });
  }
  return imports;
}

async function sourceFilesUnder(root) {
  return walk(root, (file) => SOURCE_EXTENSIONS.includes(path.extname(file)));
}

async function listSourceFiles(root) {
  const files = [];
  for (const top of ["apps", "packages"]) {
    const topPath = path.join(root, top);
    let entries;
    try {
      entries = await fs.readdir(topPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory())
        files.push(...(await sourceFilesUnder(path.join(topPath, entry.name))));
    }
  }
  return files;
}

function resolveWorkspaceTarget(specifier, file, workspaceByName, root) {
  const workspaceName = workspaceNameForSpecifier(specifier);
  if (workspaceName && workspaceByName.has(workspaceName)) {
    return workspaceByName.get(workspaceName).path;
  }
  if (
    specifier.startsWith("@/") &&
    file.includes(`${path.sep}apps${path.sep}web${path.sep}`)
  ) {
    const webRoot = path.join(root, "apps/web");
    return path.resolve(webRoot, "src", specifier.slice(2));
  }
  if (
    specifier.startsWith("@i18n/") &&
    file.includes(`${path.sep}apps${path.sep}web${path.sep}`)
  ) {
    return path.resolve(root, "i18n", specifier.slice("@i18n/".length));
  }
  if (specifier.startsWith("."))
    return path.resolve(path.dirname(file), specifier);
  return null;
}

function ownerForFile(file, manifests) {
  return manifests.find((entry) => isWithin(entry.path, file)) ?? null;
}

export async function analyzeDependencies(root = repoRoot) {
  const manifests = await listWorkspaceManifests(root);
  const manifestByName = new Map(manifests.map((entry) => [entry.name, entry]));
  const graph = runtimeWorkspaceEdges(manifests);
  const violations = [];

  for (const cycle of findCycles(graph)) {
    violations.push(
      violation(
        "workspace dependency graph",
        `runtime workspace dependency cycle: ${cycle.join(" -> ")}`,
      ),
    );
  }

  for (const { name, manifest } of manifests) {
    if (PURE_LEAF_PACKAGES.has(name)) {
      for (const dependency of graph.get(name) ?? []) {
        violations.push(
          violation(
            name,
            `runtime workspace dependency "${dependency}" breaks the documented pure-leaf boundary`,
          ),
        );
      }
    }
    if (name === "@taskdesk/domain") {
      for (const dependency of Object.keys(manifest.dependencies ?? {})) {
        violations.push(
          violation(
            `${name}/package.json`,
            `runtime dependency "${dependency}" is outside the domain package's explicit pure-runtime allowlist`,
          ),
        );
      }
    }
    if (name === "@taskdesk/ui") {
      for (const dependency of Object.keys(manifest.dependencies ?? {})) {
        if (!UI_RUNTIME_IMPORTS.has(dependency)) {
          violations.push(
            violation(
              `${name}/package.json`,
              `runtime dependency "${dependency}" is outside the documented design-system boundary`,
            ),
          );
        }
      }
    }
  }

  const files = await listSourceFiles(root);
  for (const file of files) {
    const owner = ownerForFile(file, manifests);
    if (!owner) continue;
    const text = await fs.readFile(file, "utf8");
    const imports = sourceImports(text);
    const relativeFile = path.relative(root, file).split(path.sep).join("/");

    for (const imported of imports) {
      const targetPath = resolveWorkspaceTarget(
        imported.specifier,
        file,
        manifestByName,
        root,
      );
      const targetWorkspace = workspaceNameForSpecifier(imported.specifier);
      const targetEntry = targetWorkspace
        ? manifestByName.get(targetWorkspace)
        : null;
      const pointsToApp =
        (targetEntry &&
          isWithin(path.join(root, "apps"), targetEntry.path) &&
          targetEntry.name !== owner.name) ||
        (targetPath &&
          isWithin(path.join(root, "apps"), targetPath) &&
          !isWithin(owner.path, targetPath));
      const pointsOutOfUi =
        owner.name === "@taskdesk/ui" &&
        targetPath &&
        !isWithin(owner.path, targetPath);
      const pointsOutOfDomain =
        owner.name === "@taskdesk/domain" &&
        targetPath &&
        !isWithin(owner.path, targetPath);
      const isLibsTypeContract =
        owner.name === "@taskdesk/libs" &&
        imported.typeOnly &&
        targetWorkspace === "@taskdesk/api";

      if (pointsToApp && !isLibsTypeContract) {
        violations.push(
          violation(
            relativeFile,
            `line ${imported.line} imports "${imported.specifier}" from apps/**; application imports are forbidden except the typed @taskdesk/libs contract (docs/01-architecture/monorepo-layout.md#package-boundaries)`,
          ),
        );
      }
      if (pointsOutOfUi) {
        violations.push(
          violation(
            relativeFile,
            `line ${imported.line} imports "${imported.specifier}" outside packages/ui; the design system must not depend on application or feature code`,
          ),
        );
      }
      if (pointsOutOfDomain) {
        violations.push(
          violation(
            relativeFile,
            `line ${imported.line} imports "${imported.specifier}" outside packages/domain; domain code must remain a pure leaf`,
          ),
        );
      }
      if (
        owner.name === "@taskdesk/web" &&
        targetWorkspace === "@taskdesk/api"
      ) {
        violations.push(
          violation(
            relativeFile,
            `line ${imported.line} imports "${imported.specifier}" directly from apps/api; use the typed client boundary in packages/libs`,
          ),
        );
      }
      if (PURE_LEAF_PACKAGES.has(owner.name) && targetWorkspace) {
        violations.push(
          violation(
            relativeFile,
            `line ${imported.line} imports workspace package "${imported.specifier}"; ${owner.name} is a documented pure leaf package`,
          ),
        );
      }
      if (
        owner.name === "@taskdesk/domain" &&
        !isTestSource(relativeFile) &&
        !/\.config\.[^.]+$/.test(relativeFile) &&
        !imported.specifier.startsWith(".") &&
        !DOMAIN_ALLOWED_NODE_BUILTINS.has(imported.specifier)
      ) {
        violations.push(
          violation(
            relativeFile,
            `line ${imported.line} imports I/O or server module "${imported.specifier}"; packages/domain is pure and has no I/O`,
          ),
        );
      }
      if (
        owner.name === "@taskdesk/ui" &&
        !isTestSource(relativeFile) &&
        !relativeFile.includes("/.storybook/") &&
        !/\.config\.[^.]+$/.test(relativeFile) &&
        !/\.stories\.[^.]+$/.test(relativeFile)
      ) {
        const importedPackage = packageNameForSpecifier(imported.specifier);
        if (importedPackage && !UI_RUNTIME_IMPORTS.has(importedPackage)) {
          violations.push(
            violation(
              relativeFile,
              `line ${imported.line} imports runtime dependency "${importedPackage}" outside the documented packages/ui boundary (React, Base UI, and design-system utilities)`,
            ),
          );
        }
      }
    }
  }

  return { files, manifests, graph, cycles: findCycles(graph), violations };
}

async function main() {
  const { files, manifests, violations } = await analyzeDependencies();
  finish({
    name: NAME,
    failures: violations,
    ok: `${manifests.length} workspace packages/apps and ${files.length} source files; runtime workspace graph is acyclic and package boundaries hold`,
  });
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) await main();

export {
  findCycles,
  runtimeWorkspaceEdges,
  sourceImports,
  workspaceNameForSpecifier,
};
