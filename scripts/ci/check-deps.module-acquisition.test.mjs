// Adversarial verification for check:deps's F1/F2 fixes (PR #361, round 4 Opus review).
//
// Round 4 confirmed the createRequire-by-name class (rounds 1-3) is now genuinely closed
// (30 adversarial probes, all caught) but found a NEW class, not a variation of it: the gate
// only ever flagged the *name* createRequire, never flagged getting hold of the
// `module`/`node:module` builtin itself — which has other, createRequire-unrelated ways to
// load arbitrary code (Module._load, Module.prototype.require, module.register loader hooks
// that can redirect even an otherwise-compliant static import). The fix, per the reviewer's
// own spec, is one level up: treat the ACQUISITION of `module`/`node:module` as the flagged
// event, outside the one allowlisted file (packages/mcp/src/server.ts), plus flag
// `getBuiltinModule` by name the same way `createRequire` already is, and flag
// `module.constructor` / `require.main.constructor` by receiver text. This file verifies all
// 5 real loader shapes the review actually ran against Node 24's live ESM runtime, that the
// one legitimate node:module use stays unflagged, and F2 — the type-position `import(...)`
// gap (`export type` and JSDoc `@typedef`) — is closed the same way `import type` already
// works.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeDependencies } from "./check-deps.mjs";

async function packageAt(root, relative, name) {
  const directory = path.join(root, relative);
  await mkdir(path.join(directory, "src"), { recursive: true });
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({ name }),
  );
  return directory;
}

