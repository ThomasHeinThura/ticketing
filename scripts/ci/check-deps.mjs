#!/usr/bin/env node

/**
 * check:deps — enforce the workspace dependency graph and documented package boundaries.
 *
 * Runtime workspace edges come from package manifests so a cycle cannot hide in an
 * import path that the source scanner missed. Source imports are inspected for documented
 * cross-package boundaries. See docs/01-architecture/monorepo-layout.md#package-boundaries.
 */

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import * as ts from "typescript/unstable/ast";
import * as tsIs from "typescript/unstable/ast/is";
import { API } from "typescript/unstable/sync";
import { finish, repoRoot, violation } from "./lib/repo.mjs";

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
const CREATE_REQUIRE_ALLOWLIST = new Map([
  ["packages/mcp/src/server.ts", "../package.json"],
]);
const WORKSPACE_EDGES = new Map([
  [
    "@taskdesk/web",
    new Set(["@taskdesk/ui", "@taskdesk/libs", "@taskdesk/permissions"]),
  ],
  [
    "@taskdesk/api",
    new Set([
      "@taskdesk/domain",
      "@taskdesk/permissions",
      "@taskdesk/plugins-contracts",
      "@taskdesk/email",
      "@taskdesk/libs",
      "@taskdesk/importers",
    ]),
  ],
  ["@taskdesk/domain", new Set()],
  ["@taskdesk/permissions", new Set()],
  ["@taskdesk/plugins-contracts", new Set()],
  ["@taskdesk/ui", new Set()],
  ["@taskdesk/libs", new Set()],
  ["@taskdesk/email", new Set()],
  ["@taskdesk/mcp", new Set()],
  ["@taskdesk/importers", new Set()],
  ["@taskdesk/typescript-config", new Set()],
]);

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
        .filter(([, version]) => String(version).startsWith("workspace:"))
        .map(([dependency, version]) => {
          const alias = String(version).match(
            /^workspace:(@[^/]+\/[^@]+|[^@]+)@/,
          );
          return alias?.[1] ?? dependency;
        })
        .filter((dependency) => names.has(dependency))
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

