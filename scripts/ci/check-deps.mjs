#!/usr/bin/env node

/**
 * check:deps — enforce the workspace dependency graph and documented package boundaries.
 *
 * Runtime workspace edges come from package manifests so a cycle cannot hide in an
 * import path that the source scanner missed. Source imports are inspected for documented
 * cross-package boundaries. See docs/01-architecture/monorepo-layout.md#package-boundaries.
 *
 * Accepted limits of this analysis (by design — a maintainer wondering "why didn't this
 * catch X" should find the answer here, not only in a test file's header comment):
 *  - Computed/reflective property or element access whose key isn't a string literal or a
 *    `+`-concatenation of string literals is not resolved — a template literal with a
 *    substitution (`` m[`create${"Require"}`] ``) or a plain variable key (`m[k]`) defeats
 *    every by-name check below (see constantString, used throughout sourceImports).
 *  - Cross-file re-export chasing: this gate inspects one file's AST at a time and does not
 *    follow a re-exported binding into another module to find its original declaration.
 *  - `new Worker(...)` and a `require(...)`/`import(...)` of a `file://` URL are not
 *    resolved to whatever workspace package they might point at.
 *  - The one allowlisted file (packages/mcp/src/server.ts) is exempt at the file level for
 *    acquiring `module`/`node:module` at all, but the createRequire *call* it makes is only
 *    exempt in its one documented shape: bound to a local variable literally named `require`,
 *    called with exactly `import.meta.url`. A rename inside that same file (e.g.
 *    `const localRequire = createRequire(import.meta.url)`) falls outside that exact
 *    exemption and is flagged like anywhere else — the allowlist does not chase renames
 *    within its own file either.
 */

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { isBuiltin } from "node:module";
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
  // The next three are each used by exactly one primitive (input-otp.tsx, calendar.tsx,
  // form.tsx respectively) with no Base UI/native equivalent — #9's relocation batches
  // 3/4 held these three primitives back specifically because moving them needed this
  // package.json change; batch 6 makes it. See
  // docs/01-architecture/monorepo-layout.md#package-boundaries.
  "input-otp",
  "react-day-picker",
  "react-hook-form",
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
// Messages for the fixed, by-name/by-acquisition set of module-loading escape hatches this
// gate flags outside their marker specifier's own carve-out. See sourceImports' comments
// above isCreateRequireCallee (createRequire), flagModuleSpecifierAcquisition
// (module-acquisition), isGetBuiltinModuleCallee (getBuiltinModule), and isConstructorEscape
// (module-constructor) for what each one recognizes and why.
const FLAGGED_MESSAGES = {
  "<createRequire>": (line) =>
    `line ${line} imports createRequire; createRequire is outside the workspace boundary contract`,
  "<module-acquisition>": (line) =>
    `line ${line} acquires the "module"/"node:module" builtin; outside the allowlisted file this is outside the workspace boundary contract (it exposes non-createRequire code-loading paths such as Module._load and module.register loader hooks)`,
  "<getBuiltinModule>": (line) =>
    `line ${line} calls getBuiltinModule; getBuiltinModule is outside the workspace boundary contract (it can hand back the "module" builtin the same way an acquired node:module import can)`,
  "<module-constructor>": (line) =>
    `line ${line} reaches the CJS Module class via module.constructor or require.main.constructor; this is outside the workspace boundary contract`,
};
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

