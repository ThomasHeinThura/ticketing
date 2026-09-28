import assert from "node:assert/strict";
import test from "node:test";
import { findEnvReads } from "./env-reads.mjs";

// Issue #427 (Opus review of #423 pass 5, finding F7 — non-blocking follow-up). F6's fix
// (#423 pass 4) collected `exportedNames` so a LATER reassignment of an exported binding is
// charged, but only recognized a plain-identifier declaration name. An exported DESTRUCTURING
// declaration reassigned later was still silently dropped, because the name it introduces
// was never added to `exportedNames` in the first place. Each case below is confirmed to
// reproduce the regression (silently returning `[]`) against the pre-fix code, and to be
// charged after the fix, which collects binding names recursively (object patterns, array
// patterns, nesting, rest, and renamed keys).

test("#427: a later reassignment of an exported object-destructured binding is charged", () => {
  const reads = findEnvReads("export let { x } = o; x = process;");
  assert.ok(
    reads.some((read) => read.kind === "alias" || read.kind === "computed"),
    "expected export let { x } = o; x = process; to be charged",
  );
});

test("#427: a later reassignment of an exported array-destructured binding is charged", () => {
  const reads = findEnvReads("export let [x] = a; x = process;");
  assert.ok(
    reads.some((read) => read.kind === "alias" || read.kind === "computed"),
    "expected export let [x] = a; x = process; to be charged",
  );
});

test("#427: a later reassignment of an exported renamed-key destructured binding is charged", () => {
  const reads = findEnvReads("export let { a: x } = o; x = process;");
  assert.ok(
    reads.some((read) => read.kind === "alias" || read.kind === "computed"),
    "expected export let { a: x } = o; x = process; to be charged",
  );
});

test("#427: a nested destructured binding name is still collected", () => {
  const reads = findEnvReads("export let { a: { b } } = o; b = process;");
  assert.ok(
    reads.some((read) => read.kind === "alias" || read.kind === "computed"),
    "expected the nested binding name b to be tracked into exportedNames",
  );
});

test("#427: an array rest-destructured binding name is still collected", () => {
  const reads = findEnvReads("export let [, ...x] = o; x = process;");
  assert.ok(
    reads.some((read) => read.kind === "alias" || read.kind === "computed"),
    "expected the rest-destructured binding name x to be tracked into exportedNames",
  );
});

test("#427: a destructured binding with a default initializer is still collected", () => {
  const reads = findEnvReads("export let { x = 1 } = o; x = process;");
  assert.ok(
    reads.some((read) => read.kind === "alias" || read.kind === "computed"),
    "expected the defaulted binding name x to be tracked into exportedNames",
  );
});

test("#427: a later reassignment of a NON-exported destructured binding still charges 0 (unaffected)", () => {
  assert.deepEqual(findEnvReads("let { x } = o; x = process;"), []);
});
