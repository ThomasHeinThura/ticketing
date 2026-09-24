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

test("source scanner finds static, dynamic, require, and type-only edges", () => {
  assert.deepEqual(
    sourceImports(
      [
        'import { Button } from "@taskdesk/ui";',
        'export type { AppType } from "@taskdesk/api";',
        'void import("./lazy.js");',
        'const legacy = require("./legacy.cjs");',
      ].join("\n"),
    ),
    [
      { specifier: "@taskdesk/ui", line: 1, typeOnly: false },
      { specifier: "@taskdesk/api", line: 2, typeOnly: true },
      { specifier: "./lazy.js", line: 3, typeOnly: false },
      { specifier: "./legacy.cjs", line: 4, typeOnly: false },
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
  assert.match(messages, /packages\/ui\/src\/index\.ts.*from apps\/\*\*/s);
  assert.match(messages, /packages\/domain\/src\/index\.ts.*from apps\/\*\*/s);
  assert.doesNotMatch(messages, /packages\/libs\/src\/client\.ts/);
});
