import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  analyzeDependencies,
  findCycles,
  runtimeWorkspaceEdges,
  WORKSPACE_EDGES,
  workspaceNameForSpecifier,
} from "./check-deps.mjs";

test("runtime workspace graph excludes dev-only links and reports cycles", () => {
  const manifests = [
    {
      name: "@taskdesk/a",
      manifest: { dependencies: { "@taskdesk/b": "workspace:*" } },
    },
    {
      name: "@taskdesk/b",
      manifest: {
        dependencies: { "@taskdesk/c": "workspace:*" },
        devDependencies: { "@taskdesk/d": "workspace:*" },
      },
    },
    {
      name: "@taskdesk/c",
      manifest: { dependencies: { "@taskdesk/a": "workspace:*" } },
    },
    {
      name: "@taskdesk/d",
      manifest: { dependencies: { "@taskdesk/a": "workspace:*" } },
    },
  ];
  const graph = runtimeWorkspaceEdges(manifests);
  assert.deepEqual(graph.get("@taskdesk/b"), ["@taskdesk/c"]);
  assert.deepEqual(findCycles(graph), [
    ["@taskdesk/a", "@taskdesk/b", "@taskdesk/c", "@taskdesk/a"],
  ]);
});

test("workspace dependency aliases participate in cycle detection", () => {
  const graph = runtimeWorkspaceEdges([
    {
      name: "@taskdesk/a",
      manifest: { dependencies: { aliasB: "workspace:@taskdesk/b@*" } },
    },
    {
      name: "@taskdesk/b",
      manifest: { dependencies: { "@taskdesk/a": "workspace:*" } },
    },
  ]);
  assert.deepEqual(graph.get("@taskdesk/a"), ["@taskdesk/b"]);
  assert.deepEqual(findCycles(graph), [
    ["@taskdesk/a", "@taskdesk/b", "@taskdesk/a"],
  ]);
});

test("workspace package names are read from the package segment only", () => {
  assert.equal(
    workspaceNameForSpecifier("@taskdesk/ui/components/button"),
    "@taskdesk/ui",
  );
  assert.equal(workspaceNameForSpecifier("@another/ui"), null);
  assert.equal(workspaceNameForSpecifier("./local"), null);
});

test("workspace analyzer permits libs' type contract and rejects forbidden app imports", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taskdesk-deps-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  async function packageAt(relative, name, manifest = {}) {
    const directory = path.join(root, relative);
    await mkdir(path.join(directory, "src"), { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name, ...manifest }),
    );
    await writeFile(
      path.join(directory, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { allowJs: true } }),
    );
    return directory;
  }

  const web = await packageAt("apps/web", "@taskdesk/web");
  await packageAt("apps/api", "@taskdesk/api");
  const libs = await packageAt("packages/libs", "@taskdesk/libs", {
    devDependencies: { "@taskdesk/api": "workspace:*" },
  });
  const ui = await packageAt("packages/ui", "@taskdesk/ui");
  const domain = await packageAt("packages/domain", "@taskdesk/domain");

  await writeFile(
    path.join(libs, "src/client.ts"),
    'import type { AppType } from "@taskdesk/api";\n',
  );
  await writeFile(
    path.join(libs, "src/runtime.ts"),
    'import type from "@taskdesk/api";\nimport type, { AppType } from "@taskdesk/api";\n',
  );
  await writeFile(
    path.join(web, "src/client.ts"),
    'import type { AppType } from "@taskdesk/api";\n',
  );
  await writeFile(
    path.join(ui, "src/index.ts"),
    'import { schema } from "../../../apps/api/src/schema";\n',
  );
  await writeFile(
    path.join(domain, "src/index.ts"),
    'export { value } from "../../../apps/web/src/value";\n',
  );

  const result = await analyzeDependencies(root);
  const messages = result.violations.join("\n");
  assert.match(
    messages,
    /apps\/web\/src\/client\.ts.*directly from apps\/api/s,
  );
  assert.match(messages, /packages\/libs\/src\/runtime\.ts.*from apps\/\*\*/s);
  assert.match(messages, /packages\/ui\/src\/index\.ts.*from apps\/\*\*/s);
  assert.match(messages, /packages\/domain\/src\/index\.ts.*from apps\/\*\*/s);
  assert.doesNotMatch(messages, /packages\/libs\/src\/client\.ts/);
});

