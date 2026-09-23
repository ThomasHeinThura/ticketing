import assert from "node:assert/strict";
import test from "node:test";
import { unapprovedProblems } from "./test-contract.mjs";

const baseline = [["error", "no-identical-paths", "#/paths/~1task~1{id}"]];
const problem = (severity, ruleId, pointer) => ({
  severity,
  ruleId,
  location: [{ pointer }],
  message: "lint message",
});

test("the Redocly baseline accepts known inherited findings", () => {
  assert.deepEqual(
    unapprovedProblems(
      [problem("error", "no-identical-paths", "#/paths/~1task~1{id}")],
      baseline,
    ),
    [],
  );
});

test("the Redocly baseline is shrink-only and rejects a new finding", () => {
  assert.deepEqual(
    unapprovedProblems(
      [
        problem("error", "no-identical-paths", "#/paths/~1task~1{id}"),
        problem("error", "no-identical-paths", "#/paths/~1new-route~1{id}"),
      ],
      baseline,
    ).map((entry) => entry.location[0].pointer),
    ["#/paths/~1new-route~1{id}"],
  );
});

test("a fixed inherited finding may be removed without rewriting the baseline", () => {
  assert.deepEqual(unapprovedProblems([], baseline), []);
});

test("diagnostics cannot be hidden by downgrading severity", () => {
  assert.equal(
    unapprovedProblems(
      [problem("warning", "no-identical-paths", "#/paths/~1task~1{id}")],
      baseline,
    ).length,
    1,
  );
});
