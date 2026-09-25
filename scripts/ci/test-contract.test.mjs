import assert from "node:assert/strict";
import test from "node:test";
import {
  hasStableV2Tag,
  parseApprovedBreaks,
  parseLsRemoteTags,
  parseOasdiffBreakingJson,
  parseRedoclyReport,
  partitionApprovedBreaks,
  stableV2ReleaseExists,
  unapprovedProblems,
} from "./test-contract.mjs";

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
  const report = { totals: { errors: 0 }, problems: [] };
  const output = `validating spec.json...\n${JSON.stringify(report, null, 2)}\n\n✔ Validation successful.\n`;

  assert.deepEqual(parseRedoclyReport(output), report);
});

const approvedBreak = (overrides = {}) => ({
  operation: "GET /projects/{projectId}/work-items",
  rule: "response-body-type-changed",
  pr: 320,
  reason: "list envelope replaces bare array",
  decision: "decision-log 2026-09-25 pre-2.0 openapi allowlist",
  ...overrides,
});

const oasdiffFinding = (overrides = {}) => ({
  id: "response-body-type-changed",
  operation: "GET",
  path: "/projects/{projectId}/work-items",
  operationId: "listWorkItems",
  level: 3,
  text: "the response's body type changed",
  ...overrides,
});

test("an unapproved oasdiff finding fails", () => {
  const findings = parseOasdiffBreakingJson(
    JSON.stringify([oasdiffFinding({ id: "some-other-rule" })]),
  );
  const { matched, unmatched } = partitionApprovedBreaks(findings, [
    approvedBreak(),
  ]);
  assert.equal(matched.length, 0);
  assert.equal(unmatched.length, 1);
});

test("an exact (operation, rule) match passes", () => {
  const findings = parseOasdiffBreakingJson(JSON.stringify([oasdiffFinding()]));
  const { matched, unmatched } = partitionApprovedBreaks(findings, [
    approvedBreak(),
  ]);
  assert.equal(matched.length, 1);
  assert.equal(unmatched.length, 0);
});

test("the same operation with a different rule is not covered", () => {
  const findings = parseOasdiffBreakingJson(
    JSON.stringify([oasdiffFinding({ id: "request-body-required-added" })]),
  );
  const { matched, unmatched } = partitionApprovedBreaks(findings, [
    approvedBreak(),
  ]);
  assert.equal(matched.length, 0);
  assert.equal(unmatched.length, 1);
});

test("the same rule on a different operation is not covered", () => {
  const findings = parseOasdiffBreakingJson(
    JSON.stringify([oasdiffFinding({ path: "/projects/{projectId}/labels" })]),
  );
  const { matched, unmatched } = partitionApprovedBreaks(findings, [
    approvedBreak(),
  ]);
  assert.equal(matched.length, 0);
  assert.equal(unmatched.length, 1);
});

test("a malformed allowlist file fails closed", () => {
  assert.throws(() => parseApprovedBreaks("{ not an array }"));
  assert.throws(() =>
    parseApprovedBreaks(JSON.stringify([{ operation: "x" }])),
  );
  assert.throws(() =>
    parseApprovedBreaks(JSON.stringify([approvedBreak({ pr: "320" })])),
  );
  assert.throws(() =>
    parseApprovedBreaks(JSON.stringify([approvedBreak({ reason: "" })])),
  );
  assert.throws(() =>
    parseApprovedBreaks(
      JSON.stringify([{ ...approvedBreak(), extra: "not allowed" }]),
    ),
  );
});

test("a duplicate (operation, rule) entry fails closed", () => {
  assert.throws(() =>
    parseApprovedBreaks(
      JSON.stringify([approvedBreak(), approvedBreak({ pr: 999 })]),
    ),
  );
});

test("valid distinct entries parse fine", () => {
  const parsed = parseApprovedBreaks(
    JSON.stringify([
      approvedBreak(),
      approvedBreak({ rule: "response-required-property-removed" }),
    ]),
  );
  assert.equal(parsed.length, 2);
});

test("unparseable oasdiff output fails closed", () => {
  assert.throws(() => parseOasdiffBreakingJson("not json"));
  assert.throws(() =>
    parseOasdiffBreakingJson(JSON.stringify({ not: "an array" })),
  );
  assert.throws(() => parseOasdiffBreakingJson(JSON.stringify([{ id: "x" }])));
});

test("a stable v2.0.0+ tag is detected", () => {
  assert.equal(hasStableV2Tag(["v2.0.0"]), true);
  assert.equal(hasStableV2Tag(["2.1.3"]), true);
});

test("a pre-release v2 tag does not count as stable", () => {
  assert.equal(hasStableV2Tag(["v2.0.0-alpha.1"]), false);
  assert.equal(hasStableV2Tag(["v2.0.0-rc.2"]), false);
});

test("a stable pre-2.0 tag does not count", () => {
  assert.equal(hasStableV2Tag(["v1.9.9"]), false);
});

test("no tags at all is not a stable v2.0.0 release", () => {
  assert.equal(hasStableV2Tag([]), false);
});

test("garbage tag names are not mistaken for a stable release", () => {
  assert.equal(
    hasStableV2Tag(["latest", "v2", "release-2.0.0", "2.0", "v2.0.0.0"]),
    false,
  );
});

test("parseLsRemoteTags drops ^{} peeled refs and keeps the tag name", () => {
  const output = [
    "abc123\trefs/tags/v1.9.9",
    "def456\trefs/tags/v2.0.0",
    "def456\trefs/tags/v2.0.0^{}",
    "",
  ].join("\n");
  assert.deepEqual(parseLsRemoteTags(output), ["v1.9.9", "v2.0.0"]);
});

test("stableV2ReleaseExists is true when a stable v2 tag is on origin", async () => {
  const runner = () => ({
    status: 0,
    stdout: "sha\trefs/tags/v2.0.0\n",
    stderr: "",
  });
  assert.equal(await stableV2ReleaseExists(runner), true);
});

test("stableV2ReleaseExists fails closed when the lookup exits non-zero", async () => {
  const runner = () => ({
    status: 128,
    stdout: "",
    stderr: "fatal: unable to access origin",
  });
  await assert.rejects(() => stableV2ReleaseExists(runner));
});

test("stableV2ReleaseExists fails closed when the runner itself throws", async () => {
  const runner = () => {
    throw new Error("spawn git ENOENT");
  };
  await assert.rejects(() => stableV2ReleaseExists(runner));
});