test("documented boundaries reject app imports, impure leaves, I/O and UI dependencies", async (t) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "taskdesk-deps-boundaries-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));

  async function packageAt(relative, name, manifest = {}) {
    const directory = path.join(root, relative);
    await mkdir(path.join(directory, "src"), { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name, ...manifest }),
    );
    await writeFile(
      path.join(directory, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { allowJs: true } }),
    );
    return directory;
  }

  const web = await packageAt("apps/web", "@taskdesk/web");
  const api = await packageAt("apps/api", "@taskdesk/api");
  const domain = await packageAt("packages/domain", "@taskdesk/domain", {
    dependencies: { "dns/promises": "^1.0.0" },
  });
  const permissions = await packageAt(
    "packages/permissions",
    "@taskdesk/permissions",
    {
      dependencies: { "@taskdesk/domain": "workspace:*" },
    },
  );
  const contracts = await packageAt(
    "packages/plugins-contracts",
    "@taskdesk/plugins-contracts",
  );
  const ui = await packageAt("packages/ui", "@taskdesk/ui", {
    dependencies: { hono: "^4.0.0" },
  });

  await writeFile(
    path.join(web, "src/api.ts"),
    'import { handler } from "../../../apps/api/src/handler";\n',
  );
  await writeFile(
    path.join(domain, "src/network.ts"),
    'import { lookup } from "node:dns";\nimport { resolve } from "dns/promises";\n',
  );
  await writeFile(
    path.join(permissions, "src/domain.ts"),
    'import type { Rule } from "@taskdesk/domain";\n',
  );
  await writeFile(
    path.join(contracts, "src/permissions.ts"),
    'import type { Rule } from "@taskdesk/permissions";\n',
  );
  await writeFile(
    path.join(ui, "src/server.ts"),
    'import "hono";\nimport "node:fs";\nvoid import(modulePath);\n',
  );
  await writeFile(path.join(api, "src/index.ts"), "export {};\n");

  const { violations } = await analyzeDependencies(root);
  const messages = violations.join("\n");
  assert.match(messages, /apps\/web\/src\/api\.ts.*imports.*apps\/\*/s);
  assert.match(messages, /packages\/domain\/src\/network\.ts.*node:dns/s);
  assert.match(messages, /packages\/domain\/src\/network\.ts.*dns\/promises/s);
  assert.match(messages, /@taskdesk\/domain\/package\.json.*dns\/promises/s);
  assert.match(messages, /@taskdesk\/permissions.*pure-leaf boundary/s);
  assert.match(messages, /packages\/permissions\/src\/domain\.ts.*pure leaf/s);
  assert.match(
    messages,
    /packages\/plugins-contracts\/src\/permissions\.ts.*pure leaf/s,
  );
  assert.match(messages, /@taskdesk\/ui\/package\.json.*hono/s);
  assert.match(messages, /packages\/ui\/src\/server\.ts.*hono/s);
  assert.match(messages, /packages\/ui\/src\/server\.ts.*node:fs/s);
  assert.match(
    messages,
    /packages\/ui\/src\/server\.ts.*non-static module specifier/s,
  );
});

test("source walk includes build, out and generated route trees and rejects symlinks", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taskdesk-deps-walk-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function packageAt(relative, name) {
    const directory = path.join(root, relative);
    await mkdir(path.join(directory, "src"), { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name }),
    );
    await writeFile(
      path.join(directory, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { allowJs: true } }),
    );
    return directory;
  }
  const libs = await packageAt("packages/libs", "@taskdesk/libs");
  await packageAt("apps/api", "@taskdesk/api");
  for (const relative of ["build/edge.ts", "out/edge.ts", "routeTree.gen.ts"]) {
    const sourceFile = path.join(libs, "src", relative);
    await mkdir(path.dirname(sourceFile), { recursive: true });
    await writeFile(sourceFile, 'import { x } from "@taskdesk/api";');
  }
  const external = path.join(root, "outside.ts");
  await writeFile(external, "export {};\n");
  await symlink(external, path.join(libs, "src", "linked.ts"));
  const { files, violations } = await analyzeDependencies(root);
  assert.ok(files.some((file) => file.endsWith("src/build/edge.ts")));
  assert.ok(files.some((file) => file.endsWith("src/out/edge.ts")));
  assert.ok(files.some((file) => file.endsWith("src/routeTree.gen.ts")));
  assert.match(
    violations.join("\n"),
    /linked\.ts.*symbolic links under workspace src are rejected/s,
  );
  assert.equal(
    [
      ...violations
        .join("\n")
        .matchAll(
          /packages\/libs\/src\/(?:build\/edge\.ts|out\/edge\.ts|routeTree\.gen\.ts)\n\s+line \d+ imports .* from apps\/\*\*/g,
        ),
    ].length,
    3,
  );
});

