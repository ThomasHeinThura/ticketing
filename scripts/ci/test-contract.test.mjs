import assert from "node:assert/strict";
import test from "node:test";
import {
  hasStableV2Tag,
  isMissingBaseFileError,
  oasdiffAssetFor,
  oasdiffExitError,
  parseApprovedBreaks,
  parseApprovedRedoclyFindings,
  parseLsRemoteTags,
  parseOasdiffBreakingJson,
  parseRedoclyReport,
  partitionApprovedBreaks,
  partitionApprovedRedoclyFindings,
  readBaseApprovedBreaks,
  readBaseApprovedRedoclyFindings,
  redoclyApprovedFindingIdentity,
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
  const report = {
    totals: { errors: 0, warnings: 0, ignored: 0 },
    problems: [],
  };
  const output = `validating spec.json...\n${JSON.stringify(report, null, 2)}\n\n✔ Validation successful.\n`;

  assert.deepEqual(parseRedoclyReport(output), report);
});

const approvedBreak = (overrides = {}) => ({
  operation: "GET /projects/{projectId}/work-items",
  rule: "response-body-type-changed",
  fingerprint: "fp-a",
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
  fingerprint: "fp-a",
  ...overrides,
});

test("oasdiff installer pins the Linux x64 archive unchanged", () => {
  assert.deepEqual(oasdiffAssetFor("linux", "x64"), {
    archiveName: "oasdiff_1.32.1_linux_amd64.tar.gz",
    archiveSha256:
      "7c8939fc49b75ee11fec66a5b83b37a2fca6aee109fed85013b1ba2ac2a1ee7f",
  });
});

test("oasdiff installer uses the pinned universal macOS archive on x64 and arm64", () => {
  const expected = {
    archiveName: "oasdiff_1.32.1_darwin_all.tar.gz",
    archiveSha256:
      "e4d74b7e2dfb9d4819e7fc720c905ec86547e4637ac270a2b0187c0f1fb7187e",
  };
  assert.deepEqual(oasdiffAssetFor("darwin", "x64"), expected);
  assert.deepEqual(oasdiffAssetFor("darwin", "arm64"), expected);
  assert.match(expected.archiveSha256, /^[a-f0-9]{64}$/);
});