function sourceImports(file, diagnostics = [], relativeFile = "") {
  const imports = [];
  if (diagnostics.length)
    throw new SyntaxError(
      `TypeScript parse failed: ${diagnostics.map((d) => d.messageText).join("; ")}`,
    );
  const lineAt = (node) =>
    file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const literal = (node) =>
    node &&
    [
      ts.SyntaxKind.StringLiteral,
      ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ].includes(node.kind)
      ? node.text
      : undefined;
  const add = (node, typeOnly = false) =>
    imports.push({
      specifier: literal(node) ?? DYNAMIC_SPECIFIER,
      line: lineAt(node),
      typeOnly,
      node,
    });
  const allowedRequireSpecifier = CREATE_REQUIRE_ALLOWLIST.get(relativeFile);
  const factoryBindings = new Set();
  const moduleBindings = new Set();
  const loaderBindings = new Set();
  function isCreateRequireExpression(expr) {
    return (
      (tsIs.isIdentifier(expr) && factoryBindings.has(expr.text)) ||
      (expr.kind === ts.SyntaxKind.PropertyAccessExpression &&
        expr.name.text === "createRequire" &&
        tsIs.isIdentifier(expr.expression) &&
        moduleBindings.has(expr.expression.text))
    );
  }
  function visitBindings(node) {
    if (
      node.kind === ts.SyntaxKind.ImportDeclaration &&
      literal(node.moduleSpecifier) &&
      ["module", "node:module"].includes(literal(node.moduleSpecifier))
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings?.kind === ts.SyntaxKind.NamespaceImport)
        moduleBindings.add(bindings.name.text);
      if (node.importClause?.name)
        moduleBindings.add(node.importClause.name.text);
      if (bindings?.kind === ts.SyntaxKind.NamedImports) {
        for (const element of bindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (imported === "createRequire")
            factoryBindings.add(element.name.text);
          if (imported === "default") moduleBindings.add(element.name.text);
        }
      }
    }
    if (
      node.kind === ts.SyntaxKind.VariableDeclaration &&
      tsIs.isIdentifier(node.name) &&
      node.initializer
    ) {
      const initializer = node.initializer;
      if (isCreateRequireExpression(initializer))
        factoryBindings.add(node.name.text);
      else if (
        initializer.kind === ts.SyntaxKind.CallExpression &&
        isCreateRequireExpression(initializer.expression)
      ) {
        // A createRequire result is a loader; the call is checked separately below.
        loaderBindings.add(node.name.text);
      } else if (
        tsIs.isIdentifier(initializer) &&
        (factoryBindings.has(initializer.text) ||
          loaderBindings.has(initializer.text))
      ) {
        (factoryBindings.has(initializer.text)
          ? factoryBindings
          : loaderBindings
        ).add(node.name.text);
      }
    }
    node.forEachChild(visitBindings);
  }
  visitBindings(file);
  function constantString(node) {
    if (literal(node) !== undefined) return literal(node);
    if (
      node?.kind === ts.SyntaxKind.BinaryExpression &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      const left = constantString(node.left);
      const right = constantString(node.right);
      return left !== undefined && right !== undefined
        ? left + right
        : undefined;
    }
    return undefined;
  }
  function visit(node) {
    const kind = node.kind;
    if (
      kind === ts.SyntaxKind.ImportDeclaration ||
      kind === ts.SyntaxKind.ExportDeclaration
    ) {
      if (node.moduleSpecifier)
        add(
          node.moduleSpecifier,
          kind === ts.SyntaxKind.ImportDeclaration
            ? Boolean(node.importClause?.isTypeOnly)
            : Boolean(node.isTypeOnly),
        );
    } else if (kind === ts.SyntaxKind.ImportEqualsDeclaration) {
      if (node.moduleReference?.kind === ts.SyntaxKind.ExternalModuleReference)
        add(node.moduleReference.expression);
    } else if (kind === ts.SyntaxKind.CallExpression) {
      const expr = node.expression;
      const isImport = expr.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = tsIs.isIdentifier(expr) && expr.text === "require";
      const isModuleRequire =
        expr.kind === ts.SyntaxKind.PropertyAccessExpression &&
        expr.name.text === "require" &&
        ["module", "process.mainModule"].includes(
          expr.expression.getText(file),
        );
      const isRequireResolve =
        expr.kind === ts.SyntaxKind.PropertyAccessExpression &&
        expr.name.text === "resolve" &&
        tsIs.isIdentifier(expr.expression) &&
        expr.expression.text === "require";
      const isImportMetaResolve =
        expr.kind === ts.SyntaxKind.PropertyAccessExpression &&
        expr.name.text === "resolve" &&
        expr.expression.kind === ts.SyntaxKind.MetaProperty &&
        expr.expression.keywordToken === ts.SyntaxKind.ImportKeyword;
      const isGlobalRequire =
        (expr.kind === ts.SyntaxKind.PropertyAccessExpression &&
          expr.name.text === "require" &&
          expr.expression.getText(file) === "globalThis") ||
        (expr.kind === ts.SyntaxKind.ElementAccessExpression &&
          expr.expression.getText(file) === "globalThis" &&
          constantString(expr.argumentExpression) === "require");
      const isCreateRequire = isCreateRequireExpression(expr);
      const isCreatedLoader =
        tsIs.isIdentifier(expr) && loaderBindings.has(expr.text);
      if (isCreateRequire) {
        const parent = node.parent;
        const variable =
          parent?.kind === ts.SyntaxKind.VariableDeclaration &&
          parent.initializer === node
            ? parent
            : null;
        const permitted =
          allowedRequireSpecifier &&
          variable &&
          variable.name.text === "require" &&
          node.arguments.length === 1 &&
          node.arguments[0]?.kind === ts.SyntaxKind.PropertyAccessExpression &&
          node.arguments[0].expression.kind === ts.SyntaxKind.MetaProperty &&
          node.arguments[0].expression.keywordToken ===
            ts.SyntaxKind.ImportKeyword &&
          node.arguments[0].name.text === "url";
        if (!permitted)
          imports.push({
            specifier: "<createRequire>",
            line: lineAt(node),
            typeOnly: false,
            node,
          });
      }
      if (
        isImport ||
        isRequire ||
        isModuleRequire ||
        isRequireResolve ||
        isImportMetaResolve ||
        isGlobalRequire ||
        isCreatedLoader
      )
        add(node.arguments[0]);
      if (
        isCreatedLoader &&
        allowedRequireSpecifier &&
        constantString(node.arguments[0]) !== allowedRequireSpecifier
      ) {
        imports.push({
          specifier: DYNAMIC_SPECIFIER,
          line: lineAt(node),
          typeOnly: false,
          node,
        });
      }
    } else if (
      kind === ts.SyntaxKind.PropertyAccessExpression ||
      kind === ts.SyntaxKind.ElementAccessExpression
    ) {
      const parent = node.parent;
      const isDirectCall =
        parent?.kind === ts.SyntaxKind.CallExpression &&
        parent.expression === node;
      const property =
        kind === ts.SyntaxKind.PropertyAccessExpression
          ? node.name.text
          : constantString(node.argumentExpression);
      const receiver = node.expression.getText(file);
      const isLoaderMember =
        property === "require" &&
        ["module", "process.mainModule", "globalThis"].includes(receiver);
      const isRequireResolver =
        property === "resolve" && receiver === "require";
      const isDetachedCreateRequire =
        property === "createRequire" && moduleBindings.has(receiver);
      if (
        !isDirectCall &&
        (isLoaderMember || isRequireResolver || isDetachedCreateRequire)
      )
        imports.push({
          specifier: isDetachedCreateRequire
            ? "<createRequire>"
            : DYNAMIC_SPECIFIER,
          line: lineAt(node),
          typeOnly: false,
          node,
        });
    } else if (tsIs.isIdentifier(node) && node.text === "require") {
      const parent = node.parent;
      const directCall =
        parent?.kind === ts.SyntaxKind.CallExpression &&
        parent.expression === node;
      const propertyName =
        (parent?.kind === ts.SyntaxKind.PropertyAccessExpression &&
          parent.name === node) ||
        (parent?.kind === ts.SyntaxKind.PropertyAssignment &&
          parent.name === node) ||
        (parent?.kind === ts.SyntaxKind.MethodDeclaration &&
          parent.name === node);
      const createRequireBinding =
        allowedRequireSpecifier &&
        parent?.kind === ts.SyntaxKind.VariableDeclaration &&
        parent.name === node &&
        parent.initializer?.kind === ts.SyntaxKind.CallExpression &&
        parent.initializer.expression.getText(file) === "createRequire";
      if (!directCall && !propertyName && !createRequireBinding)
        imports.push({
          specifier: DYNAMIC_SPECIFIER,
          line: lineAt(node),
          typeOnly: false,
          node,
        });
    } else if (tsIs.isIdentifier(node) && factoryBindings.has(node.text)) {
      const parent = node.parent;
      const importBinding = parent?.kind === ts.SyntaxKind.ImportSpecifier;
      const directCall =
        parent?.kind === ts.SyntaxKind.CallExpression &&
        parent.expression === node;
      if (!importBinding && !directCall)
        imports.push({
          specifier: "<createRequire>",
          line: lineAt(node),
          typeOnly: false,
          node,
        });
    }
    if (
      kind === ts.SyntaxKind.ImportDeclaration &&
      node.moduleSpecifier &&
      literal(node.moduleSpecifier) &&
      ["module", "node:module"].includes(literal(node.moduleSpecifier)) &&
      node.importClause?.namedBindings?.kind === ts.SyntaxKind.NamedImports &&
      node.importClause.namedBindings.elements.some(
        (element) =>
          (element.propertyName ?? element.name).text === "createRequire",
      ) &&
      !allowedRequireSpecifier
    ) {
      imports.push({
        specifier: "<createRequire>",
        line: lineAt(node),
        typeOnly: false,
        node,
      });
    }
    node.forEachChild(visit);
  }
  visit(file);
  return imports;
}