test("AST parsing catches regex-hidden imports, ignores JSX copy and rejects malformed source", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taskdesk-deps-ast-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function packageAt(relative, name) {
    const directory = path.join(root, relative);
    await mkdir(path.join(directory, "src"), { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name }),
    );
    await writeFile(
      path.join(directory, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { allowJs: true } }),
    );
    return directory;
  }
  const libs = await packageAt("packages/libs", "@taskdesk/libs");
  await packageAt("apps/api", "@taskdesk/api");
  await writeFile(
    path.join(libs, "src/regex.ts"),
    'const re = /"/; import { x } from "@taskdesk/api"; const end = /"/;',
  );
  await writeFile(
    path.join(libs, "src/copy.tsx"),
    'export const Copy = () => <p>Please import from "@taskdesk/api" later</p>;',
  );
  await writeFile(
    path.join(libs, "src/bad.ts"),
    "const = ; import x from '@taskdesk/api';",
  );
  const { violations } = await analyzeDependencies(root);
  const messages = violations.join("\n");
  assert.match(messages, /packages\/libs\/src\/regex\.ts.*from apps\/\*\*/s);
  assert.doesNotMatch(messages, /packages\/libs\/src\/copy\.tsx/);
  assert.match(messages, /packages\/libs\/src\/bad\.ts.*could not be parsed/s);
});

test("detached require and createRequire forms fail closed", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taskdesk-deps-require-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function packageAt(relative, name) {
    const directory = path.join(root, relative);
    await mkdir(path.join(directory, "src"), { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name }),
    );
    return directory;
  }
  const libs = await packageAt("packages/libs", "@taskdesk/libs");
  await packageAt("apps/api", "@taskdesk/api");
  await writeFile(
    path.join(libs, "src/edge.ts"),
    [
      "const r = require;",
      'import { createRequire } from "node:module";',
      "const localRequire = createRequire(import.meta.url);",
      'globalThis["req" + "uire"]("@taskdesk/api");',
      'require.resolve("@taskdesk/api");',
      'import.meta.resolve("@taskdesk/api");',
    ].join("\n"),
  );
  const { violations } = await analyzeDependencies(root);
  assert.match(
    violations.join("\n"),
    /packages\/libs\/src\/edge\.ts.*non-static module specifier/s,
  );
  assert.match(
    violations.join("\n"),
    /packages\/libs\/src\/edge\.ts.*createRequire/s,
  );
  assert.match(
    violations.join("\n"),
    /packages\/libs\/src\/edge\.ts.*from apps\/\*\*/s,
  );
});

test("unknown discovered workspaces fail closed against the positive edge matrix", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taskdesk-deps-unlisted-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function packageAt(relative, name) {
    const directory = path.join(root, relative);
    await mkdir(path.join(directory, "src"), { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name }),
    );
    return directory;
  }
  const added = await packageAt("packages/new", "@taskdesk/new");
  await packageAt("packages/email", "@taskdesk/email");
  await writeFile(
    path.join(added, "src/index.ts"),
    'import "@taskdesk/email";',
  );
  const { violations } = await analyzeDependencies(root);
  assert.match(
    violations.join("\n"),
    /packages\/new\/package\.json[\s\S]*no documented positive WORKSPACE_EDGES entry/,
  );
});

