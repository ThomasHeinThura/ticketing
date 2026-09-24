import assert from "node:assert/strict";
import test from "node:test";
import { parseRedoclyReport, unapprovedProblems } from "./test-contract.mjs";

const problem = (severity, ruleId, pointer) => ({
  severity,
  ruleId,
  location: [{ pointer }],
  message: "lint message",
});
const baseline = [
  problem("error", "no-identical-paths", "#/paths/~1task~1{id}"),
];

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

test("a different diagnostic at the same rule and pointer is new", () => {
  const inherited = problem(
    "error",
    "no-identical-paths",
    "#/paths/~1task~1{id}",
  );
  const replacement = {
    ...inherited,
    message: "different contract problem at the same location",
  };

  assert.deepEqual(unapprovedProblems([replacement], [inherited]), [
    replacement,
  ]);
});

test("Redocly report parsing ignores status text printed after its JSON", () => {
  const report = {
    totals: { errors: 0, warnings: 0, ignored: 0 },
    problems: [],
  };
  const output = `validating spec.json...\n${JSON.stringify(report, null, 2)}\n\n✔ Validation successful.\n`;

  assert.deepEqual(parseRedoclyReport(output), report);
});

test("Redocly report parsing rejects multiple report objects", () => {
  const report = {
    totals: { errors: 0, warnings: 0, ignored: 0 },
    problems: [],
  };
  const serialized = JSON.stringify(report, null, 2);
  assert.throws(
    () => parseRedoclyReport(`${serialized}\n${serialized}`),
    /multiple JSON reports/,
  );
});

test("Redocly report parsing rejects a report without a problems array", () => {
  const report = { totals: { errors: 0, warnings: 0, ignored: 0 } };
  assert.throws(
    () => parseRedoclyReport(JSON.stringify(report, null, 2)),
    /missing totals or problems/,
  );
});

test("Redocly report parsing rejects counts that do not match problems", () => {
  const report = {
    totals: { errors: 1, warnings: 0, ignored: 0 },
    problems: [],
  };
  assert.throws(
    () => parseRedoclyReport(JSON.stringify(report, null, 2)),
    /totals do not match its problems/,
  );
});