async function listSourceFiles(root, manifests) {
  const files = [];
  const violations = [];
  async function walkSource(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        violations.push(
          violation(
            path.relative(root, absolute).split(path.sep).join("/"),
            "symbolic links under workspace src are rejected because their target cannot be proven by this gate",
          ),
        );
      } else if (entry.isDirectory()) await walkSource(absolute);
      else if (
        entry.isFile() &&
        SOURCE_EXTENSIONS.includes(path.extname(entry.name))
      )
        files.push(absolute);
    }
  }
  for (const manifest of manifests)
    await walkSource(path.join(manifest.path, "src"));
  return { files: files.sort(), violations };
}

function workspaceTargetForSpecifier(
  specifier,
  owner,
  manifests,
  seen = new Set(),
) {
  const directName = workspaceNameForSpecifier(specifier);
  if (directName && manifests.has(directName))
    return {
      entry: manifests.get(directName),
      subpath: specifier.slice(directName.length).replace(/^\//, ""),
    };
  const dependencies = {
    ...owner.manifest.dependencies,
    ...owner.manifest.optionalDependencies,
    ...owner.manifest.peerDependencies,
  };
  for (const [key, value] of Object.entries(dependencies)) {
    if (specifier !== key && !specifier.startsWith(`${key}/`)) continue;
    const alias = String(value).match(/^workspace:(@[^/]+\/[^@]+|[^@]+)@/);
    const targetName = alias?.[1] ?? key;
    if (manifests.has(targetName))
      return {
        entry: manifests.get(targetName),
        subpath: specifier === key ? "" : specifier.slice(key.length + 1),
      };
  }
  const imports = owner.manifest.imports ?? {};
  for (const [key, value] of Object.entries(imports)) {
    if (
      specifier !== key &&
      !(key.endsWith("*") && specifier.startsWith(key.slice(0, -1)))
    )
      continue;
    const resolved =
      typeof value === "string"
        ? value
        : (value?.default ?? value?.import ?? value?.node);
    if (typeof resolved !== "string") return null;
    const replacement = key.endsWith("*")
      ? specifier.slice(key.slice(0, -1).length)
      : "";
    const mapped = resolved.replaceAll("*", replacement);
    if (seen.has(mapped)) return null;
    const resolvedTarget = workspaceTargetForSpecifier(
      mapped,
      owner,
      manifests,
      new Set([...seen, specifier]),
    );
    return resolvedTarget ?? { absolute: path.resolve(owner.path, mapped) };
  }
  return null;
}

function resolveAsFile(base) {
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...SOURCE_EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
  ];
  return candidates.find((candidate) => existsSync(candidate))
    ? path.resolve(candidates.find((candidate) => existsSync(candidate)))
    : null;
}