test("a workspace nested two levels deep is still discovered", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taskdesk-deps-nested-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function packageAt(relative, name) {
    const directory = path.join(root, relative);
    await mkdir(path.join(directory, "src"), { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name }),
    );
    return directory;
  }
  // pnpm-workspace.yaml declares `packages/**`, which matches any depth, so a package
  // nested under a scoping directory (packages/scope/evil) is one pnpm would actually
  // install. `listWorkspaceManifests` used to walk one `readdir` deep and never see it —
  // not even flagged as "unlisted", just silently unwalked.
  await packageAt("packages/scope/evil", "@taskdesk/evil");
  const { manifests, violations } = await analyzeDependencies(root);
  assert.ok(
    manifests.some((entry) => entry.name === "@taskdesk/evil"),
    "a package nested two directories deep must be discovered",
  );
  assert.match(
    violations.join("\n"),
    /packages\/scope\/evil\/package\.json[\s\S]*no documented positive WORKSPACE_EDGES entry/,
  );
});

test("namespace and default createRequire imports are analyzed, including MCP loader calls", async (t) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "taskdesk-deps-create-require-aliases-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  async function packageAt(relative, name) {
    const directory = path.join(root, relative);
    await mkdir(path.join(directory, "src"), { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name }),
    );
    return directory;
  }
  const libs = await packageAt("packages/libs", "@taskdesk/libs");
  const mcp = await packageAt("packages/mcp", "@taskdesk/mcp");
  await packageAt("apps/api", "@taskdesk/api");
  await writeFile(
    path.join(libs, "src/namespace.ts"),
    [
      'import * as Module from "node:module";',
      "const load = Module.createRequire(import.meta.url);",
      'load("@taskdesk/api");',
    ].join("\n"),
  );
  await writeFile(
    path.join(libs, "src/default.ts"),
    [
      'import { default as Module } from "node:module";',
      "const load = Module.createRequire(import.meta.url);",
      'load("@taskdesk/api");',
    ].join("\n"),
  );
  await writeFile(
    path.join(mcp, "src/server.ts"),
    [
      'import { createRequire } from "node:module";',
      "const localRequire = createRequire(import.meta.url);",
      'localRequire("../package.json");',
      'localRequire("@taskdesk/api");',
    ].join("\n"),
  );
  const { violations } = await analyzeDependencies(root);
  const messages = violations.join("\n");
  assert.match(messages, /packages\/libs\/src\/namespace\.ts.*createRequire/s);
  assert.match(messages, /packages\/libs\/src\/namespace\.ts.*from apps\/\*/s);
  assert.match(messages, /packages\/libs\/src\/default\.ts.*createRequire/s);
  assert.match(messages, /packages\/mcp\/src\/server\.ts.*from apps\/\*/s);
});

test("dynamically-acquired createRequire cannot bypass the workspace boundary gate", async (t) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "taskdesk-deps-dynamic-create-require-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  async function packageAt(relative, name) {
    const directory = path.join(root, relative);
    await mkdir(path.join(directory, "src"), { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name }),
    );
    return directory;
  }
  const libs = await packageAt("packages/libs", "@taskdesk/libs");
  await packageAt("apps/api", "@taskdesk/api");
  // Bypass 1: `await import(...)`, then a property access to createRequire.
  await writeFile(
    path.join(libs, "src/await-property.ts"),
    [
      'const modns = await import("node:module");',
      "const req = modns.createRequire(import.meta.url);",
      'req("@taskdesk/api");',
    ].join("\n"),
  );
  // Bypass 2: destructuring createRequire straight out of the dynamic import.
  await writeFile(
    path.join(libs, "src/destructured.ts"),
    [
      'const { createRequire } = await import("node:module");',
      "const req = createRequire(import.meta.url);",
      'req("@taskdesk/api");',
    ].join("\n"),
  );
  // Bypass 3: acquiring the module namespace via process.getBuiltinModule instead of
  // import() at all.
  await writeFile(
    path.join(libs, "src/builtin-module.ts"),
    [
      'const mod = process.getBuiltinModule("node:module");',
      "const req = mod.createRequire(import.meta.url);",
      'req("@taskdesk/api");',
    ].join("\n"),
  );
  const { violations } = await analyzeDependencies(root);
  const messages = violations.join("\n");
  assert.match(
    messages,
    /packages\/libs\/src\/await-property\.ts.*createRequire/s,
  );
  assert.match(
    messages,
    /packages\/libs\/src\/await-property\.ts.*from apps\/\*/s,
  );
  assert.match(
    messages,
    /packages\/libs\/src\/destructured\.ts.*createRequire/s,
  );
  assert.match(
    messages,
    /packages\/libs\/src\/destructured\.ts.*from apps\/\*/s,
  );
  assert.match(
    messages,
    /packages\/libs\/src\/builtin-module\.ts.*createRequire/s,
  );
  assert.match(
    messages,
    /packages\/libs\/src\/builtin-module\.ts.*from apps\/\*/s,
  );
});

