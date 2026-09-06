#!/usr/bin/env node
/**
 * `pnpm test:all` — the local alias for every CI check.
 *
 * AGENTS.md and docs/04-engineering/testing-strategy.md both promise this command; kaneo
 * had no equivalent. docs/04-engineering/ci-cd.md is "the single list of CI checks", so
 * the list below is reconciled against that document on every run: a gate declared there
 * with no entry here is reported as missing, and an entry here that the document does not
 * declare is reported as invented. Neither can drift quietly.
 *
 * Gates that cannot exist yet are listed with the reason and the issue that unblocks them.
 * They are never reported as passing — "not enabled" is printed, and `--strict` turns the
 * whole run red so the honest state is visible on demand.
 *
 * Usage:
 *   pnpm test:all              run every enabled gate
 *   pnpm test:all --stage fast run only the fast stage
 *   pnpm test:all --list       print the manifest and exit
 *   pnpm test:all --strict     also fail while any gate is not yet enabled
 */

import { spawnSync } from "node:child_process";
import { readDeclaredGates } from "./lib/ci-cd-gates.mjs";
import { repoRoot } from "./lib/repo.mjs";

const NAME = "test:all";

/**
 * One entry per gate named in ci-cd.md, in that document's order.
 *
 * `run`    — argv to execute, or null when the gate cannot exist yet
 * `why`    — required when `run` is null: what is missing, and what unblocks it
 * `ciOnly` — needs pull-request context or a tool that is not part of `pnpm install`
 */
const manifest = [
  {
    gate: "pnpm install --frozen-lockfile",
    stage: "fast",
    run: null,
    setup: true,
    why: "setup, not a gate — CI runs it before everything else.",
  },
  {
    gate: "pnpm lint",
    stage: "fast",
    run: ["pnpm", "exec", "biome", "ci", "."],
    note: "`pnpm lint` is `turbo lint`, and every package's lint script is `biome check --write .`, which rewrites files. CI runs `biome ci .` instead so a lint failure is reported rather than silently fixed.",
  },
  { gate: "pnpm typecheck", stage: "fast", run: ["pnpm", "typecheck"] },
  {
    gate: "pnpm check:tokens",
    stage: "fast",
    run: null,
    why: "packages/ui does not exist yet (#9). There is no token source to check literal colours and contrast against.",
  },
  {
    gate: "pnpm check:ui",
    stage: "fast",
    run: null,
    why: "packages/ui does not exist yet (#9), so 'no bespoke primitives' and 'no Radix/Base UI import outside packages/ui' have nothing to be true of. KNOWN-RADIX.md does not exist either.",
  },
  {
    gate: "pnpm check:deps",
    stage: "fast",
    run: null,
    why: "the boundary matrix in docs/01-architecture/monorepo-layout.md is stated over packages/domain, packages/ui and packages/plugins-contracts, none of which exists yet. A cycle check today would assert almost nothing.",
  },
  { gate: "pnpm check:i18n", stage: "fast", run: ["pnpm", "check:i18n"] },
  {
    gate: "pnpm audit",
    stage: "fast",
    run: ["pnpm", "audit", "--audit-level=high"],
    note: "red today: the inherited dependency graph carries 8 high advisories, every one in devDependencies or build tooling. Fixing them is a lockfile change.",
  },
  {
    gate: "gitleaks",
    stage: "fast",
    run: ["gitleaks", "detect", "--no-banner", "--redact"],
    ciOnly: true,
    note: "runs in CI from a pinned action; locally it runs only if gitleaks is on PATH.",
  },
  {
    gate: "pnpm check:queries",
    stage: "fast",
    run: null,
    why: "the repository.ts convention in docs/04-engineering/coding-standards.md has not been applied to the inherited tree yet, so 'no db.select() outside repository.ts' has no repository layer to be outside of.",
  },
  {
    gate: "pnpm check:inventory",
    stage: "fast",
    run: null,
    why: "needs generated routes to compare the screen inventory against; apps/web has no lib/routes.ts registry yet (AGENTS.md rule 4, #9 and P1).",
  },
  { gate: "pnpm check:reviews", stage: "fast", run: ["pnpm", "check:reviews"] },
  { gate: "pnpm check:env", stage: "fast", run: ["pnpm", "check:env"] },
  {
    gate: "pnpm check:vocabulary",
    stage: "fast",
    run: ["pnpm", "check:vocabulary"],
    note: "tables only for now — capabilities, event keys and background jobs are checked as soon as the files that declare them exist (#7 and P1).",
  },
  { gate: "pnpm check:skips", stage: "fast", run: ["pnpm", "check:skips"] },
  {
    gate: "pr-template check",
    stage: "fast",
    run: ["pnpm", "check:pr-template"],
    ciOnly: true,
    note: "needs a pull-request body; locally it does nothing useful.",
  },
  {
    gate: "no-inherited-routes",
    stage: "fast",
    run: null,
    why: "tests/permissions/no-inherited-integration-routes.test.ts is #6's and #7's to write (docs/04-engineering/testing-strategy.md § Permission tests). It runs under `pnpm test:permissions` once it exists.",
  },
  { gate: "pnpm test", stage: "fast", run: ["pnpm", "test"] },
  {
    gate: "pnpm test:coverage",
    stage: "fast",
    run: null,
    why: "the threshold ci-cd.md states is '90 % on packages/domain', and packages/domain does not exist yet (P2).",
  },
  {
    gate: "pnpm test:permissions",
    stage: "fast",
    run: ["pnpm", "test:permissions"],
  },
  {
    gate: "pnpm test:contract",
    stage: "fast",
    run: ["pnpm", "check:openapi"],
    note: "partial. The drift half is restored (check:openapi regenerates the document and fails on an uncommitted change). Redocly lint and `oasdiff breaking` need two dev dependencies that are not installed, and adding them is a lockfile change.",
  },
  {
    gate: "pnpm test:mcp",
    stage: "fast",
    run: null,
    why: "tests/mcp/ does not exist yet (docs/04-engineering/testing-strategy.md § MCP server tests).",
  },
  { gate: "pnpm build", stage: "fast", run: ["pnpm", "build"] },
  {
    gate: "check:bundle-purity",
    stage: "fast",
    run: null,
    why: "apps/web builds one bundle. G12 is 'no agent module in the portal bundle', and the agent/portal split is #9.",
  },
  {
    gate: "check:bundle-size",
    stage: "fast",
    run: null,
    why: "G11's budgets are not written down anywhere yet, and there is no portal bundle to measure.",
  },
  {
    gate: "helm lint + helm template",
    stage: "fast",
    run: ["helm", "lint", "charts/taskdesk"],
    ciOnly: true,
    note: "charts/taskdesk is inherited from kaneo and is #11's to reconcile with docs/05-operations/kubernetes.md.",
  },
  {
    gate: "pnpm test:integration",
    stage: "full",
    run: ["pnpm", "test:integration"],
  },
  {
    gate: "pnpm test:e2e",
    stage: "full",
    run: null,
    why: "there is no Playwright suite and no deployable application to point one at (#11).",
  },
  {
    gate: "pnpm test:e2e --project=security",
    stage: "full",
    run: null,
    why: "no Playwright suite yet.",
  },
  {
    gate: "pnpm test:e2e --project=reduced-motion",
    stage: "full",
    run: null,
    why: "no Playwright suite yet (G9).",
  },
  {
    gate: "pnpm test:e2e --project=mobile-320",
    stage: "full",
    run: null,
    why: "no Playwright suite yet (H6).",
  },
  {
    gate: "pnpm test:a11y",
    stage: "full",
    run: null,
    why: "no Playwright suite and no screens to run axe against (G4).",
  },
  {
    gate: "pnpm test:visual",
    stage: "full",
    run: null,
    why: "no Playwright suite, and the visual-regression tool for G8 is still an open decision in docs/07-planning/status.md.",
  },
  {
    gate: "pnpm test:perf",
    stage: "full",
    run: null,
    why: "no Playwright suite and no performance budgets (G11).",
  },
];

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function available(command) {
  return (
    spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" })
      .status === 0
  );
}

