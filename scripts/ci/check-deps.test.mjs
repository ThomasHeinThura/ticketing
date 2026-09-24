import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  analyzeDependencies,
  findCycles,
  runtimeWorkspaceEdges,
  sourceImports,
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

test("workspace package names are read from the package segment only", () => {
  assert.equal(
    workspaceNameForSpecifier("@taskdesk/ui/components/button"),
    "@taskdesk/ui",
  );
  assert.equal(workspaceNameForSpecifier("@another/ui"), null);
  assert.equal(workspaceNameForSpecifier("./local"), null);
});

test("source scanner finds module edges across JavaScript syntax", () => {
  assert.deepEqual(
    sourceImports(
      [
        'import { Button } from "@taskdesk/ui";',
        'export type { AppType } from "@taskdesk/api";',
        'import { type AppType } from "@taskdesk/api";',
        'export { type AppType } from "@taskdesk/api";',
        'import type from "@taskdesk/api";',
        'import type AppType from "@taskdesk/api";',
        'import { type } from "@taskdesk/api";',
        'export { type as Type } from "@taskdesk/api";',
        'void import("./lazy.js");',
        'void import("./" + suffix);',
        "void import(`node:fs`);",
        "void import(`node:${" + "runtimeName" + "}`);",
        'const legacy = require("./legacy.cjs");',
        'const computedLegacy = require("./" + suffix);',
        "const computed = require(`dns/promises`);",
      ].join("\n"),
    ),
    [
      { specifier: "@taskdesk/ui", line: 1, typeOnly: false },
      { specifier: "@taskdesk/api", line: 2, typeOnly: true },
      { specifier: "@taskdesk/api", line: 3, typeOnly: false },
      { specifier: "@taskdesk/api", line: 4, typeOnly: false },
      { specifier: "@taskdesk/api", line: 5, typeOnly: false },
      { specifier: "@taskdesk/api", line: 6, typeOnly: true },
      { specifier: "@taskdesk/api", line: 7, typeOnly: false },
      { specifier: "@taskdesk/api", line: 8, typeOnly: false },
      { specifier: "./lazy.js", line: 9, typeOnly: false },
      { specifier: "<non-static module specifier>", line: 10, typeOnly: false },
      { specifier: "node:fs", line: 11, typeOnly: false },
      { specifier: "<non-static module specifier>", line: 12, typeOnly: false },
      { specifier: "./legacy.cjs", line: 13, typeOnly: false },
      { specifier: "<non-static module specifier>", line: 14, typeOnly: false },
      { specifier: "dns/promises", line: 15, typeOnly: false },
    ],
  );
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
    'import type from "@taskdesk/api";\n',
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
