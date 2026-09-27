import assert from "node:assert/strict";
import test from "node:test";
import { findEnvReads } from "./env-reads.mjs";

// Opus review of #423 pass 3 (short delta on the F1-F5 fix)
// (docs/07-planning/security-reviews/423-env-reads-ast-rewrite.md, "pass 3"). The F3 fix in
// `871e16d`/`6d9b83b` exempted `x = <value>` from the generic default charge whenever `x` is
// a plain, already-tracked identifier — but did so unconditionally, regardless of whether the
// assignment's own VALUE is actually consumed as an expression somewhere, or thrown away as a
// bare standalone statement. Each case below is confirmed, by running against `6d9b83b` (this
// delta's pre-fix head), to reproduce the regression described (silently returning `[]` where
// `871e16d` correctly charged); and to be fixed after it.

test("pass 3: an assignment used as a call argument is charged", () => {
  const reads = findEnvReads("let x; f(x = process);");
  assert.ok(reads.length > 0, "expected f(x = process); to be charged");
});

test("pass 3: a consumed assignment feeding a further member access is charged", () => {
  const reads = findEnvReads("let x; use((x = process).env.SECRET);");
  assert.ok(
    reads.length > 0,
    "expected use((x = process).env.SECRET); to be charged",
  );
});

test("pass 3: an assignment chained into another assignment is charged", () => {
  const reads = findEnvReads("let x, y; y = x = process; use(y.env.SECRET);");
  assert.ok(
    reads.length > 0,
    "expected y = x = process; use(y.env.SECRET); to be charged",
  );
});

test("pass 3: an assignment used as a declaration initializer is charged", () => {
  const reads = findEnvReads(
    "let x; const y = (x = process); use(y.env.SECRET);",
  );
  assert.ok(
    reads.length > 0,
    "expected const y = (x = process); use(y.env.SECRET); to be charged",
  );
});

test("pass 3: an assignment used as a return value is charged", () => {
  const reads = findEnvReads("let x; function f() { return x = process; }");
  assert.ok(reads.length > 0, "expected return x = process; to be charged");
});

test("pass 3: an assignment used as an export default value is charged", () => {
  const reads = findEnvReads("let x; export default (x = process);");
  assert.ok(
    reads.length > 0,
    "expected export default (x = process); to be charged",
  );
});

// The original F3 target case, and its siblings, must keep working exactly as before.
test("pass 3: a plain standalone reassignment still charges 0, matching a declaration", () => {
  assert.deepEqual(findEnvReads("let x; x = process;"), []);
  assert.deepEqual(findEnvReads("const p = process;"), []);
});

test("pass 3: a later genuine read through a standalone-reassigned alias still charges", () => {
  const reads = findEnvReads("let x; x = process; use(x.env.SECRET);");
  assert.deepEqual(
    reads.map(({ kind, name }) => ({ kind, name })),
    [{ kind: "named", name: "SECRET" }],
  );
});

test("pass 3: exporting a standalone-reassigned alias still charges exactly once", () => {
  const reads = findEnvReads("let x; x = process; export { x };");
  assert.equal(reads.length, 1);
});