async function reconcile() {
  const declared = await readDeclaredGates();
  const problems = [];
  const declaredGates = new Set([...declared.fast, ...declared.full]);
  const manifestGates = new Set(manifest.map((entry) => entry.gate));

  for (const gate of declaredGates) {
    if (!manifestGates.has(gate)) {
      problems.push(
        `ci-cd.md declares "${gate}" and scripts/ci/test-all.mjs has no entry for it.`,
      );
    }
  }
  for (const gate of manifestGates) {
    if (!declaredGates.has(gate)) {
      problems.push(
        `scripts/ci/test-all.mjs runs "${gate}" and ci-cd.md does not declare it.`,
      );
    }
  }

  return problems;
}

async function main() {
  const stage = argValue("--stage");
  const strict = process.argv.includes("--strict");
  const list = process.argv.includes("--list");

  const drift = await reconcile();
  if (drift.length > 0) {
    process.stderr.write(`\n${NAME}: CI and ci-cd.md disagree.\n\n`);
    for (const problem of drift) {
      process.stderr.write(`  ${problem}\n`);
    }
    process.stderr.write(
      "\n  ci-cd.md is the single list of CI checks. Change it first, in the same change.\n\n",
    );
    process.exit(1);
  }

  const selected = manifest.filter((entry) => !stage || entry.stage === stage);
  const results = [];

  for (const entry of selected) {
    if (entry.setup) {
      results.push({ ...entry, outcome: "setup" });
      continue;
    }
    if (!entry.run) {
      results.push({ ...entry, outcome: "not enabled" });
      continue;
    }
    if (list) {
      results.push({ ...entry, outcome: "enabled" });
      continue;
    }
    if (entry.ciOnly && !process.env.CI && !available(entry.run[0])) {
      results.push({ ...entry, outcome: "skipped locally" });
      continue;
    }

    process.stdout.write(`\n${NAME}: ─── ${entry.gate} ───\n`);
    const result = spawnSync(entry.run[0], entry.run.slice(1), {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env,
    });
    results.push({ ...entry, outcome: result.status === 0 ? "pass" : "FAIL" });
  }

  process.stdout.write(
    `\n${NAME}: ${selected.length} gate(s) from docs/04-engineering/ci-cd.md\n\n`,
  );
  const width = Math.max(...selected.map((entry) => entry.gate.length));
  for (const result of results) {
    process.stdout.write(`  ${result.gate.padEnd(width)}  ${result.outcome}\n`);
    if (result.why) {
      process.stdout.write(`  ${" ".repeat(width)}    ${result.why}\n`);
    }
    if (result.note) {
      process.stdout.write(`  ${" ".repeat(width)}    note: ${result.note}\n`);
    }
  }

  const failed = results.filter((result) => result.outcome === "FAIL");
  const pending = results.filter((result) => result.outcome === "not enabled");
  process.stdout.write(
    `\n  ${results.filter((r) => r.outcome === "pass").length} passed · ` +
      `${failed.length} failed · ${pending.length} not enabled yet\n\n`,
  );

  if (failed.length > 0 || (strict && pending.length > 0)) {
    process.exit(1);
  }
}

await main();
