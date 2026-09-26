// Adversarial verification for the check:deps createRequire-by-name redesign (PR #361,
// third round on scripts/ci/check-deps.mjs's createRequire detection).
//
// Round 1 found 3 bypasses and "fixed" them by enumerating those 3 syntactic shapes. Round
// 2 found the "fix" was still an enumeration (not a real generalization) and found 5 MORE
// bypasses. This redesign stops enumerating syntactic shapes for how the createRequire
// *receiver* was obtained and instead flags any call whose callee is *literally named*
// createRequire, regardless of provenance — see check-deps.mjs's isCreateRequireCallee.
//
// This file exercises, independently of the existing check-deps.test.mjs suite:
//   - all 3 round-1 bypasses
//   - all 5 round-2 bypasses
//   - the parenthesization gap round 2 flagged separately (LOW severity, same root cause)
//   - 4 genuinely new indirection shapes invented for this round (class method, IIFE via
//     array destructuring, Map construction, generator yield) to demonstrate the new
//     approach is robust to shapes nobody has enumerated yet, not just the known list
//   - that the one legitimate, non-bypassing, same-workspace createRequire use in this
//     repository (packages/mcp/src/server.ts's package-version read) is still NOT flagged
//     as a boundary violation, and that the same allowlisted shape still fails closed the
//     moment it's used to reach outside its own workspace
//
// Round 3 closes the one gap the by-name redesign explicitly documented and accepted:
// import-time renaming, where the call-site identifier is no longer spelled "createRequire"
// at all (`import { createRequire as cr } from "node:module"; cr(...)`). This is a bounded
// alias-resolution problem (trace an identifier back to its own declaration), not the
// unbounded data-flow-tracing problem rounds 1-2 were beaten by — so it stays in scope for
// static, single-file AST analysis. Explicitly OUT of scope, still: computed/reflective
// access (`globalThis["create" + "Require"]`, `eval`, `new Function(...)`) and cross-file
// re-export chasing — those remain accepted limits of this analysis, the same way a
// scope-based lint rule doesn't chase arbitrary reflection either.
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

const KNOWN_BYPASSES = {
  "round1-dynamic-import-property-access": [
    'const modns = await import("node:module");',
    "const req = modns.createRequire(import.meta.url);",
    'req("@taskdesk/api");',
  ],
  "round1-destructured-dynamic-import": [
    'const { createRequire } = await import("node:module");',
    "const req = createRequire(import.meta.url);",
    'req("@taskdesk/api");',
  ],
  "round1-process-getBuiltinModule": [
    'const mod = process.getBuiltinModule("node:module");',
    "const req = mod.createRequire(import.meta.url);",
    'req("@taskdesk/api");',
  ],
  "round2-passthrough-function-call": [
    'const modns = identity(await import("node:module"));',
    "const req = modns.createRequire(import.meta.url);",
    'req("@taskdesk/api");',
  ],
  "round2-plain-reassignment": [
    "let modns;",
    'modns = await import("node:module");',
    "const req = modns.createRequire(import.meta.url);",
    'req("@taskdesk/api");',
  ],
  "round2-object-property-destination": [
    'const holder = { m: await import("node:module") };',
    "const req = holder.m.createRequire(import.meta.url);",
    'req("@taskdesk/api");',
  ],
  "round2-then-callback": [
    'import("node:module").then((modns) => {',
    "  const req = modns.createRequire(import.meta.url);",
    '  req("@taskdesk/api");',
    "});",
  ],
  "round2-array-destructuring-promise-all": [
    'const [modns] = await Promise.all([import("node:module")]);',
    "const req = modns.createRequire(import.meta.url);",
    'req("@taskdesk/api");',
  ],
};

test("all 8 known bypasses (round 1 + round 2) now produce a violation", async (t) => {
  await withRoot("taskdesk-deps-cr-known-", async (root) => {
    const libs = await packageAt(root, "packages/libs", "@taskdesk/libs");
    await packageAt(root, "apps/api", "@taskdesk/api");
    for (const [name, lines] of Object.entries(KNOWN_BYPASSES)) {
      await writeFile(path.join(libs, "src", `${name}.ts`), lines.join("\n"));
    }
    const { violations } = await analyzeDependencies(root);
    const messages = violations.join("\n");
    for (const name of Object.keys(KNOWN_BYPASSES)) {
      assert.match(
        messages,
        new RegExp(`packages/libs/src/${name}\\.ts.*createRequire`, "s"),
        `${name}: expected a createRequire violation`,
      );
      assert.match(
        messages,
        new RegExp(`packages/libs/src/${name}\\.ts.*from apps/\\*`, "s"),
        `${name}: expected the traced require call to be caught crossing into apps/**`,
      );
    }
  });
});