function configFilesFor(manifests) {
  const files = [];
  for (const { path: directory } of manifests) {
    for (const name of [
      "vite.config.ts",
      "vite.config.js",
      "vitest.config.ts",
      "vitest.integration.config.ts",
      "vitest.permissions.config.ts",
    ]) {
      const candidate = path.join(directory, name);
      if (existsSync(candidate)) files.push(candidate);
    }
  }
  return files;
}

function configuredAliases(configFiles, snapshot, root, manifests) {
  const aliases = new Map();
  const violations = [];
  for (const config of configFiles) {
    const relative = path.relative(root, config).split(path.sep).join("/");
    const configOwner = ownerForFile(config, manifests);
    if (!configOwner) continue;
    const ownerAliases = aliases.get(configOwner.name) ?? new Map();
    aliases.set(configOwner.name, ownerAliases);
    const project = snapshot.getDefaultProjectForFile(config);
    const file = project?.program.getSourceFile(config);
    if (!file) continue;
    const text = (node) =>
      node &&
      [
        ts.SyntaxKind.StringLiteral,
        ts.SyntaxKind.NoSubstitutionTemplateLiteral,
      ].includes(node.kind)
        ? node.text
        : undefined;
    const evaluatePath = (node) => {
      const literal = text(node);
      if (literal !== undefined)
        return path.resolve(path.dirname(config), literal);
      if (node?.kind === ts.SyntaxKind.Identifier && node.text === "__dirname")
        return path.dirname(config);
      if (
        node?.kind === ts.SyntaxKind.PropertyAccessExpression &&
        node.name.text === "dirname" &&
        node.expression.kind === ts.SyntaxKind.MetaProperty
      )
        return path.dirname(config);
      if (
        node?.kind === ts.SyntaxKind.CallExpression &&
        node.arguments.length
      ) {
        const fn = node.expression.getText(file);
        if (!/(?:^|\.)resolve$/.test(fn) && !/(?:^|\.)join$/.test(fn))
          return undefined;
        const parts = node.arguments.map((arg) => {
          if (text(arg) !== undefined) return text(arg);
          if (arg.kind === ts.SyntaxKind.Identifier && arg.text === "__dirname")
            return path.dirname(config);
          if (
            arg.kind === ts.SyntaxKind.PropertyAccessExpression &&
            arg.name.text === "dirname" &&
            arg.expression.kind === ts.SyntaxKind.MetaProperty
          )
            return path.dirname(config);
          return undefined;
        });
        if (parts.some((part) => part === undefined)) return undefined;
        return path.resolve(...parts);
      }
      return undefined;
    };
    function visit(node) {
      if (
        node.kind === ts.SyntaxKind.PropertyAssignment &&
        node.name.getText(file) === "resolve" &&
        node.initializer.kind !== ts.SyntaxKind.ObjectLiteralExpression
      ) {
        violations.push(
          violation(
            relative,
            "dynamic resolve configuration cannot be proven by the package boundary gate",
          ),
        );
      }
      if (
        node.kind === ts.SyntaxKind.PropertyAssignment &&
        node.name.getText(file) === "alias"
      ) {
        if (node.initializer.kind !== ts.SyntaxKind.ObjectLiteralExpression) {
          violations.push(
            violation(
              relative,
              "dynamic resolve.alias cannot be proven by the package boundary gate",
            ),
          );
          return;
        }
        for (const entry of node.initializer.properties) {
          if (entry.kind !== ts.SyntaxKind.PropertyAssignment) {
            violations.push(
              violation(
                relative,
                "unsupported resolve.alias entry cannot be proven by the package boundary gate",
              ),
            );
            continue;
          }
          const key =
            text(entry.name) ??
            (entry.name.kind === ts.SyntaxKind.Identifier
              ? entry.name.text
              : undefined);
          const target = evaluatePath(entry.initializer);
          if (!key || !target) {
            violations.push(
              violation(
                relative,
                "dynamic resolve.alias mapping cannot be proven by the package boundary gate",
              ),
            );
            continue;
          }
          if (ownerAliases.has(key) && ownerAliases.get(key) !== target) {
            violations.push(
              violation(
                relative,
                `ambiguous resolve.alias mapping for "${key}"`,
              ),
            );
            continue;
          }
          ownerAliases.set(key, target);
        }
      }
      node.forEachChild(visit);
    }
    visit(file);
  }
  return { aliases, violations };
}

