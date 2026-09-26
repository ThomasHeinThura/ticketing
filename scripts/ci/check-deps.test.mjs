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
      'export default { resolve: { alias: { "@api": path.resolve(__dirname, "../../apps/api/src") } } };',
    ].join("\n"),
  );
  await writeFile(path.join(web, "src/edge.ts"), 'import "@api/auth";');
  await writeFile(path.join(api, "src/auth.ts"), "export {};\n");
  const { violations } = await analyzeDependencies(root);
  assert.match(violations.join("\n"), /apps\/web\/src\/edge\.ts.*apps\/api/s);
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