test("Vite aliases resolving into another workspace are boundary checked", async (t) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "taskdesk-deps-vite-alias-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  async function packageAt(relative, name) {
    const directory = path.join(root, relative);
    await mkdir(path.join(directory, "src"), { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name }),
    );
    await writeFile(
      path.join(directory, "tsconfig.json"),
      JSON.stringify({ compilerOptions: {} }),
    );
    return directory;
  }
  const web = await packageAt("apps/web", "@taskdesk/web");
  const api = await packageAt("apps/api", "@taskdesk/api");
  await mkdir(path.join(root, "apps/web"), { recursive: true });
  await writeFile(
    path.join(root, "apps/web/vite.config.ts"),
    [
      'import path from "node:path";',
      'export default { resolve: { alias: { "@api": path.resolve(__dirname, "../../apps/api/src"), "@taskdesk/domain": path.resolve(__dirname, "../../apps/api/src") } } };',
    ].join("\n"),
  );
  await writeFile(
    path.join(web, "src/edge.ts"),
    'import "@api/auth"; import "@taskdesk/domain/auth";',
  );
  await writeFile(path.join(api, "src/auth.ts"), "export {};\n");
  const { violations } = await analyzeDependencies(root);
  assert.equal(
    violations.filter(
      (message) =>
        message.includes("apps/web/src/edge.ts") &&
        message.includes("apps/api"),
    ).length,
    2,
    violations.join("\n"),
  );
});

test("conflicting bundler alias definitions fail closed", async (t) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "taskdesk-deps-vite-alias-ambiguous-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  async function packageAt(relative, name) {
    const directory = path.join(root, relative);
    await mkdir(path.join(directory, "src"), { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name }),
    );
    await writeFile(
      path.join(directory, "tsconfig.json"),
      JSON.stringify({ compilerOptions: {} }),
    );
    return directory;
  }
  const web = await packageAt("apps/web", "@taskdesk/web");
  await packageAt("apps/api", "@taskdesk/api");
  await packageAt("packages/libs", "@taskdesk/libs");
  await writeFile(
    path.join(root, "apps/web/vite.config.ts"),
    [
      'import path from "node:path";',
      'export default { resolve: { alias: { "@api": path.resolve(__dirname, "../../apps/api/src") } } };',
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "apps/web/vitest.config.ts"),
    [
      'import path from "node:path";',
      'export default { resolve: { alias: { "@api": path.resolve(__dirname, "../../packages/libs/src") } } };',
    ].join("\n"),
  );
  await writeFile(path.join(web, "src/edge.ts"), 'import "@api/auth";');
  const { violations } = await analyzeDependencies(root);
  assert.match(
    violations.join("\n"),
    /ambiguous resolve\.alias mapping for "@api"/,
  );
});