// pnpm-workspace.yaml declares `packages/**` and `apps/**` — RECURSIVE globs (see
// scripts/ci/lib/workspace-membership.mjs's own account of this exact defect in three
// other gates: check-overrides, check-skips, check-vocabulary, check-env). Walking apps/
// and packages/ one `readdir` deep, as this function used to, makes a package nested two
// levels deep (a shape the glob would actually install) invisible to this gate entirely —
// not even flagged as "unlisted", just silently unwalked. `lib/workspace-membership.mjs`
// itself can't be reused directly here: it always reads the real repository's root and
// `pnpm-workspace.yaml`, while this function is exercised against disposable fixture
// trees in check-deps.test.mjs, so it walks apps/ and packages/ recursively itself,
// against the `root` it was actually given.
async function listWorkspaceManifests(root) {
  const manifests = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    if (
      entries.some((entry) => entry.isFile() && entry.name === "package.json")
    ) {
      const manifestPath = path.join(dir, "package.json");
      try {
        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        if (typeof manifest.name === "string") {
          manifests.push({
            name: manifest.name,
            path: dir,
            manifest,
            manifestPath,
          });
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      await walk(path.join(dir, entry.name));
    }
  }
  for (const top of ["apps", "packages"]) await walk(path.join(root, top));
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
  // F1 (PR #361 round 4): the gate previously only ever flagged the *name* createRequire,
  // never flagged getting hold of the `module`/`node:module` builtin itself — which has
  // other, createRequire-unrelated ways to load arbitrary code (Module._load,
  // Module.prototype.require, `module.register` loader hooks that can redirect even a
  // compliant static import). One level up from chasing createRequire shapes: treat the
  // ACQUISITION of `module`/`node:module` as the flagged event — a static import, `export
  // … from`, `import x = require(...)`, `require(...)`, or dynamic `import(...)` whose
  // specifier is literally "module" or "node:module" — outside the one allowlisted file,
  // which legitimately acquires it for its own documented createRequire(import.meta.url)
  // shape. Type-only acquisitions (`import type` / `export type … from`) load nothing at
  // runtime and are not flagged here.
  function flagModuleSpecifierAcquisition(specifierNode) {
    if (allowedRequireSpecifier) return;
    const spec = literal(specifierNode);
    if (spec !== "module" && spec !== "node:module") return;
    imports.push({
      specifier: "<module-acquisition>",
      line: lineAt(specifierNode),
      typeOnly: false,
      node: specifierNode,
    });
  }
  const loaderBindings = new Set();
  // Strip the wrappers that stand between a call site and the callee expression that
  // actually names it, so the createRequire-by-name check below sees through `await`,
  // `(...)`, `as`, and `!` wrapped directly around the callee.
  function unwrapExpression(expr) {
    let current = expr;
    while (
      current &&
      [
        ts.SyntaxKind.ParenthesizedExpression,
        ts.SyntaxKind.AwaitExpression,
        ts.SyntaxKind.AsExpression,
        ts.SyntaxKind.NonNullExpression,
      ].includes(current.kind)
    )
      current = current.expression;
    return current;
  }
  // True when `node`, read outward through any immediately-enclosing parens/await/as/!
  // wrappers, is the callee of a CallExpression — i.e. the CallExpression branch below
  // already evaluates this exact acquisition via isCreateRequireCallee (which unwraps the
  // same way). Used only to avoid a redundant second diagnostic on the same call for
  // `(createRequire)(x)` / `(modns.createRequire)(x)`; it does not affect whether anything
  // is caught, only whether it is reported once.
  function isWrappedCallCallee(node) {
    let current = node;
    let parent = current.parent;
    while (
      parent &&
      [
        ts.SyntaxKind.ParenthesizedExpression,
        ts.SyntaxKind.AwaitExpression,
        ts.SyntaxKind.AsExpression,
        ts.SyntaxKind.NonNullExpression,
      ].includes(parent.kind) &&
      parent.expression === current
    ) {
      current = parent;
      parent = current.parent;
    }
    return (
      parent?.kind === ts.SyntaxKind.CallExpression &&
      parent.expression === current
    );
  }
  // Recognize a createRequire acquisition CALL by the literal name of its callee alone —
  // never by tracing where the receiver (for `X.createRequire(...)`) came from. Round 1
  // and round 2 of this gate both tried to prove the receiver was provably node:module's
  // namespace object, and both rounds were beaten by one more indirection shape nobody had
  // enumerated yet (dynamic import, destructuring, process.getBuiltinModule, a passthrough
  // call, reassignment, an object property, a `.then()` callback, `Promise.all`
  // destructuring — the list only grows). A linter like "no-eval" doesn't try to prove its
  // target really is the global `eval`; it flags any call spelled `eval(...)`. This does
  // the same: `createRequire(...)`, `X.createRequire(...)` for ANY `X`, or
  // `X["createRequire"](...)` for ANY `X`, is flagged regardless of how `X` (or a bare
  // `createRequire` binding) was obtained. Round 3 closed the import/destructure-time rename
  // gap this used to accept (`import { createRequire as cr }`, or `const { createRequire: cr
  // } = await import(...)`, then calling `cr(...)`) — see the ImportDeclaration handling
  // above (resolves through `propertyName`) and the bare-identifier-rename check further
  // below. What remains an accepted limit, same as a scope-based lint rule: computed/
  // reflective property access whose key isn't a string literal or `+`-concatenation (a
  // template substitution or a plain variable key), and cross-file re-export chasing — see
  // this file's top comment for the full, current list. The callee is unwrapped through
  // parens/await/as/! first so `(createRequire)(x)` and `(modns.createRequire)(x)` don't
  // weaken detection.
  // Generalized to any literal callee name (F1, PR #361 round 4): getBuiltinModule is
  // flagged the same by-name way createRequire is above — `process.getBuiltinModule("module")`
  // hands back the same "module" builtin createRequire itself comes from, with its own
  // non-createRequire loading paths (e.g. `._load`), so the call itself is what gets
  // flagged, regardless of what string argument it's given or how the receiver was obtained.
  function isNamedCallee(expr, name) {
    const callee = unwrapExpression(expr);
    if (!callee) return false;
    if (tsIs.isIdentifier(callee)) return callee.text === name;
    if (callee.kind === ts.SyntaxKind.PropertyAccessExpression)
      return callee.name.text === name;
    if (callee.kind === ts.SyntaxKind.ElementAccessExpression)
      return constantString(callee.argumentExpression) === name;
    return false;
  }
  function isCreateRequireCallee(expr) {
    return isNamedCallee(expr, "createRequire");
  }
  function isGetBuiltinModuleCallee(expr) {
    return isNamedCallee(expr, "getBuiltinModule");
  }
  // Downstream-only: once a createRequire acquisition call is recognized above, its
  // return value is itself a require-shaped loader function. If that return value is
  // bound to a plain variable, track the variable so a later call through it (checked
  // separately, below) is resolved as a require target the same way a direct `require(...)`
  // call is. This does not re-decide whether the acquisition itself is a createRequire
  // call — it only follows the one-hop "the result of a recognized call was named" step,
  // which is bounded (a single assignment), not the unbounded provenance tracing this
  // gate moved away from above.
  function collectLoaderBindings(node) {
    if (
      node.kind === ts.SyntaxKind.VariableDeclaration &&
      node.initializer &&
      tsIs.isIdentifier(node.name)
    ) {
      const initializer = unwrapExpression(node.initializer);
      if (
        initializer?.kind === ts.SyntaxKind.CallExpression &&
        isCreateRequireCallee(initializer.expression)
      )
        loaderBindings.add(node.name.text);
    }
    node.forEachChild(collectLoaderBindings);
  }
  collectLoaderBindings(file);
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
      if (node.moduleSpecifier) {
        const typeOnly =
          kind === ts.SyntaxKind.ImportDeclaration
            ? Boolean(node.importClause?.isTypeOnly)
            : Boolean(node.isTypeOnly);
        add(node.moduleSpecifier, typeOnly);
        if (!typeOnly) flagModuleSpecifierAcquisition(node.moduleSpecifier);
      }
    } else if (kind === ts.SyntaxKind.ImportEqualsDeclaration) {
      if (
        node.moduleReference?.kind === ts.SyntaxKind.ExternalModuleReference
      ) {
        add(node.moduleReference.expression);
        if (!node.isTypeOnly)
          flagModuleSpecifierAcquisition(node.moduleReference.expression);
      }
    } else if (kind === ts.SyntaxKind.ImportType) {
      // Type-position `import(...)` — `export type Y = import("@taskdesk/api").X` and the
      // JSDoc `@typedef {import("@taskdesk/api").X}` form (in a plain .js file) both parse
      // to this same ImportType node (F2, PR #361 round 4), so both now get scanned through
      // the same edge-recording path `add()` as the already-working `import type { X } from
      // "..."` form, instead of being silently skipped.
      if (node.argument?.kind === ts.SyntaxKind.LiteralType)
        add(node.argument.literal, true);
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
      const isCreateRequire = isCreateRequireCallee(expr);
      const isGetBuiltinModule = isGetBuiltinModuleCallee(expr);
      const isCreatedLoader =
        tsIs.isIdentifier(expr) && loaderBindings.has(expr.text);
      if (isGetBuiltinModule) {
        imports.push({
          specifier: "<getBuiltinModule>",
          line: lineAt(node),
          typeOnly: false,
          node,
        });
      }
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
      if (isImport || isRequire)
        flagModuleSpecifierAcquisition(node.arguments[0]);
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
      // Any `X.createRequire` / `X["createRequire"]` reference that isn't itself the
      // callee of a (possibly parenthesized) call — e.g. stashed in a variable to be
      // called later — for ANY `X`, by the same by-name philosophy as isCreateRequireCallee
      // above. The CallExpression branch already reports a directly-called one.
      const isDetachedCreateRequire =
        property === "createRequire" && !isWrappedCallCallee(node);
      // `module.constructor` / `require.main.constructor` reach the CJS Module class
      // directly (its own `._load`, etc.) without ever calling anything literally named
      // createRequire or getBuiltinModule (F1, PR #361 round 4) — flagged by the receiver
      // text the moment the property is referenced, the same fixed, by-text way
      // isLoaderMember above recognizes `module.require`.
      const isConstructorEscape =
        property === "constructor" &&
        ["module", "require.main"].includes(receiver);
      if (
        !isDirectCall &&
        (isLoaderMember ||
          isRequireResolver ||
          isDetachedCreateRequire ||
          isConstructorEscape)
      )
        imports.push({
          specifier: isDetachedCreateRequire
            ? "<createRequire>"
            : isConstructorEscape
              ? "<module-constructor>"
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
    } else if (tsIs.isIdentifier(node) && node.text === "createRequire") {
      // Any bare reference to an identifier literally named `createRequire` that is
      // neither the name being declared (an import specifier or destructuring binding —
      // just entering it into scope, not using it), nor the `.name` of a property access
      // (handled by the PropertyAccessExpression branch above), nor the callee of a direct
      // call (handled by the CallExpression branch above, with the allowlist exemption) —
      // e.g. `const stashed = createRequire;` to call later under a different name. This
      // still doesn't chase the rename (see isCreateRequireCallee's comment); it flags the
      // reference the moment the still-literally-named binding is handed off.
      //
      // Exception: a destructuring binding element that itself RENAMES createRequire to a
      // different local name — `const { createRequire: cr } = await import("node:module")`
      // — is not "just entering scope" the safe way `const { createRequire } = ...` is: the
      // local name will never again read literally as createRequire, so no later call site
      // can be caught by name. This is the destructuring counterpart of the ImportDeclaration
      // check above, which already resolves a static `import { createRequire as cr }` back
      // to its ORIGINAL name regardless of local alias. Flag the rename the moment it's
      // declared, without tracing where the destructured value came from (still by name,
      // not provenance — a plain, non-renaming `{ createRequire }` is unaffected and stays
      // caught downstream, the same way it always was, via its later call site).
      const parent = node.parent;
      const isRenamingBindingElement =
        parent?.kind === ts.SyntaxKind.BindingElement &&
        parent.propertyName === node &&
        parent.name?.text !== node.text;
      const declaresThisName =
        !isRenamingBindingElement &&
        ((parent?.kind === ts.SyntaxKind.ImportSpecifier &&
          (parent.propertyName === node || parent.name === node)) ||
          (parent?.kind === ts.SyntaxKind.BindingElement &&
            (parent.propertyName === node || parent.name === node)));
      const isPropertyAccessName =
        parent?.kind === ts.SyntaxKind.PropertyAccessExpression &&
        parent.name === node;
      if (
        !declaresThisName &&
        !isPropertyAccessName &&
        !isWrappedCallCallee(node)
      )
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
  let sawRealDeclaration = false;
  if (imported.node) {
    const symbol = project?.checker.getSymbolAtLocation(imported.node);
    for (const declaration of symbol?.declarations ?? []) {
      // Skip ambient module augmentations (`declare module "some-package" { ... }`,
      // ts.SyntaxKind.ModuleDeclaration with a string-literal name) when this fallback
      // walks a bare specifier's declarations. This branch runs for any specifier that
      // reaches it unresolved by the checks above — a bare third-party package name, but
      // also a relative specifier (`./…`, `../…`), since that case is only excluded further
      // below, not before this point. A workspace-owned ModuleDeclaration found here can
      // never be the specifier's real home; it only proves someone augmented that module
      // from workspace source. The hazard isn't array order — in the real repro, the
      // module's own declaration consistently comes first, not last. This file resolves
      // symbols through TypeScript 7's native API (`typescript/unstable/sync`), where every
      // declaration handle, regardless of node kind, carries a real `.path` for its
      // containing file. A third-party module's own declaration lives under
      // `node_modules`, outside every workspace, so `ownerForFile` returns null for it and
      // the loop just continues past it — but an augmentation written into workspace source
      // has a `.path` that *does* fall inside a workspace, so it's the one declaration
      // `ownerForFile` matches, and it wins regardless of where it sits in the array.
      // Without this guard, one `declare module "vitest" { ... }` (packages/ui's a11y.ts)
      // attributed every `import ... from "vitest"` in the monorepo to `@taskdesk/ui`,
      // producing 69 false "outside the workspace edge matrix" violations (#389/#390,
      // tracked as #393). Skipping augmentations here falls through to the module's real
      // declaration when one exists, or to "unresolved" (no violation) when it doesn't —
      // never to a workspace that merely typed the module.
      if (declaration.kind === ts.SyntaxKind.ModuleDeclaration) continue;
      const resolvedFile = declaration.path;
      if (typeof resolvedFile !== "string") continue;
      sawRealDeclaration = true;
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
  // F3 (#424): a bare specifier this checker could not tie to any real declaration at all —
  // no symbol, or every declaration found was an ambient `declare module` shim skipped
  // above — might still be a genuine cross-workspace import, reaching its target through a
  // mechanism TypeScript can't type-resolve (so the shim, wherever it happens to sit, is
  // the only clue). Rather than trust symbol resolution for this last-resort case, fall
  // back to what the specifier's own workspace actually declares: a real dependency (in any
  // of package.json's four dependency fields) is legitimate even if this checker can't see
  // where it resolves; a bare specifier that is neither a Node builtin nor a declared
  // dependency has no legitimate story and is flagged directly, closing the gap without
  // needing to reconstruct what the shim was hiding.
  if (!sawRealDeclaration && !isBuiltin(specifier)) {
    const packageName = packageNameForSpecifier(specifier);
    const dependencyFields = {
      ...owner.manifest.dependencies,
      ...owner.manifest.devDependencies,
      ...owner.manifest.optionalDependencies,
      ...owner.manifest.peerDependencies,
    };
    // Object.hasOwn, not the `in` operator: `in` also matches inherited Object.prototype
    // properties (toString, constructor, __proto__, ...), so a specifier literally named
    // "toString" would otherwise read as "declared" without ever appearing in any
    // package.json.
    const declared =
      packageName && Object.hasOwn(dependencyFields, packageName);
    if (packageName && !declared) return { undeclaredDependency: true };
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
        // Object.hasOwn, not bracket-truthiness: a bare `FLAGGED_MESSAGES[specifier]` read
        // matches `Object.prototype` own accessors like `__proto__` (returns the prototype
        // itself, truthy but not callable) for specifiers this table never declared, which
        // then throws when called as a function below instead of falling through cleanly.
        const flaggedMessage = Object.hasOwn(FLAGGED_MESSAGES, imported.specifier)
          ? FLAGGED_MESSAGES[imported.specifier]
          : undefined;
        if (imported.specifier === DYNAMIC_SPECIFIER || flaggedMessage) {
          violations.push(
            violation(
              relativeFile,
              flaggedMessage?.(imported.line) ??
                `line ${imported.line} uses a non-static module specifier; package boundaries cannot be proven`,
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
        if (target?.undeclaredDependency) {
          violations.push(
            violation(
              relativeFile,
              `line ${imported.line} imports "${imported.specifier}", which is not declared as a dependency in ${owner.name}/package.json and could not be resolved to a workspace package or file`,
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
