#!/usr/bin/env node
/**
 * `pnpm test:permissions` — route coverage and the permission matrix.
 *
 * This is the Throttle 1 safety boundary. docs/07-planning/status.md § Throttle 1 lists
 * five conditions; the last two are this file's job:
 *
 *   4. route coverage actually runs in CI
 *   5. adding a route without a policy **fails the build**
 *
 * and the same document says why the wrapper exists: "it is **not enough** that #7 has a
 * passing test locally. The check must execute in CI."
 *
 * The suite itself belongs to the policy registry (#7) and lives in `tests/permissions/`
 * (docs/04-engineering/testing-strategy.md § Permission tests). This file does not
 * re-implement it. A second route scanner would become a competing source of truth, which
 * is precisely the failure the policy registry exists to prevent — so this only locates the
 * suite, refuses to pass without it, and runs it.
 *
 * **Fail-closed by design.** Until the suite exists, this exits non-zero. A gate that
 * passes because it found nothing to check is worse than no gate: v1 shipped eleven
 * authorization holes past a green test suite.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { exists, repoRoot } from "./lib/repo.mjs";

const NAME = "test:permissions";

/**
 * Where the suite may live, in the order the documents name it. Extend this list — do not
 * write a second scanner — if #7 publishes a different entry point.
 */
const candidates = [
  {
    config: "tests/permissions/vitest.config.ts",
    command: [
      "exec",
      "vitest",
      "run",
      "--config",
      "tests/permissions/vitest.config.ts",
    ],
  },
  {
    config: "tests/permissions/vitest.config.mts",
    command: [
      "exec",
      "vitest",
      "run",
      "--config",
      "tests/permissions/vitest.config.mts",
    ],
  },
];

/**
 * Files docs/04-engineering/testing-strategy.md § Permission tests names by hand. Their
 * absence means the suite is incomplete, not that this gate should relax.
 */
const requiredCases = ["route-coverage.test.ts", "matrix.test.ts"];

function blocked(lines) {
  process.stderr.write(
    `\n${NAME}: BLOCKED — the route-policy gate cannot run.\n\n`,
  );
  for (const line of lines) {
    process.stderr.write(`  ${line}\n`);
  }
  process.stderr.write(
    "\n  This gate fails closed on purpose. Throttle 1 does not open until route coverage\n" +
      "  runs here and a route without a policy fails the build (docs/07-planning/status.md).\n\n",
  );
  process.exit(1);
}

async function main() {
  const found = [];
  for (const candidate of candidates) {
    if (await exists(path.join(repoRoot, candidate.config))) {
      found.push(candidate);
    }
  }

  if (found.length === 0) {
    blocked([
      "No permission test suite found.",
      `Looked for: ${candidates.map((candidate) => candidate.config).join(", ")}`,
      "",
      "The suite is issue #7's — the policy registry, route coverage and the role x route",
      "matrix (docs/04-engineering/testing-strategy.md § Permission tests). Once it lands,",
      "this wrapper runs it and nothing else changes.",
    ]);
  }

  const missing = [];
  for (const testCase of requiredCases) {
    if (!(await exists(path.join(repoRoot, "tests/permissions", testCase)))) {
      missing.push(testCase);
    }
  }
  if (missing.length > 0) {
    blocked([
      `tests/permissions/ exists but is missing: ${missing.join(", ")}`,
      "",
      "docs/04-engineering/testing-strategy.md names route-coverage.test.ts (every route in",
      "Hono's router carries a policy of one of the five kinds in rbac.md) and matrix.test.ts",
      "(every built-in role against every route, capability and reach). A partial suite is",
      "not coverage.",
    ]);
  }

  const result = spawnSync("pnpm", found[0].command, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

await main();