test("workspace aliases and tsconfig paths resolve to package targets and matrix edges", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taskdesk-deps-aliases-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function packageAt(relative, name, manifest = {}) {
    const directory = path.join(root, relative);
    await mkdir(path.join(directory, "src"), { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name, ...manifest }),
    );
    await writeFile(
      path.join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          moduleResolution: "Bundler",
          paths: { "~api/*": ["../../apps/api/src/*"] },
        },
      }),
    );
    return directory;
  }
  const api = await packageAt("apps/api", "@taskdesk/api");
  const web = await packageAt("apps/web", "@taskdesk/web", {
    dependencies: {
      "@taskdesk/domain": "workspace:*",
      "@taskdesk/email": "workspace:*",
    },
  });
  const domain = await packageAt("packages/domain", "@taskdesk/domain");
  const email = await packageAt("packages/email", "@taskdesk/email");
  const libs = await packageAt("packages/libs", "@taskdesk/libs", {
    dependencies: { "api-alias": "workspace:@taskdesk/api@*" },
    imports: { "#api": "@taskdesk/api" },
  });
  await writeFile(
    path.join(api, "src", "auth.ts"),
    "export const value = 1;\n",
  );
  await writeFile(path.join(domain, "src", "index.ts"), "export {};\n");
  await writeFile(path.join(email, "src", "index.ts"), "export {};\n");
  await writeFile(
    path.join(web, "src", "edge.ts"),
    'import "@taskdesk/domain"; import "@taskdesk/email";',
  );
  await writeFile(
    path.join(libs, "src", "edge.ts"),
    'import "#api"; import "api-alias"; import "~api/auth";',
  );
  const { violations } = await analyzeDependencies(root);
  const messages = violations.join("\n");
  assert.match(
    messages,
    /@taskdesk\/web\/package\.json.*outside the documented workspace edge matrix/s,
  );
  assert.match(
    messages,
    /apps\/web\/src\/edge\.ts.*outside the documented workspace edge matrix/s,
  );
  assert.match(messages, /packages\/libs\/src\/edge\.ts.*from apps\/\*\*/s);
});

test("the monorepo boundary definition is pinned to the enforced edge matrix", async () => {
  const doc = await readFile(
    new URL("../../docs/01-architecture/monorepo-layout.md", import.meta.url),
    "utf8",
  );
  assert.match(doc, /complete permitted workspace-package edges/);
  assert.match(doc, /`pnpm check:deps` enforces this in CI/);
  const documented = new Map(
    [...doc.matchAll(/^\| `(@taskdesk\/[^`]+)` \| (.*?) \|$/gm)].map(
      ([, workspace, edges]) => [
        workspace,
        edges === "(none)"
          ? []
          : edges.split(", ").map((edge) => edge.replaceAll("`", "")),
      ],
    ),
  );
  assert.deepEqual(
    [...documented]
      .map(([workspace, edges]) => [workspace, [...edges].sort()])
      .sort(),
    [...WORKSPACE_EDGES]
      .map(([workspace, edges]) => [workspace, [...edges].sort()])
      .sort(),
  );
});

