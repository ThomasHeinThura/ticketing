import assert from "node:assert/strict";
import test from "node:test";
import { findEnvReads } from "./env-reads.mjs";

// Opus review of #423 pass 2 (delta on the structural fix), F1-F4
// (docs/07-planning/security-reviews/423-env-reads-ast-rewrite.md). Each case below is
// confirmed, by running against `96df604` (this delta's pre-fix head), to reproduce the
// finding described; and to be fixed after it.

// F1 — the resolved-wrapper-call exemption in `isSafeConsumingContext` exempted every
// argument of a call like `require(...)`, not just the one `classify()` actually consumes
// (`node.arguments[0]`), so a second argument silently went unbudgeted. The call's own
// result is itself consumed by a tracked alias declaration (`const p = ...`) here, so it is
// NOT separately charged — isolating the count to exactly the second argument.
test("F1: a second argument to a resolved require() call is charged, not exempted", () => {
  const reads = findEnvReads('const p = require("process", process.env);');
  assert.equal(
    reads.length,
    1,
    "expected exactly one charge, for the second argument (process.env)",
  );
});

// F2 — `isTrackedAliasDeclarationSite`'s `bindableName` treated `ArrayBindingPattern` as
// already handled, but `handleBindingDeclaration` just returns for an array pattern without
// charging anything, so both shapes below silently gave `[]`.
test("F2: an array-pattern destructuring of process.env is charged (variable)", () => {
  const reads = findEnvReads("const [a] = process.env;");
  assert.ok(
    reads.length > 0,
    "expected const [a] = process.env; to be charged",
  );
});

test("F2: an array-pattern destructuring parameter default is charged", () => {
  const reads = findEnvReads("function f([a] = process.env) {}");
  assert.ok(
    reads.length > 0,
    "expected function f([a] = process.env) {} to be charged",
  );
});

// F3 — the LHS of a plain reassignment (not a declaration) was charged as a bare escape once
// its name became a tracked alias on a later fixed-point round, double-counting against the
// existing "does not charge a plain, non-exported alias declaration" behavior
// (`const p = process;` charges 0).
test("F3: a plain reassignment to an already-declared variable charges 0, matching a declaration", () => {
  assert.deepEqual(findEnvReads("let x; x = process;"), []);
});

test("F3: a later genuine read through the reassigned alias still charges", () => {
  const reads = findEnvReads("let x; x = process; use(x.env.SECRET);");
  assert.deepEqual(
    reads.map(({ kind, name }) => ({ kind, name })),
    [{ kind: "named", name: "SECRET" }],
  );
});

test("F3: exporting the reassigned alias charges exactly once (the export escape), not twice", () => {
  const reads = findEnvReads("let x; x = process; export { x };");
  assert.equal(reads.length, 1);
});

// F4 — several NAME positions weren't recognized and were wrongly charged as if
// process/globalThis were being read as values.
test("F4: typeof process !== 'undefined' is not charged", () => {
  assert.deepEqual(
    findEnvReads('if (typeof process !== "undefined") { 1; }'),
    [],
  );
});

test("F4: typeof narrowed through a member access is not charged", () => {
  assert.deepEqual(
    findEnvReads('if (typeof process.env !== "undefined") { 1; }'),
    [],
  );
});

test("F4: a labeled statement's label and its break target are not charged", () => {
  assert.deepEqual(
    findEnvReads("process: while (true) { break process; }"),
    [],
  );
});

test("F4: a JSX attribute's name is not charged", () => {
  assert.deepEqual(
    findEnvReads("const x = <C process={1}/>;", { jsx: true }),
    [],
  );
});

test("F4: a destructuring pattern's key, when it differs from the bound name, is not charged", () => {
  assert.deepEqual(findEnvReads("const { process: child } = options;"), []);
});

test("F4: an import specifier's original name is not charged", () => {
  assert.deepEqual(
    findEnvReads('import { process as p } from "./x"; console.log(p);'),
    [],
  );
});

test("F4: an export specifier's exported name (aliased away from an unrelated local) is not charged", () => {
  assert.deepEqual(findEnvReads("const x = 1; export { x as process };"), []);
});

test("F4: export * as process from a module is not charged (renames the namespace, not the real global)", () => {
  assert.deepEqual(findEnvReads('export * as process from "./x";'), []);
});

// Not a regression fix, but confirms F4's exemptions didn't also suppress the genuine
// module-boundary escape of the real global (`export { process }` with no separate local
// name — that identifier IS the real reference, same carve-out as a shorthand property).
test("F4: exporting the real global process by its own name still charges", () => {
  const reads = findEnvReads("export { process };");
  assert.ok(reads.length > 0, "expected export { process }; to still charge");
});
