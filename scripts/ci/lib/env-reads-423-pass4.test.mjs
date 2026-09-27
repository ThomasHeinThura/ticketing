import assert from "node:assert/strict";
import test from "node:test";
import { findEnvReads } from "./env-reads.mjs";

// Opus review of #423 pass 4, finding F6
// (docs/07-planning/security-reviews/423-env-reads-ast-rewrite.md, "pass 4"). An exported
// binding assigned LATER (not at its own declaration) crosses the same module boundary as
// `export const p = process;`, but was silently uncharged because the `BinaryExpression`
// dispatch for a plain reassignment always passed `exported = false` to
// `handleBindingDeclaration`. Each case below is confirmed to reproduce the regression
// (silently returning `[]`) against the pre-fix code, and to be charged after the fix.

test("pass 4: a later reassignment of an exported let binding is charged", () => {
  const reads = findEnvReads("export let x; x = process;");
  assert.ok(
    reads.some((read) => read.kind === "alias" || read.kind === "computed"),
    "expected export let x; x = process; to be charged",
  );
});

test("pass 4: a later reassignment of an exported var binding from inside a function is charged", () => {
  const reads = findEnvReads("export var x; function init() { x = process; }");
  assert.ok(
    reads.some((read) => read.kind === "alias" || read.kind === "computed"),
    "expected the inner-function reassignment of exported x to be charged",
  );
});

test("pass 4: a later reassignment of an exported binding to import.meta is charged", () => {
  const reads = findEnvReads("export let x; x = import.meta;");
  assert.ok(
    reads.some((read) => read.kind === "alias" || read.kind === "computed"),
    "expected export let x; x = import.meta; to be charged",
  );
});

test("pass 4: an exported binding assigned at its own declaration still charges (unaffected)", () => {
  const reads = findEnvReads("export let x = process;");
  assert.ok(
    reads.some((read) => read.kind === "alias" || read.kind === "computed"),
    "expected export let x = process; to still be charged",
  );
});

test("pass 4: a later reassignment of a NON-exported binding still charges 0 (unaffected)", () => {
  assert.deepEqual(findEnvReads("let x; x = process;"), []);
});
