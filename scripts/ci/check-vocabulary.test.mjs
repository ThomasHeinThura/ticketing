import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { repoRoot } from "./lib/repo.mjs";
import {
  cleanUpScratchRepos,
  commit,
  initRepo,
  installCheckers,
  installFromRepo,
  remove,
  runChecker,
  scratchDir,
  setOriginMain,
  write,
} from "./lib/scratch-repo.mjs";

after(cleanUpScratchRepos);
const authority = "docs/technical/data-model.md";
function fixture(name) {
  const dir = scratchDir(`vocabulary-${name}`);
  initRepo(dir);
  installCheckers(dir);
  installFromRepo(dir, authority);
  installFromRepo(dir, "scripts/ci/vocabulary-baseline.json");
  write(
    dir,
    "apps/probe/schema.ts",
    'export const item = pgTable("work_item", {});\n',
  );
  setOriginMain(dir, commit(dir, "Vocabulary fixture base"));
  assert.equal(existsSync(path.join(dir, "archive")), false);
  return dir;
}

test("maintained schema vocabulary runs without any archive directory", () => {
  const dir = fixture("no-archive");
  const result = runChecker(dir, "check-vocabulary.mjs");
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /1 table declaration/);
});

test("an undocumented workspace table fails against the maintained authority", () => {
  const dir = fixture("unregistered");
  write(
    dir,
    "apps/probe/schema.ts",
    'export const item = pgTable("unregistered_contract_probe", {});\n',
  );
  const result = runChecker(dir, "check-vocabulary.mjs");
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /unregistered_contract_probe/);
  assert.match(result.output, /docs\/technical\/data-model\.md/);
});

test("missing maintained authority fails closed without falling back to the archive", () => {
  const dir = fixture("missing-authority");
  remove(dir, authority);
  write(
    dir,
    "archive/2026-10-22/docs/01-architecture/data-model.md",
    "`work_item`\n",
  );
  const result = runChecker(dir, "check-vocabulary.mjs");
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /docs\/technical\/data-model\.md/);
});

test("an empty maintained authority fails closed", () => {
  const dir = fixture("empty-authority");
  write(dir, authority, "# Empty schema\n");
  const result = runChecker(dir, "check-vocabulary.mjs");
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /No identifiers parsed/);
});

test("baseline growth remains forbidden even when an unregistered table is added to it", () => {
  const dir = fixture("ratchet");
  const baseline = JSON.parse(
    readFileSync(path.join(dir, "scripts/ci/vocabulary-baseline.json"), "utf8"),
  );
  baseline.unregistered.table.unregistered_contract_probe = [
    "apps/probe/schema.ts",
  ];
  write(dir, "scripts/ci/vocabulary-baseline.json", JSON.stringify(baseline));
  write(
    dir,
    "apps/probe/schema.ts",
    'export const item = pgTable("unregistered_contract_probe", {});\n',
  );
  const result = runChecker(dir, "check-vocabulary.mjs");
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /ADDED to the baseline/);
});

test("the full scheduled-job inventory is registered, including the inherited compatibility name", () => {
  const contract = readFileSync(
    path.join(repoRoot, "docs/technical/background-jobs.md"),
    "utf8",
  );
  const targetJobs = [...contract.matchAll(/^\| `([a-z][a-z-]+)` \|/gm)].map(
    (match) => match[1],
  );
  // The maintained registry includes P4/P5's automation, pending-action,
  // report-export and secrets-rekey jobs as well as the original inventory.
  assert.equal(targetJobs.length, 25);
  assert.ok(targetJobs.includes("customer-invitation-delivery"));
  assert.ok(targetJobs.includes("quiet-hours-release"));
  assert.equal(new Set(targetJobs).size, targetJobs.length);
  assert.ok(!targetJobs.includes("audit-verify"));
  const source = readFileSync(
    path.join(repoRoot, "apps/api/src/scheduler/index.ts"),
    "utf8",
  );
  const registered = [...source.matchAll(/\bname:\s*"([a-z][a-z-]+)"/g)].map(
    (match) => match[1],
  );
  assert.ok(
    registered.length > 0,
    "scheduler registration scan must not be vacuous",
  );
  for (const job of registered)
    assert.ok(
      contract.includes(`\`${job}\``),
      `Unregistered scheduler job: ${job}`,
    );
  assert.match(contract, /audit-verify.*on-demand/);
});