async function withRoot(prefix, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("F1: all 5 real-Node module-acquisition loader shapes are now caught", async (t) => {
  await withRoot("taskdesk-deps-module-acq-", async (root) => {
    const libs = await packageAt(root, "packages/libs", "@taskdesk/libs");
    await packageAt(root, "apps/api", "@taskdesk/api");

    // Shape 1: `import Module from "node:module"; Module._load(...)`.
    await writeFile(
      path.join(libs, "src/default-import-load.ts"),
      [
        'import Module from "node:module";',
        'Module._load("@taskdesk/api");',
      ].join("\n"),
    );
    // Shape 2: `Module.prototype.require.call(new Module(...), spec)`.
    await writeFile(
      path.join(libs, "src/prototype-require-call.ts"),
      [
        'import Module from "node:module";',
        'Module.prototype.require.call(new Module("x"), "@taskdesk/api");',
      ].join("\n"),
    );
    // Shape 3: `process.getBuiltinModule("module")._load(spec)`.
    await writeFile(
      path.join(libs, "src/get-builtin-module.ts"),
      [
        'const mod = process.getBuiltinModule("module");',
        'mod._load("@taskdesk/api");',
      ].join("\n"),
    );
    // Shape 4: in a .cts file, `module.constructor._load(spec)`.
    await writeFile(
      path.join(libs, "src/constructor-escape.cts"),
      'module.constructor._load("@taskdesk/api");\n',
    );
    // Shape 5: `import { register } from "node:module"` loader hooks — flagged by the
    // acquisition itself, not by enumerating "register" as another createRequire-style name.
    await writeFile(
      path.join(libs, "src/register-hook.ts"),
      [
        'import { register } from "node:module";',
        'register("./loader.js", import.meta.url);',
      ].join("\n"),
    );

    const { violations } = await analyzeDependencies(root);
    const messages = violations.join("\n");

    assert.match(
      messages,
      /packages\/libs\/src\/default-import-load\.ts.*acquires the "module"\/"node:module"/s,
      "a static default import of node:module must be flagged as an acquisition",
    );
    assert.match(
      messages,
      /packages\/libs\/src\/prototype-require-call\.ts.*acquires the "module"\/"node:module"/s,
      "the acquisition is flagged regardless of what's later done with Module",
    );
    assert.match(
      messages,
      /packages\/libs\/src\/get-builtin-module\.ts.*getBuiltinModule/s,
      "process.getBuiltinModule(...) must be flagged by name, unconditionally",
    );
    assert.match(
      messages,
      /packages\/libs\/src\/constructor-escape\.cts.*module\.constructor/s,
      "module.constructor must be flagged in a CommonJS-style .cts file",
    );
    assert.match(
      messages,
      /packages\/libs\/src\/register-hook\.ts.*acquires the "module"\/"node:module"/s,
      "importing ANY named binding from node:module (not just createRequire) must be flagged",
    );
  });
});

test('F1: require("node:module") and dynamic import("node:module") acquisitions are caught too', async (t) => {
  await withRoot("taskdesk-deps-module-acq-calls-", async (root) => {
    const libs = await packageAt(root, "packages/libs", "@taskdesk/libs");
    await writeFile(
      path.join(libs, "src/require-module.cts"),
      'const m = require("node:module");\nm._load("@taskdesk/api");\n',
    );
    await writeFile(
      path.join(libs, "src/dynamic-import-module.ts"),
      'const m = await import("module");\nm._load("@taskdesk/api");\n',
    );
    const { violations } = await analyzeDependencies(root);
    const messages = violations.join("\n");
    assert.match(
      messages,
      /packages\/libs\/src\/require-module\.cts.*acquires the "module"\/"node:module"/s,
    );
    assert.match(
      messages,
      /packages\/libs\/src\/dynamic-import-module\.ts.*acquires the "module"\/"node:module"/s,
      'a bare "module" specifier (no node: prefix) must be recognized too',
    );
  });
});

test("F1: the one legitimate node:module use (packages/mcp/src/server.ts) stays fully unflagged", async (t) => {
  await withRoot("taskdesk-deps-module-acq-legit-", async (root) => {
    const mcp = await packageAt(root, "packages/mcp", "@taskdesk/mcp");
    await writeFile(
      path.join(mcp, "package.json"),
      JSON.stringify({ name: "@taskdesk/mcp", version: "0.0.0" }),
    );
    await writeFile(
      path.join(mcp, "src/server.ts"),
      [
        'import { createRequire } from "node:module";',
        "const require = createRequire(import.meta.url);",
        'const { version } = require("../package.json");',
      ].join("\n"),
    );
    const { violations } = await analyzeDependencies(root);
    assert.doesNotMatch(
      violations.join("\n"),
      /packages\/mcp\/src\/server\.ts/,
      "the allowlisted file's documented node:module/createRequire use must not be flagged at all, including by the new module-acquisition/getBuiltinModule/module-constructor checks",
    );
  });
});

test("F1: getBuiltinModule and module.constructor stay flagged even inside the allowlisted file", async (t) => {
  // The allowlist exempts packages/mcp/src/server.ts's documented node:module/createRequire
  // acquisition only — it must not become a blanket exemption for the OTHER escape hatches
  // this round closes, which that file has no documented, legitimate use for.
  await withRoot("taskdesk-deps-module-acq-allowlist-scope-", async (root) => {
    const mcp = await packageAt(root, "packages/mcp", "@taskdesk/mcp");
    await writeFile(
      path.join(mcp, "package.json"),
      JSON.stringify({ name: "@taskdesk/mcp", version: "0.0.0" }),
    );
    await writeFile(
      path.join(mcp, "src/server.ts"),
      [
        'const mod = process.getBuiltinModule("module");',
        'mod._load("../package.json");',
      ].join("\n"),
    );
    const { violations } = await analyzeDependencies(root);
    assert.match(
      violations.join("\n"),
      /packages\/mcp\/src\/server\.ts.*getBuiltinModule/s,
      "getBuiltinModule is not part of the allowlisted shape and must still be flagged",
    );
  });
});

test("F2: export-type and JSDoc @typedef import() forms are now scanned, same as the already-working import type form", async (t) => {
  await withRoot("taskdesk-deps-import-type-", async (root) => {
    const domain = await packageAt(root, "packages/domain", "@taskdesk/domain");
    await packageAt(root, "apps/api", "@taskdesk/api");

    await writeFile(
      path.join(domain, "src/export-type.ts"),
      'export type Y = import("@taskdesk/api").X;\n',
    );
    await writeFile(
      path.join(domain, "src/typedef.js"),
      '/** @typedef {import("@taskdesk/api").X} Y */\nexport const z = 1;\n',
    );
    // Regression: the already-working `import type { X } from "..."` form must still work,
    // unaffected by adding the ImportType (type-position `import(...)`) handling above.
    await writeFile(
      path.join(domain, "src/import-type.ts"),
      'import type { X } from "@taskdesk/api";\n',
    );

    const { violations } = await analyzeDependencies(root);
    const messages = violations.join("\n");

    assert.match(
      messages,
      /packages\/domain\/src\/export-type\.ts.*pure leaf/s,
      "export type Y = import(...) must be recorded as a cross-package edge, same as import type",
    );
    assert.match(
      messages,
      /packages\/domain\/src\/typedef\.js.*pure leaf/s,
      "a JSDoc @typedef {import(...)} in a .js file must be recorded as a cross-package edge",
    );
    assert.match(
      messages,
      /packages\/domain\/src\/import-type\.ts.*pure leaf/s,
      "the already-working import type form must be unaffected by this change",
    );
  });
});
