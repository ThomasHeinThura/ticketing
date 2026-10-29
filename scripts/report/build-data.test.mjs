import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildData } from "./build-data.mjs";

const verification = [
  "implemented_tested",
  "implemented_untested",
  "partial",
  "missing",
  "external_blocked",
  "unverified",
];
const index = {
  requirements: Array.from({ length: 7 }, (_, i) => ({
    id: `R-${i}`,
    phase: `P${i}`,
    verification: verification[i % verification.length],
  })),
};
const previous = {
  generated: "2026-10-29T12:04:56.689Z",
  decisions: [],
  validation_history: [{ receipt: "retained" }],
  arbitrary: { note: "retained" },
  phases: index.requirements.map(({ phase }) => ({
    id: phase,
    name: `Name ${phase}`,
    accepted: "accepted",
    review: { verdict: "pass" },
    gates: null,
    browser: { verified: 0 },
    historical_summary: { receipt: "old" },
    unknown: ["retained"],
    states: { browser_verified: 0, implemented_tested: 99 },
  })),
};

test("all phase counts come from individual verification; evidence survives deterministically", () => {
  const inputSnapshot = JSON.stringify({ index, previous });
  const rebuilt = buildData(index, previous);
  assert.equal(rebuilt.phases.length, 7);
  assert.deepEqual(rebuilt.phases[6], {
    ...previous.phases[6],
    total: 1,
    states: {
      browser_verified: 0,
      implemented_tested: 1,
      implemented_untested: 0,
      partial: 0,
      missing: 0,
      external_blocked: 0,
      unaudited: 0,
    },
    unaudited: 0,
  });
  assert.equal(rebuilt.phases[1].states.implemented_untested, 1);
  assert.equal(rebuilt.phases[1].states.implemented_tested, 0);
  assert.equal(rebuilt.phases[5].unaudited, 1);
  assert.deepEqual(rebuilt.validation_history, previous.validation_history);
  assert.deepEqual(rebuilt.arbitrary, previous.arbitrary);
  assert.deepEqual(buildData(index, rebuilt), rebuilt);
  assert.equal(previous.phases[6].states.implemented_tested, 99);
  assert.equal(JSON.stringify({ index, previous }), inputSnapshot);
});

test("renderer counts replace stale browser and unaudited values using explicit classifications", () => {
  const fixture = structuredClone(index);
  fixture.requirements[0].verification = "browser_verified";
  const report = structuredClone(previous);
  report.phases[0].states.browser_verified = 8;
  report.phases[5].states.unaudited = 9;
  const rebuilt = buildData(fixture, report);
  const keys = [
    "implemented_tested",
    "browser_verified",
    "implemented_untested",
    "partial",
    "missing",
    "external_blocked",
    "unaudited",
  ];
  for (const phase of rebuilt.phases) {
    assert.equal(
      keys.reduce(
        (sum, key) => sum + (phase.states[key] ?? phase[key] ?? 0),
        0,
      ),
      phase.total,
    );
    const old = report.phases.find((item) => item.id === phase.id);
    for (const key of [
      "accepted",
      "review",
      "gates",
      "historical_summary",
      "unknown",
    ])
      assert.deepEqual(phase[key], old[key]);
    assert.equal(phase.browser.verified, phase.states.browser_verified);
  }
  assert.equal(rebuilt.phases[0].states.browser_verified, 1);
  assert.equal(rebuilt.phases[0].states.implemented_tested, 0);
  assert.equal(rebuilt.phases[5].states.unaudited, 1);
});

test("reject invalid or incomplete inputs instead of losing evidence", () => {
  for (const invalid of [
    { requirements: [] },
    { requirements: [...index.requirements, index.requirements[0]] },
    { requirements: [{ ...index.requirements[0], phase: "P99" }] },
    { requirements: [{ ...index.requirements[0], verification: "unknown" }] },
    { requirements: [{ id: "R-0", phase: "P0" }] },
    { requirements: [{ id: "R-0", verification: "unverified" }] },
    { requirements: [null] },
    { requirements: index.requirements.slice(1) },
  ])
    assert.throws(() => buildData(invalid, previous));
  assert.throws(() =>
    buildData(index, {
      ...previous,
      phases: [...previous.phases, previous.phases[0]],
    }),
  );
  assert.throws(() => buildData(index, { ...previous, phases: [null] }));
  assert.throws(
    () =>
      buildData(index, {
        ...previous,
        phases: previous.phases.map((p, i) =>
          i ? p : { ...p, states: { ...p.states, unknown: 1 } },
        ),
      }),
    /Unknown state count/,
  );
  assert.throws(() =>
    buildData(index, {
      ...previous,
      phases: previous.phases.map((p, i) => (i ? p : { ...p, states: null })),
    }),
  );
  assert.throws(() =>
    buildData(index, {
      ...previous,
      phases: previous.phases.map((p, i) =>
        i ? p : { ...p, states_locked: true },
      ),
    }),
  );
  const rebuilt = buildData(index, previous);
  rebuilt.phases[0].states_locked = true;
  assert.deepEqual(buildData(index, rebuilt), rebuilt);
  rebuilt.phases[0].states.implemented_tested++;
  assert.throws(() => buildData(index, rebuilt), /Locked states conflict/);
  rebuilt.phases[0].states.implemented_tested--;
  rebuilt.phases[0].unaudited = 2;
  assert.throws(() => buildData(index, rebuilt), /Locked states conflict/);
});

