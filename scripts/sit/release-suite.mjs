#!/usr/bin/env node
/**
 * Release regression suite on local SIT (docs/testing.md, Level 2): `pnpm test:release`.
 *
 * Runs in order and stops at the first failure:
 *   1. release smoke (read-only, waits up to 120 s for both hosts to be ready)
 *   2. the persisted journeys apps/web/e2e-sit/release-*.config.ts
 *   3. pnpm test:permissions
 *   4. screen sweep, only with RELEASE_SWEEP=1 (long; writes to SIT)
 *
 * SIT_ACCOUNTS_FILE (required): private JSON array of {role, host, email, password}.
 * SIT_AGENT_ORIGIN / SIT_PORTAL_ORIGIN default to the local SIT hosts. Node trusts the local
 * certificate through NODE_EXTRA_CA_CERTS. Arguments after `--` go to the smoke step.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const accounts = process.env.SIT_ACCOUNTS_FILE;
if (!accounts) {
  console.error(
    "SIT_ACCOUNTS_FILE is required: a private JSON array of {role, host, email, password}.",
  );
  process.exit(2);
}
const agent = process.env.SIT_AGENT_ORIGIN ?? "https://ticketing.localhost";
const portal = process.env.SIT_PORTAL_ORIGIN ?? "https://portal.localhost";
const smokeArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const journeyDir = path.join(repo, "apps/web/e2e-sit");
const journeys = readdirSync(journeyDir)
  .filter((name) => /^release-.+\.config\.ts$/.test(name))
  .sort();
if (journeys.length === 0) {
  console.error("No apps/web/e2e-sit/release-*.config.ts journeys found.");
  process.exit(2);
}

const steps = [
  {
    name: "release smoke",
    cmd: process.execPath,
    args: [
      "scripts/sit/release-smoke.mjs",
      "--credentials",
      accounts,
      "--agent",
      agent,
      "--portal",
      portal,
      "--wait-ready",
      "120",
      ...smokeArgs,
    ],
  },
  ...journeys.map((config) => ({
    name: `journey ${config.replace(/\.config\.ts$/, "")}`,
    cmd: "pnpm",
    args: [
      "--filter",
      "@taskdesk/web",
      "exec",
      "playwright",
      "test",
      "--config",
      `e2e-sit/${config}`,
    ],
  })),
  { name: "permissions matrix", cmd: "pnpm", args: ["test:permissions"] },
];
if (process.env.RELEASE_SWEEP === "1") {
  steps.push({
    name: "screen sweep",
    cmd: process.execPath,
    args: [
      "scripts/sit/screen-sweep.mjs",
      "--agent-origin",
      agent,
      "--portal-origin",
      portal,
      "--accounts",
      accounts,
      // Must not exist yet; the sweep creates it 0700.
      "--out",
      path.join(mkdtempSync(path.join(os.tmpdir(), "release-sweep-")), "out"),
    ],
  });
}

const summary = [];
for (const step of steps) {
  console.log(`\n=== ${step.name} ===`);
  const started = Date.now();
  const result = spawnSync(step.cmd, step.args, {
    cwd: repo,
    stdio: "inherit",
  });
  const ok = result.status === 0;
  summary.push({
    name: step.name,
    ok,
    seconds: Math.round((Date.now() - started) / 1000),
  });
  if (!ok) break;
}
console.log("\n=== release suite summary ===");
for (const row of summary)
  console.log(`${row.ok ? "PASS" : "FAIL"}  ${row.name}  ${row.seconds}s`);
const skipped = steps.length - summary.length;
if (skipped > 0)
  console.log(`NOT RUN  ${skipped} step(s) after the first failure`);
process.exitCode = summary.every((row) => row.ok) ? 0 : 1;