function resolveWorkspaceTarget(
  imported,
  file,
  owner,
  workspaceByName,
  project,
  aliases,
) {
  const { specifier } = imported;
  const names = [...workspaceByName.values()];
  const aliasMatches = [...aliases]
    .filter(([key]) => specifier === key || specifier.startsWith(`${key}/`))
    .sort((a, b) => b[0].length - a[0].length);
  if (aliasMatches.length) {
    const [key, targetPath] = aliasMatches[0];
    if (
      aliasMatches.length > 1 &&
      aliasMatches[0][0].length === aliasMatches[1][0].length
    )
      return { unresolvedAlias: true };
    const resolved = path.resolve(
      targetPath,
      specifier === key ? "" : specifier.slice(key.length + 1),
    );
    const workspace = ownerForFile(resolved, names);
    return { workspace, file: resolveAsFile(resolved) ?? resolved };
  }
  const packageTarget = workspaceTargetForSpecifier(
    specifier,
    owner,
    workspaceByName,
  );
  if (packageTarget?.entry) {
    const base = path.join(packageTarget.entry.path, packageTarget.subpath);
    return {
      workspace: packageTarget.entry,
      file: resolveAsFile(base) ?? packageTarget.entry.path,
    };
  }
  if (packageTarget?.absolute)
    return {
      workspace: ownerForFile(packageTarget.absolute, names),
      file: packageTarget.absolute,
    };
  if (imported.node) {
    const symbol = project?.checker.getSymbolAtLocation(imported.node);
    for (const declaration of symbol?.declarations ?? []) {
      const resolvedFile = declaration.path;
      if (typeof resolvedFile !== "string") continue;
      const workspace = ownerForFile(resolvedFile, names);
      if (workspace) return { workspace, file: resolvedFile };
    }
  }
  if (specifier.startsWith(".")) {
    const resolved =
      resolveAsFile(path.resolve(path.dirname(file), specifier)) ??
      path.resolve(path.dirname(file), specifier);
    const workspace = ownerForFile(resolved, names);
    return workspace ? { workspace, file: resolved } : null;
  }
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
  const configFiles = configFilesFor(manifests);

  for (const entry of manifests) {
    if (!WORKSPACE_EDGES.has(entry.name)) {
      violations.push(
        violation(
          entry.manifestPath
            ? path.relative(root, entry.manifestPath).split(path.sep).join("/")
            : entry.name,
          `workspace "${entry.name}" has no documented positive WORKSPACE_EDGES entry`,
        ),
      );
    }
  }
  if (manifestByName.size !== manifests.length) {
    violations.push(
      violation(
        "workspace manifests",
        "duplicate workspace package names make the workspace edge matrix ambiguous",
      ),
    );
  }

  for (const cycle of findCycles(graph)) {
    violations.push(
      violation(
        "workspace dependency graph",
        `runtime workspace dependency cycle: ${cycle.join(" -> ")}`,
      ),
    );
  }

  for (const { name, manifest } of manifests) {
    const permittedEdges = WORKSPACE_EDGES.get(name) ?? new Set();
    for (const dependency of graph.get(name) ?? []) {
      if (!permittedEdges.has(dependency))
        violations.push(
          violation(
            `${name}/package.json`,
            `runtime workspace dependency "${dependency}" is outside the documented workspace edge matrix`,
          ),
        );
    }
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

  const { files, violations: walkViolations } = await listSourceFiles(
    root,
    manifests,
  );
  violations.push(...walkViolations);
  const parser = new API({ cwd: root });
  let snapshot;
  try {
    snapshot = parser.updateSnapshot({
      openProjects: manifests
        .map((entry) => path.join(entry.path, "tsconfig.json"))
        .filter((file) => existsSync(file)),
      openFiles: [...files, ...configFiles],
    });
    const { aliases, violations: aliasViolations } = configuredAliases(
      configFiles,
      snapshot,
      root,
      manifests,
    );
    violations.push(...aliasViolations);
    for (const file of files) {
      const owner = ownerForFile(file, manifests);
      if (!owner) continue;
      const relativeFile = path.relative(root, file).split(path.sep).join("/");
      let imports;
      const project = snapshot.getDefaultProjectForFile(file);
      const sourceFile = project?.program.getSourceFile(file);
      try {
        if (!project || !sourceFile)
          throw new Error("TypeScript could not load this source file");
        imports = sourceImports(
          sourceFile,
          project.program.getSyntacticDiagnostics(file),
          relativeFile,
        );
      } catch (error) {
        violations.push(
          violation(
            relativeFile,
            `source could not be parsed; package boundaries cannot be proven (${error.message})`,
          ),
        );
        continue;
      }

      for (const imported of imports) {
        if (
          imported.specifier === DYNAMIC_SPECIFIER ||
          imported.specifier === "<createRequire>"
        ) {
          violations.push(
            violation(
              relativeFile,
              imported.specifier === "<createRequire>"
                ? `line ${imported.line} imports createRequire; createRequire is outside the workspace boundary contract`
                : `line ${imported.line} uses a non-static module specifier; package boundaries cannot be proven`,
            ),
          );
          continue;
        }
        const target = resolveWorkspaceTarget(
          imported,
          file,
          owner,
          manifestByName,
          project,
          aliases.get(owner.name) ?? new Map(),
        );
        if (target?.unresolvedAlias) {
          violations.push(
            violation(
              relativeFile,
              `line ${imported.line} uses an unresolved or ambiguous bundler alias "${imported.specifier}"`,
            ),
          );
          continue;
        }
        const targetWorkspace =
          target?.workspace?.name !== owner.name
            ? (target?.workspace?.name ??
              workspaceNameForSpecifier(imported.specifier))
            : workspaceNameForSpecifier(imported.specifier);
        const targetEntry =
          target?.workspace ??
          (targetWorkspace ? manifestByName.get(targetWorkspace) : null);
        const pointsToApp =
          (targetEntry &&
            isWithin(path.join(root, "apps"), targetEntry.path) &&
            targetEntry.name !== owner.name) ||
          (target?.file &&
            isWithin(path.join(root, "apps"), target.file) &&
            !isWithin(owner.path, target.file));
        const pointsOutOfUi =
          owner.name === "@taskdesk/ui" &&
          target?.workspace &&
          target.workspace.name !== owner.name;
        const pointsOutOfDomain =
          owner.name === "@taskdesk/domain" &&
          target?.workspace &&
          target.workspace.name !== owner.name;
        const isLibsTypeContract =
          owner.name === "@taskdesk/libs" &&
          imported.typeOnly &&
          targetWorkspace === "@taskdesk/api";

        const permittedEdges = WORKSPACE_EDGES.get(owner.name);
        if (
          target?.workspace &&
          target.workspace.name !== owner.name &&
          permittedEdges &&
          !permittedEdges.has(target.workspace.name) &&
          !isLibsTypeContract
        ) {
          violations.push(
            violation(
              relativeFile,
              `line ${imported.line} resolves to workspace "${target.workspace.name}", outside the documented workspace edge matrix`,
            ),
          );
        }

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
        if (
          PURE_LEAF_PACKAGES.has(owner.name) &&
          targetWorkspace &&
          targetWorkspace !== owner.name
        ) {
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
  } finally {
    snapshot?.dispose();
    parser.close();
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
  CREATE_REQUIRE_ALLOWLIST,
  findCycles,
  runtimeWorkspaceEdges,
  sourceImports,
  WORKSPACE_EDGES,
  workspaceNameForSpecifier,
};