test("reject malformed renderer-required metadata", () => {
  for (const report of [
    { ...previous, generated: null },
    { ...previous, decisions: {} },
    {
      ...previous,
      phases: previous.phases.map((p, i) => (i ? p : { ...p, name: null })),
    },
    {
      ...previous,
      phases: previous.phases.map((p, i) => (i ? p : { ...p, review: null })),
    },
    {
      ...previous,
      phases: previous.phases.map((p, i) => (i ? p : { ...p, carry: "bad" })),
    },
    { ...previous, validation_runs: "bad" },
    { ...previous, p6_goal: { goals: null } },
  ])
    assert.throws(() => buildData(index, report));
});

test("CLI writes deterministically and leaves the report intact on invalid input", () => {
  const dir = mkdtempSync(join(tmpdir(), "taskdesk-report-"));
  try {
    mkdirSync(join(dir, "docs/report"), { recursive: true });
    const indexPath = join(dir, "docs/requirements-index.json");
    const reportPath = join(dir, "docs/report/data.json");
    writeFileSync(indexPath, JSON.stringify(index));
    writeFileSync(reportPath, JSON.stringify(previous));
    const run = (...args) =>
      spawnSync(
        process.execPath,
        [fileURLToPath(new URL("./build-data.mjs", import.meta.url)), ...args],
        { cwd: dir, encoding: "utf8" },
      );
    assert.equal(run().status, 0);
    const first = readFileSync(reportPath, "utf8");
    assert.match(first, /^\{\n\t"generated":/);
    assert.equal(run().status, 0);
    assert.equal(readFileSync(reportPath, "utf8"), first);
    const legacy = run(join(dir, "docs/report"));
    assert.equal(legacy.status, 0);
    assert.match(legacy.stderr, /audit directory is ignored/);
    assert.equal(readFileSync(reportPath, "utf8"), first);
    assert.notEqual(run(join(dir, "missing")).status, 0);
    assert.equal(readFileSync(reportPath, "utf8"), first);
    writeFileSync(indexPath, "{broken json");
    assert.notEqual(run().status, 0);
    assert.equal(readFileSync(reportPath, "utf8"), first);
    writeFileSync(
      indexPath,
      JSON.stringify({
        requirements: [{ ...index.requirements[0], verification: "unknown" }],
      }),
    );
    assert.notEqual(run().status, 0);
    assert.equal(readFileSync(reportPath, "utf8"), first);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retained partial local evidence stays partial without becoming tested", () => {
  const retainedIndex = structuredClone(index);
  retainedIndex.requirements[0].verification = "partial_local_evidence";
  const rebuilt = buildData(retainedIndex, previous);
  assert.equal(rebuilt.phases[0].states.partial, 1);
  assert.equal(rebuilt.phases[0].states.implemented_tested, 0);
  assert.deepEqual(rebuilt.phases[0].review, previous.phases[0].review);
});

test("current index totals match explicit per-ID classifications without assuming a future audit", () => {
  const currentIndex = JSON.parse(
    readFileSync("docs/requirements-index.json", "utf8"),
  );
  const currentReport = JSON.parse(
    readFileSync("docs/report/data.json", "utf8"),
  );
  const rebuilt = buildData(currentIndex, currentReport);
  assert.equal(currentIndex.requirements.length, 673);
  assert.equal(rebuilt.phases.length, 7);
  for (const phase of rebuilt.phases) {
    const rows = currentIndex.requirements.filter(
      (requirement) => requirement.phase === phase.id,
    );
    assert.equal(phase.total, rows.length);
    for (const [state, count] of Object.entries(phase.states)) {
      const sourceValues =
        state === "unaudited"
          ? ["unverified"]
          : state === "partial"
            ? ["partial", "partial_local_evidence"]
            : [state];
      assert.equal(
        count,
        rows.filter((requirement) =>
          sourceValues.includes(requirement.verification),
        ).length,
        `${phase.id}: ${state}`,
      );
    }
    const { states, unaudited, total, browser, ...metadata } = phase;
    const {
      states: _states,
      unaudited: _unaudited,
      total: _total,
      browser: _browser,
      ...originalMetadata
    } = currentReport.phases.find((item) => item.id === phase.id);
    assert.deepEqual(metadata, originalMetadata);
  }
});