test("the parenthesization gap is closed for both callee shapes", async (t) => {
  await withRoot("taskdesk-deps-cr-parens-", async (root) => {
    const libs = await packageAt(root, "packages/libs", "@taskdesk/libs");
    await packageAt(root, "apps/api", "@taskdesk/api");
    await writeFile(
      path.join(libs, "src/parenthesized-bare.ts"),
      [
        'import { createRequire } from "node:module";',
        "const req = (createRequire)(import.meta.url);",
        'req("@taskdesk/api");',
      ].join("\n"),
    );
    await writeFile(
      path.join(libs, "src/parenthesized-property.ts"),
      [
        'const modns = await import("node:module");',
        "const req = (modns.createRequire)(import.meta.url);",
        'req("@taskdesk/api");',
      ].join("\n"),
    );
    const { violations } = await analyzeDependencies(root);
    const messages = violations.join("\n");
    assert.match(
      messages,
      /packages\/libs\/src\/parenthesized-bare\.ts.*createRequire/s,
    );
    assert.match(
      messages,
      /packages\/libs\/src\/parenthesized-bare\.ts.*from apps\/\*/s,
    );
    assert.match(
      messages,
      /packages\/libs\/src\/parenthesized-property\.ts.*createRequire/s,
    );
    assert.match(
      messages,
      /packages\/libs\/src\/parenthesized-property\.ts.*from apps\/\*/s,
    );
  });
});

test("4 genuinely new indirection shapes invented for this round are also caught", async (t) => {
  await withRoot("taskdesk-deps-cr-novel-", async (root) => {
    const libs = await packageAt(root, "packages/libs", "@taskdesk/libs");
    await packageAt(root, "apps/api", "@taskdesk/api");
    // A class method that hands back the acquisition; nothing about a class body is
    // special to a blind full-tree walk.
    await writeFile(
      path.join(libs, "src/class-method.ts"),
      [
        "class Loader {",
        "  acquire() {",
        "    return createRequire(import.meta.url);",
        "  }",
        "}",
        'new Loader().acquire()("@taskdesk/api");',
      ].join("\n"),
    );
    // An IIFE whose return value is spread into an array literal and destructured back out.
    await writeFile(
      path.join(libs, "src/iife-array-destructure.ts"),
      [
        "const [req] = [(() => createRequire(import.meta.url))()];",
        'req("@taskdesk/api");',
      ].join("\n"),
    );
    // Stashed as a Map value.
    await writeFile(
      path.join(libs, "src/map-value.ts"),
      [
        'const registry = new Map([["mod", createRequire(import.meta.url)]]);',
        'registry.get("mod")("@taskdesk/api");',
      ].join("\n"),
    );
    // Yielded out of a generator.
    await writeFile(
      path.join(libs, "src/generator-yield.ts"),
      [
        "function* gen() {",
        "  yield createRequire(import.meta.url);",
        "}",
        "const req = gen().next().value;",
        'req("@taskdesk/api");',
      ].join("\n"),
    );
    const { violations } = await analyzeDependencies(root);
    const messages = violations.join("\n");
    for (const name of [
      "class-method",
      "iife-array-destructure",
      "map-value",
      "generator-yield",
    ]) {
      assert.match(
        messages,
        new RegExp(`packages/libs/src/${name}\\.ts.*createRequire`, "s"),
        `${name}: the acquisition itself must fail closed regardless of its container`,
      );
    }
  });
});