test("an ambient module augmentation of a third-party package is not misattributed to whichever workspace declares it (#393)", async (t) => {
  // #389/#390 each added packages/ui/src/test/a11y.ts with this exact `declare module
  // "vitest"` shape (augmenting vitest's own Matchers interface for a custom
  // `toHaveNoViolations` assertion). resolveWorkspaceTarget's checker-symbol fallback
  // walked the "vitest" module symbol's declarations and returned the first one sitting
  // inside a workspace — which was this augmentation, not vitest's own real declaration —
  // so every OTHER package's `import ... from "vitest"` got misattributed to
  // @taskdesk/ui, producing 69 false "outside the workspace edge matrix"/"pure leaf"
  // violations. The augmentation's own PRs worked around the trigger by deleting it; this
  // is the checker fix so the next ambient augmentation of any third-party module doesn't
  // reproduce the same false-positive class.
  //
  // `packages/domain`'s own tsconfig "include" is widened to also cover
  // `packages/ui/src/test/a11y.ts` directly. That's what actually gets both files'
  // declarations merged into the SAME ts.Program for the "vitest" module symbol — the
  // exact condition that mattered in production too (module augmentations merge program-
  // wide once the augmenting file is part of the compilation), without depending on
  // whichever project-assignment path put the real a11y.ts in the same program as an
  // unrelated package's test file there.
  const root = await mkdtemp(
    path.join(os.tmpdir(), "taskdesk-deps-augmentation-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));

  async function packageAt(relative, name, tsconfig) {
    const directory = path.join(root, relative);
    await mkdir(path.join(directory, "src"), { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name }),
    );
    await writeFile(
      path.join(directory, "tsconfig.json"),
      JSON.stringify(tsconfig),
    );
    return directory;
  }

  const ui = await packageAt("packages/ui", "@taskdesk/ui", {
    compilerOptions: { allowJs: true },
  });
  const domain = await packageAt("packages/domain", "@taskdesk/domain", {
    compilerOptions: { allowJs: true },
    include: ["src/**/*", "../ui/src/test/a11y.ts"],
  });

  // A real, physically resolvable third-party package (mirrors vitest being a real
  // dependency in the original trigger, not a shorthand/unresolvable ambient module).
  await mkdir(path.join(root, "node_modules/some-external-package"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "node_modules/some-external-package/package.json"),
    JSON.stringify({ name: "some-external-package", types: "index.d.ts" }),
  );
  await writeFile(
    path.join(root, "node_modules/some-external-package/index.d.ts"),
    "export declare function thing(): void;\n",
  );

  // The ambient module augmentation of a third-party module, living in @taskdesk/ui —
  // same shape as the real a11y.ts trigger.
  await mkdir(path.join(ui, "src/test"), { recursive: true });
  await writeFile(
    path.join(ui, "src/test/a11y.ts"),
    `declare module "some-external-package" {
  export function extra(): void;
}
export {};
`,
  );

  // A DIFFERENT workspace package — a documented pure leaf, no less — importing the
  // same third-party module from a test file, same as packages/domain's real
  // `import ... from "vitest"` in the original bug.
  await writeFile(
    path.join(domain, "src/index.test.ts"),
    'import { thing } from "some-external-package";\n',
  );

  const { violations } = await analyzeDependencies(root);
  const messages = violations.join("\n");
  assert.doesNotMatch(
    messages,
    /packages\/domain\/src\/index\.test\.ts.*some-external-package/s,
  );
  assert.doesNotMatch(messages, /resolves to workspace "@taskdesk\/ui"/);
});

test("a bare specifier with no real declaration and no declared dependency is flagged, even when an unrelated workspace's ambient shim is the only thing TypeScript finds (#424 F3)", async (t) => {
  // The pre-existing gap #424's F3 describes: a bare specifier that links into another
  // workspace through a mechanism TypeScript can't type-resolve is only detectable today if
  // a `declare module` shim for it happens to sit in the TARGET workspace — the shim is what
  // #393's guard (rightly) skips as "never the specifier's real home," so when the shim sits
  // somewhere else entirely (as here), the checker symbol resolution finds nothing usable at
  // all and the specifier was previously waved through as "unresolved" with no violation.
  // Fix: when this fallback's symbol resolution can't tie the specifier to any real
  // (non-ambient) declaration, fall back to validating the bare name against the importing
  // workspace's own package.json dependency fields instead of trusting resolution — a name
  // that is neither a Node builtin nor declared there has no legitimate story.
  const root = await mkdtemp(path.join(os.tmpdir(), "taskdesk-deps-baredep-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  async function packageAt(relative, name, tsconfig) {
    const directory = path.join(root, relative);
    await mkdir(path.join(directory, "src"), { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name }),
    );
    await writeFile(
      path.join(directory, "tsconfig.json"),
      JSON.stringify(tsconfig),
    );
    return directory;
  }

  // The importer. No node_modules entry and no package.json dependency exists anywhere for
  // "cross-workspace-injected" — it is not a real, resolvable third-party package.
  const a = await packageAt("packages/a", "@taskdesk/a", {
    compilerOptions: { allowJs: true },
    include: ["src/**/*", "../b/src/shim.ts"],
  });
  // A different workspace than the importer, holding the only `declare module` for the
  // specifier — same shape as #393's trigger, but deliberately NOT the importer's own
  // workspace, so the old "unresolved => no violation" fallback is what fires without F3.
  const b = await packageAt("packages/b", "@taskdesk/b", {
    compilerOptions: { allowJs: true },
  });

  await writeFile(
    path.join(b, "src/shim.ts"),
    `declare module "cross-workspace-injected" {
  export function thing(): void;
}
export {};
`,
  );

  await writeFile(
    path.join(a, "src/index.ts"),
    'import { thing } from "cross-workspace-injected";\nthing();\n',
  );

  const { violations } = await analyzeDependencies(root);
  const messages = violations.join("\n");
  assert.match(
    messages,
    /packages\/a\/src\/index\.ts.*cross-workspace-injected.*not declared as a dependency in @taskdesk\/a\/package\.json/s,
  );
});
