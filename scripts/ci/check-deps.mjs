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
import {
  createScanner,
  LanguageVariant,
  SyntaxKind,
} from "typescript/unstable/ast";
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
const DYNAMIC_SPECIFIER = "<non-static module specifier>";

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
  const scanner = createScanner(
    true,
    LanguageVariant.JSX,
    source,
    0,
    source.length,
  );
  const tokens = [];
  const templateBraceDepths = [];
  let previousTokenStart = -1;
  for (let scanned = 0; scanned <= source.length + 1; scanned += 1) {
    let kind = scanner.scan();
    if (kind === SyntaxKind.CloseBraceToken && templateBraceDepths.length > 0) {
      const depth = templateBraceDepths.at(-1) - 1;
      templateBraceDepths[templateBraceDepths.length - 1] = depth;
      if (depth === 0) {
        kind = scanner.reScanTemplateToken(false);
        if (kind === SyntaxKind.TemplateTail) templateBraceDepths.pop();
        else if (kind === SyntaxKind.TemplateMiddle)
          templateBraceDepths[templateBraceDepths.length - 1] = 1;
      }
    } else if (
      kind === SyntaxKind.OpenBraceToken &&
      templateBraceDepths.length > 0
    ) {
      templateBraceDepths[templateBraceDepths.length - 1] += 1;
    } else if (
      kind === SyntaxKind.TemplateHead ||
      kind === SyntaxKind.TemplateMiddle
    ) {
      templateBraceDepths.push(1);
    }
    if (kind === SyntaxKind.EndOfFile) break;
    const tokenStart = scanner.getTokenStart();
    if (tokenStart === previousTokenStart) break;
    previousTokenStart = tokenStart;
    tokens.push({
      kind,
      value: scanner.getTokenValue(),
      text: scanner.getTokenText(),
      start: tokenStart,
    });
    if (scanned === source.length + 1) {
      imports.push({ specifier: DYNAMIC_SPECIFIER, line: 1, typeOnly: false });
      break;
    }
  }

  const lineAt = (position) => source.slice(0, position).split("\n").length;
  const addLiteral = (token, typeOnly = false) =>
    imports.push({
      specifier: token.value,
      line: lineAt(token.start),
      typeOnly,
    });
  const isString = (token) =>
    token?.kind === SyntaxKind.StringLiteral ||
    token?.kind === SyntaxKind.NoSubstitutionTemplateLiteral;
  const keyword = (token, name) =>
    token?.kind ===
      SyntaxKind[`${name[0].toUpperCase()}${name.slice(1)}Keyword`] ||
    (token?.kind === SyntaxKind.Identifier && token.text === name);
  const isTypeOnlyImportDeclaration = (index) => {
    if (!keyword(tokens[index + 1], "type")) return false;
    return [
      SyntaxKind.OpenBraceToken,
      SyntaxKind.AsteriskToken,
      SyntaxKind.Identifier,
    ].includes(tokens[index + 2]?.kind);
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (keyword(token, "import") || keyword(token, "require")) {
      const call = next?.kind === SyntaxKind.OpenParenToken;
      if (call) {
        const argument = tokens[index + 2];
        const afterArgument = tokens[index + 3];
        const completeFirstArgument =
          afterArgument?.kind === SyntaxKind.CloseParenToken ||
          (keyword(token, "import") &&
            afterArgument?.kind === SyntaxKind.CommaToken);
        if (isString(argument) && completeFirstArgument) addLiteral(argument);
        else
          imports.push({
            specifier: DYNAMIC_SPECIFIER,
            line: lineAt(token.start),
            typeOnly: false,
          });
        continue;
      }
      if (keyword(token, "require")) continue;
      if (isString(next)) {
        addLiteral(next);
        continue;
      }
      const typeOnly = isTypeOnlyImportDeclaration(index);
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        if (tokens[cursor].kind === SyntaxKind.SemicolonToken) break;
        if (keyword(tokens[cursor], "from")) {
          const specifier = tokens[cursor + 1];
          if (isString(specifier)) addLiteral(specifier, typeOnly);
          else
            imports.push({
              specifier: DYNAMIC_SPECIFIER,
              line: lineAt(token.start),
              typeOnly,
            });
          break;
        }
        if (
          cursor > index + 1 &&
          lineAt(tokens[cursor].start) > lineAt(tokens[cursor - 1].start) &&
          [SyntaxKind.ImportKeyword, SyntaxKind.ExportKeyword].includes(
            tokens[cursor].kind,
          )
        )
          break;
      }
      continue;
    }
    if (keyword(token, "export")) {
      const typeOnly =
        keyword(next, "type") &&
        (tokens[index + 2]?.kind === SyntaxKind.OpenBraceToken ||
          tokens[index + 2]?.kind === SyntaxKind.AsteriskToken);
      const binding = typeOnly ? tokens[index + 2] : next;
      if (
        binding?.kind !== SyntaxKind.OpenBraceToken &&
        binding?.kind !== SyntaxKind.AsteriskToken
      )
        continue;
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        if (tokens[cursor].kind === SyntaxKind.SemicolonToken) break;
        if (keyword(tokens[cursor], "from")) {
          const specifier = tokens[cursor + 1];
          if (isString(specifier)) addLiteral(specifier, typeOnly);
          else
            imports.push({
              specifier: DYNAMIC_SPECIFIER,
              line: lineAt(token.start),
              typeOnly,
            });
          break;
        }
        if (
          lineAt(tokens[cursor].start) > lineAt(tokens[cursor - 1].start) &&
          [SyntaxKind.ImportKeyword, SyntaxKind.ExportKeyword].includes(
            tokens[cursor].kind,
          )
        )
          break;
      }
    }
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
      if (imported.specifier === DYNAMIC_SPECIFIER) {
        violations.push(
          violation(
            relativeFile,
            `line ${imported.line} uses a non-static module specifier; package boundaries cannot be proven`,
          ),
        );
        continue;
      }
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