test("the one legitimate, same-workspace createRequire use is not flagged as a boundary violation, and still fails closed the moment it reaches outside its workspace", async (t) => {
  await withRoot("taskdesk-deps-cr-legit-", async (root) => {
    const mcp = await packageAt(root, "packages/mcp", "@taskdesk/mcp");
    await packageAt(root, "apps/api", "@taskdesk/api");
    // Exactly the real packages/mcp/src/server.ts shape: createRequire(import.meta.url)
    // bound to a plain `require`, used only to read this package's own package.json.
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
      "the allowlisted, same-workspace createRequire use must not be flagged at all",
    );
  });
  // Same permitted shape (variable named `require`, single import.meta.url argument, in
  // the allowlisted file), but this time used to reach into another workspace: the
  // acquisition is exempt, but the traced require call must still be caught crossing out.
  await withRoot("taskdesk-deps-cr-legit-shape-crosses-", async (root) => {
    const mcp = await packageAt(root, "packages/mcp", "@taskdesk/mcp");
    await packageAt(root, "apps/api", "@taskdesk/api");
    await writeFile(
      path.join(mcp, "src/server.ts"),
      [
        'import { createRequire } from "node:module";',
        "const require = createRequire(import.meta.url);",
        'const client = require("@taskdesk/api");',
      ].join("\n"),
    );
    const { violations } = await analyzeDependencies(root);
    const messages = violations.join("\n");
    assert.doesNotMatch(
      messages,
      /packages\/mcp\/src\/server\.ts.*createRequire/s,
      "the acquisition itself stays exempt under the allowlisted shape",
    );
    assert.match(
      messages,
      /packages\/mcp\/src\/server\.ts.*(from apps\/\*|non-static module specifier)/s,
      "requiring anything other than the allowlisted specifier through the exempted loader must still fail closed",
    );
  });
});

const ALIAS_BYPASSES = {
  // The gap round 2's redesign explicitly documented and accepted: the call-site
  // identifier is `cr`, never spelled "createRequire" at all.
  "round3-static-import-alias": [
    'import { createRequire as cr } from "node:module";',
    "const req = cr(import.meta.url);",
    'req("@taskdesk/api");',
  ],
  "round3-namespace-property-alias": [
    'import * as M from "node:module";',
    "const cr = M.createRequire;",
    'cr(import.meta.url)("@taskdesk/api");',
  ],
  // The one shape that was genuinely unhandled before this round: a destructuring rename
  // off a DYNAMIC import, which the static-ImportDeclaration check never sees.
  "round3-dynamic-destructure-alias": [
    'const { createRequire: cr } = await import("node:module");',
    'cr(import.meta.url)("@taskdesk/api");',
  ],
};

test("round 3: import-time renaming (any alias, static or dynamic) is caught", async (t) => {
  await withRoot("taskdesk-deps-cr-alias-", async (root) => {
    const libs = await packageAt(root, "packages/libs", "@taskdesk/libs");
    await packageAt(root, "apps/api", "@taskdesk/api");
    for (const [name, lines] of Object.entries(ALIAS_BYPASSES)) {
      await writeFile(path.join(libs, "src", `${name}.ts`), lines.join("\n"));
    }
    const { violations } = await analyzeDependencies(root);
    const messages = violations.join("\n");
    for (const name of Object.keys(ALIAS_BYPASSES)) {
      assert.match(
        messages,
        new RegExp(`packages/libs/src/${name}\\.ts.*createRequire`, "s"),
        `${name}: expected a createRequire violation despite the local alias`,
      );
    }
  });
});

test("round 3: renaming an unrelated destructured binding is not mistaken for createRequire", async (t) => {
  await withRoot("taskdesk-deps-cr-unrelated-rename-", async (root) => {
    const libs = await packageAt(root, "packages/libs", "@taskdesk/libs");
    await writeFile(
      path.join(libs, "src/unrelated-rename.ts"),
      [
        'const { readFile: rf } = await import("node:fs/promises");',
        'rf("./x.json");',
      ].join("\n"),
    );
    const { violations } = await analyzeDependencies(root);
    assert.doesNotMatch(
      violations.filter((v) => v.includes("unrelated-rename")).join("\n"),
      /createRequire/,
      "renaming a binding that isn't createRequire must not be flagged as createRequire",
    );
  });
});

test("round 3: a plain (non-renaming) destructure off a dynamic import is still caught via its later call, unaffected", async (t) => {
  await withRoot("taskdesk-deps-cr-plain-destructure-", async (root) => {
    const libs = await packageAt(root, "packages/libs", "@taskdesk/libs");
    await packageAt(root, "apps/api", "@taskdesk/api");
    await writeFile(
      path.join(libs, "src/plain-destructure.ts"),
      [
        'const { createRequire } = await import("node:module");',
        "const req = createRequire(import.meta.url);",
        'req("@taskdesk/api");',
      ].join("\n"),
    );
    const { violations } = await analyzeDependencies(root);
    assert.match(
      violations.join("\n"),
      /packages\/libs\/src\/plain-destructure\.ts.*createRequire/s,
    );
  });
});
