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
 * SIT_ACCOUNTS_FILE (required): private JSON array of {role, host, email, password}. Optional
 * extra roles enable more journeys: "customer-other" (a customer of another organisation, host
 * portal) and "instance-admin" (the import apply journey). SIT_RELEASE_WORKSPACE and
 * SIT_RELEASE_PROJECT pin the workspace and project by name, slug, key or id; otherwise the
 * journeys discover them through the API. The whole suite is bounded to 60 minutes.
 * SIT_AGENT_ORIGIN / SIT_PORTAL_ORIGIN default to the local SIT hosts. Node trusts the local
 * certificate through NODE_EXTRA_CA_CERTS. Arguments after `--` go to the smoke step.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
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
const hasInstanceAdmin = JSON.parse(readFileSync(accounts, "utf8")).some(
  (row) => row.role === "instance-admin",
);
const notRun = [];
const journeys = readdirSync(journeyDir)
  .filter((name) => /^release-.+\.config\.ts$/.test(name))
  .filter((name) => {
    // Import apply needs instance:admin; without that account it is reported, never passed.
    if (name !== "release-import-apply.config.ts" || hasInstanceAdmin)
      return true;
    notRun.push("journey release-import-apply (no instance-admin account)");
    return false;
  })
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

// Overall bound: a hung journey cannot stall the release. Each step runs in its own process
// group so the timeout kills pnpm, playwright and browsers together, not just the direct child.
const budgetMs = 60 * 60_000;
const deadline = Date.now() + budgetMs;
const runStep = (step, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(step.cmd, step.args, {
      cwd: repo,
      stdio: "inherit",
      detached: true,
    });
    const killGroup = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {}
    };
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), 5_000).unref();
    }, timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      killGroup("SIGKILL"); // leftovers of a step that exited on its own
      resolve(code === 0 && !timedOut);
    });
  });
const summary = [];
for (const step of steps) {
  if (Date.now() >= deadline) {
    console.error(`Overall 60 minute limit reached before "${step.name}".`);
    break;
  }
  console.log(`\n=== ${step.name} ===`);
  const started = Date.now();
  const ok = await runStep(step, deadline - started);
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
for (const name of notRun) console.log(`NOT RUN  ${name}`);
if (skipped > 0)
  console.log(`NOT RUN  ${skipped} step(s) after a failure or the time limit`);
process.exitCode =
  summary.length === steps.length && summary.every((row) => row.ok) ? 0 : 1;