test("oasdiff installer rejects unsupported platform tuples", () => {
  for (const [platform, arch] of [
    ["linux", "arm64"],
    ["win32", "x64"],
    ["freebsd", "x64"],
  ]) {
    assert.throws(() => oasdiffAssetFor(platform, arch), /does not support/);
  }
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

test("an exact (operation, rule, fingerprint) match passes", () => {
  const findings = parseOasdiffBreakingJson(JSON.stringify([oasdiffFinding()]));
  const { matched, unmatched, unusedEntries } = partitionApprovedBreaks(
    findings,
    [approvedBreak()],
  );
  assert.equal(matched.length, 1);
  assert.equal(unmatched.length, 0);
  assert.equal(unusedEntries.length, 0);
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

test("two findings with the same (operation, rule) and one entry: the unmatched one fails (F1)", () => {
  const findings = parseOasdiffBreakingJson(
    JSON.stringify([
      oasdiffFinding({ fingerprint: "fp-a" }),
      oasdiffFinding({ fingerprint: "fp-b" }),
    ]),
  );
  const { matched, unmatched, unusedEntries } = partitionApprovedBreaks(
    findings,
    [approvedBreak({ fingerprint: "fp-a" })],
  );
  assert.equal(matched.length, 1);
  assert.equal(unmatched.length, 1);
  assert.equal(unusedEntries.length, 0);
});

test("a new entry matching no finding fails, as a stale or typo'd entry (F1)", () => {
  const { matched, unmatched, unusedEntries } = partitionApprovedBreaks(
    [],
    [approvedBreak()],
  );
  assert.equal(matched.length, 0);
  assert.equal(unmatched.length, 0);
  assert.equal(unusedEntries.length, 1);
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
    parseApprovedBreaks(JSON.stringify([approvedBreak({ fingerprint: "" })])),
  );
  assert.throws(() =>
    parseApprovedBreaks(
      JSON.stringify([{ ...approvedBreak(), extra: "not allowed" }]),
    ),
  );
});

test("a duplicate (operation, rule, fingerprint) entry fails closed", () => {
  assert.throws(() =>
    parseApprovedBreaks(
      JSON.stringify([approvedBreak(), approvedBreak({ pr: 999 })]),
    ),
  );
});

test("distinct fingerprints on the same (operation, rule) are two valid entries, not duplicates", () => {
  const parsed = parseApprovedBreaks(
    JSON.stringify([
      approvedBreak({ fingerprint: "fp-a" }),
      approvedBreak({ fingerprint: "fp-b" }),
    ]),
  );
  assert.equal(parsed.length, 2);
});

test("valid distinct entries parse fine", () => {
  const parsed = parseApprovedBreaks(
    JSON.stringify([
      approvedBreak(),
      approvedBreak({
        rule: "response-required-property-removed",
        fingerprint: "fp-c",
      }),
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
  assert.throws(() =>
    parseOasdiffBreakingJson(
      JSON.stringify([{ id: "x", operation: "GET", path: "/x" }]),
    ),
  );
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

test("isMissingBaseFileError recognizes both of git show's 'missing path' messages", () => {
  assert.equal(
    isMissingBaseFileError(
      "fatal: path 'scripts/ci/openapi-approved-breaks.json' does not exist in 'origin/main'",
    ),
    true,
  );
  assert.equal(
    isMissingBaseFileError(
      "fatal: path 'scripts/ci/openapi-approved-breaks.json' exists on disk, but not in 'origin/main'",
    ),
    true,
  );
  assert.equal(isMissingBaseFileError("fatal: unable to access origin"), false);
  assert.equal(isMissingBaseFileError(""), false);
  assert.equal(isMissingBaseFileError(undefined), false);
});

test("readBaseApprovedBreaks treats a missing base file as empty (F1)", async () => {
  const runner = () => ({
    status: 128,
    stdout: "",
    stderr:
      "fatal: path 'scripts/ci/openapi-approved-breaks.json' does not exist in 'origin/main'",
  });
  assert.deepEqual(await readBaseApprovedBreaks(runner), []);
});

test("readBaseApprovedBreaks fails closed on any other read error (F1)", async () => {
  const runner = () => ({
    status: 128,
    stdout: "",
    stderr:
      "fatal: unable to access 'https://github.com/...': network unreachable",
  });
  await assert.rejects(() => readBaseApprovedBreaks(runner));
});

test("readBaseApprovedBreaks fails closed when the runner itself throws", async () => {
  const runner = () => {
    throw new Error("spawn git ENOENT");
  };
  await assert.rejects(() => readBaseApprovedBreaks(runner));
});

test("readBaseApprovedBreaks parses a present base file", async () => {
  const runner = () => ({
    status: 0,
    stdout: JSON.stringify([approvedBreak({ fingerprint: "fp-old" })]),
    stderr: "",
  });
  const base = await readBaseApprovedBreaks(runner);
  assert.equal(base.length, 1);
  assert.equal(base[0].fingerprint, "fp-old");
});

test("an entry already on base approves nothing, even against a new finding with the same (operation, rule) (F1)", () => {
  // origin/main already carries the entry for fingerprint fp-old (PR A's approved break,
  // now merged). PR B introduces a NEW finding with the same operation and rule but a
  // different fingerprint, and does not touch the allowlist file. That finding must fail —
  // the stale base entry must not cover it.
  const baseEntries = [approvedBreak({ fingerprint: "fp-old" })];
  const currentEntries = [approvedBreak({ fingerprint: "fp-old" })]; // unchanged, still on file
  const baseIdentities = new Set(
    baseEntries.map(
      (e) => `${e.operation}\u0000${e.rule}\u0000${e.fingerprint}`,
    ),
  );
  const newEntries = currentEntries.filter(
    (e) =>
      !baseIdentities.has(
        `${e.operation}\u0000${e.rule}\u0000${e.fingerprint}`,
      ),
  );
  assert.equal(newEntries.length, 0);

  const findings = parseOasdiffBreakingJson(
    JSON.stringify([oasdiffFinding({ fingerprint: "fp-new" })]),
  );
  const { matched, unmatched } = partitionApprovedBreaks(findings, newEntries);
  assert.equal(matched.length, 0);
  assert.equal(unmatched.length, 1);
});

const redoclyApprovedFinding = (overrides = {}) => ({
  operation: "GET /attachments/{id}",
  rule: "operation-2xx-response",
  pointer: "#/paths/~1attachments~1{id}/get/responses",
  reason: "redirect-only by design",
  decision: "decision-log 2026-09-28 redocly allowlist",
  pr: 450,
  ...overrides,
});

test("redoclyApprovedFindingIdentity binds on (rule, pointer) only", () => {
  assert.equal(
    redoclyApprovedFindingIdentity(redoclyApprovedFinding()),
    redoclyApprovedFindingIdentity(
      redoclyApprovedFinding({ operation: "different label", pr: 1 }),
    ),
  );
  assert.notEqual(
    redoclyApprovedFindingIdentity(redoclyApprovedFinding()),
    redoclyApprovedFindingIdentity(
      redoclyApprovedFinding({ pointer: "#/other" }),
    ),
  );
});

test("an unapproved Redocly finding fails", () => {
  const { matched, unmatched } = partitionApprovedRedoclyFindings(
    [
      problem(
        "warn",
        "operation-2xx-response",
        "#/paths/~1other~1{id}/get/responses",
      ),
    ],
    [redoclyApprovedFinding()],
  );
  assert.equal(matched.length, 0);
  assert.equal(unmatched.length, 1);
});

test("an exact (rule, pointer) match passes", () => {
  const { matched, unmatched, unusedEntries } =
    partitionApprovedRedoclyFindings(
      [
        problem(
          "warn",
          "operation-2xx-response",
          "#/paths/~1attachments~1{id}/get/responses",
        ),
      ],
      [redoclyApprovedFinding()],
    );
  assert.equal(matched.length, 1);
  assert.equal(unmatched.length, 0);
  assert.equal(unusedEntries.length, 0);
});

test("a new Redocly allowlist entry matching no finding fails, as a stale or typo'd entry", () => {
  const { matched, unmatched, unusedEntries } =
    partitionApprovedRedoclyFindings([], [redoclyApprovedFinding()]);
  assert.equal(matched.length, 0);
  assert.equal(unmatched.length, 0);
  assert.equal(unusedEntries.length, 1);
});

test("a malformed Redocly allowlist file fails closed", () => {
  assert.throws(() => parseApprovedRedoclyFindings("{ not an array }"));
  assert.throws(() =>
    parseApprovedRedoclyFindings(JSON.stringify([{ rule: "x" }])),
  );
  assert.throws(() =>
    parseApprovedRedoclyFindings(
      JSON.stringify([redoclyApprovedFinding({ pr: "450" })]),
    ),
  );
  assert.throws(() =>
    parseApprovedRedoclyFindings(
      JSON.stringify([redoclyApprovedFinding({ reason: "" })]),
    ),
  );
  assert.throws(() =>
    parseApprovedRedoclyFindings(
      JSON.stringify([redoclyApprovedFinding({ pointer: "" })]),
    ),
  );
  assert.throws(() =>
    parseApprovedRedoclyFindings(
      JSON.stringify([{ ...redoclyApprovedFinding(), extra: "not allowed" }]),
    ),
  );
});

test("a duplicate (rule, pointer) Redocly allowlist entry fails closed", () => {
  assert.throws(() =>
    parseApprovedRedoclyFindings(
      JSON.stringify([
        redoclyApprovedFinding(),
        redoclyApprovedFinding({ pr: 999 }),
      ]),
    ),
  );
});

test("distinct pointers for the same rule are two valid Redocly allowlist entries", () => {
  const parsed = parseApprovedRedoclyFindings(
    JSON.stringify([
      redoclyApprovedFinding({ pointer: "#/paths/~1a/get/responses" }),
      redoclyApprovedFinding({ pointer: "#/paths/~1b/get/responses" }),
    ]),
  );
  assert.equal(parsed.length, 2);
});

test("readBaseApprovedRedoclyFindings treats a missing base file as empty", async () => {
  const runner = () => ({
    status: 128,
    stdout: "",
    stderr:
      "fatal: path 'scripts/ci/redocly-approved-findings.json' does not exist in 'origin/main'",
  });
  assert.deepEqual(await readBaseApprovedRedoclyFindings(runner), []);
});

test("readBaseApprovedRedoclyFindings fails closed on any other read error", async () => {
  const runner = () => ({
    status: 128,
    stdout: "",
    stderr:
      "fatal: unable to access 'https://github.com/...': network unreachable",
  });
  await assert.rejects(() => readBaseApprovedRedoclyFindings(runner));
});

test("readBaseApprovedRedoclyFindings parses a present base file", async () => {
  const runner = () => ({
    status: 0,
    stdout: JSON.stringify([redoclyApprovedFinding({ pr: 1 })]),
    stderr: "",
  });
  const base = await readBaseApprovedRedoclyFindings(runner);
  assert.equal(base.length, 1);
  assert.equal(base[0].pr, 1);
});

test("an entry already on base approves nothing against a new finding at the same pointer", () => {
  // Mirrors the equivalent oasdiff-allowlist F1 test above: an entry origin/main already
  // has must not cover a finding this PR did not itself add an entry for.
  const baseEntries = [redoclyApprovedFinding({ pr: 1 })];
  const currentEntries = [redoclyApprovedFinding({ pr: 1 })]; // unchanged, still on file
  const baseIdentities = new Set(
    baseEntries.map(redoclyApprovedFindingIdentity),
  );
  const newEntries = currentEntries.filter(
    (e) => !baseIdentities.has(redoclyApprovedFindingIdentity(e)),
  );
  assert.equal(newEntries.length, 0);

  const { matched, unmatched } = partitionApprovedRedoclyFindings(
    [
      problem(
        "warn",
        "operation-2xx-response",
        "#/paths/~1attachments~1{id}/get/responses",
      ),
    ],
    newEntries,
  );
  assert.equal(matched.length, 0);
  assert.equal(unmatched.length, 1);
});

test("oasdiffExitError passes a clean exit 0", () => {
  assert.equal(oasdiffExitError(0, 0), null);
});

test("oasdiffExitError passes exit 1 with findings present", () => {
  assert.equal(oasdiffExitError(1, 2), null);
});

test("oasdiffExitError fails on an unexpected exit code", () => {
  assert.notEqual(oasdiffExitError(2, 0), null);
  assert.notEqual(oasdiffExitError(null, 0), null);
});

test("oasdiffExitError fails when exit 1 reports zero findings", () => {
  assert.notEqual(oasdiffExitError(1, 0), null);
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
