/**
 * S10 red probes — the `authClient.organization.*` caller count is a shrink-only ratchet
 * (scripts/ci/check-organization-callers.mjs), and it must fail closed on a shape it
 * cannot classify rather than ever report a caller count of zero it cannot back up.
 *
 * Every scenario runs the REAL checker binary against a synthetic two-commit repository —
 * never a unit test of the baseline document — for the same reason
 * `probes/env-baseline-growth.test.mjs` gives: a same-diff bypass edits the document
 * alongside the code it excuses, so a check that only reads the document at HEAD cannot
 * see it.
 *
 * The non-vacuity anchor throughout is a **naive substring grep** — literally
 * `grep -c "authClient.organization."` — because that is the exact tool this project has
 * already reached for five times and gotten wrong: it counts prose that NAMES a replaced
 * method in a comment (over-count), and it MISSES a computed access or an uncalled method
 * reference (under-count), because neither contains the literal substring a grep would
 * need. Every RED scenario below states what that grep would have reported, and it is
 * either silently wrong or simply absent — which is the whole reason this gate exists
 * rather than a one-line `test:ci-scripts` regex assertion.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  cleanUpScratchRepos,
  commit,
  initRepo,
  installCheckers,
  installFromRepo,
  runChecker,
  scratchDir,
  setOriginMain,
  write,
} from "../lib/scratch-repo.mjs";

after(cleanUpScratchRepos);

const AUTH_CLIENT = "apps/web/src/lib/auth-client.ts";
const TSCONFIG = "apps/web/tsconfig.json";
const BASELINE = "scripts/ci/organization-callers-baseline.json";

const AUTH_CLIENT_SOURCE = [
  'import { organizationClient } from "better-auth/client/plugins";',
  'import { createAuthClient } from "better-auth/react";',
  "",
  "export const authClient = createAuthClient({",
  "  plugins: [organizationClient()],",
  "});",
  "",
].join("\n");

function baselineWith(callers) {
  return `${JSON.stringify({ note: "probe baseline", callers }, null, "\t")}\n`;
}

function setActiveCallFile() {
  return [
    'import { authClient } from "@/lib/auth-client";',
    "",
    "export async function activate(id: string) {",
    "  await authClient.organization.setActive({ organizationId: id });",
    "}",
    "",
  ].join("\n");
}

/** A repository whose merge base and head each carry one commit — same shape as the
 * env-baseline-growth probes, so growth is unambiguously same-diff. */
function scenario(
  prefix,
  { baseFiles, baseBaseline, headFiles, headBaseline },
) {
  const dir = scratchDir(prefix);
  initRepo(dir);
  installCheckers(dir);
  installFromRepo(dir, TSCONFIG);
  write(dir, AUTH_CLIENT, AUTH_CLIENT_SOURCE);
  for (const [relPath, contents] of Object.entries(baseFiles))
    write(dir, relPath, contents);
  write(dir, BASELINE, baselineWith(baseBaseline));
  const base = commit(dir, "chore: bootstrap");
  setOriginMain(dir, base);

  for (const [relPath, contents] of Object.entries(headFiles))
    write(dir, relPath, contents);
  write(dir, BASELINE, baselineWith(headBaseline));
  commit(dir, "feat: the scenario under probe");
  return dir;
}

/** What a naive `grep -c "authClient.organization.<method>("`-style substring count would
 * see — the tool this project has already reached for five times, wrongly. Requiring the
 * trailing `(` is the most charitable naive grep imaginable (a bare `authClient.organization.`
 * substring count is even worse: it also fires on prose that merely NAMES the plugin), and
 * even that charitable version still gets fooled both ways below. */
function naiveGrepCount(source) {
  return (
    source.match(/authClient\.organization\.[A-Za-z_$][\w$]*\s*\(/g) ?? []
  ).length;
}

describe("S10 — authClient.organization.* callers cannot grow unnoticed", () => {
  it("A: a new caller plus a matching baseline entry, one diff — RED (same-diff bypass)", () => {
    const NEW_FILE = "apps/web/src/hooks/use-activate.ts";
    const dir = scenario("org-growth-a", {
      baseFiles: {},
      baseBaseline: {},
      headFiles: { [NEW_FILE]: setActiveCallFile() },
      headBaseline: {
        [NEW_FILE]: {
          reason: "smuggled in alongside the call it excuses",
          occurrences: [
            "setActive #1: await authClient.organization.setActive({ organizationId: id });",
          ],
        },
      },
    });

    assert.equal(
      naiveGrepCount(setActiveCallFile()) > 0,
      true,
      "sanity: a naive grep DOES see this call as text — the point of this probe is that " +
        "the ratchet must still refuse it even though the current-baseline comparison " +
        "alone would call it accounted for.",
    );

    const run = runChecker(dir, "check-organization-callers.mjs");
    assert.equal(
      run.status,
      1,
      "check:organization-callers must reject a call added alongside its own baseline " +
        `entry. Exited ${run.status}:\n${run.output}`,
    );
    assert.match(
      run.output,
      /ADDED to the baseline relative to the merge base/,
    );
    assert.ok(run.output.includes(NEW_FILE), run.output);
  });

  it("B: a new caller, baseline left untouched — RED", () => {
    const NEW_FILE = "apps/web/src/hooks/use-activate.ts";
    const dir = scenario("org-growth-b", {
      baseFiles: {},
      baseBaseline: {},
      headFiles: { [NEW_FILE]: setActiveCallFile() },
      headBaseline: {},
    });

    const run = runChecker(dir, "check-organization-callers.mjs");
    assert.equal(run.status, 1, `exited ${run.status}:\n${run.output}`);
    assert.match(
      run.output,
      /not in scripts\/ci\/organization-callers-baseline\.json/,
    );
    assert.ok(run.output.includes(NEW_FILE), run.output);
  });

  it("C: removing a caller and shrinking the baseline — GREEN", () => {
    const FILE = "apps/web/src/hooks/use-activate.ts";
    const dir = scenario("org-shrink-c", {
      baseFiles: { [FILE]: setActiveCallFile() },
      baseBaseline: {
        [FILE]: {
          reason: "inherited",
          occurrences: [
            "setActive #1: await authClient.organization.setActive({ organizationId: id });",
          ],
        },
      },
      headFiles: {
        [FILE]: [
          'import { authClient } from "@/lib/auth-client";',
          "",
          "export async function activate(_id: string) {",
          "  // S10: native replacement — no more authClient.organization.setActive() here.",
          "}",
          "",
        ].join("\n"),
      },
      headBaseline: {},
    });

    const run = runChecker(dir, "check-organization-callers.mjs");
    assert.equal(
      run.status,
      0,
      "a genuine shrink must PASS — a ratchet that refuses every change to itself can " +
        `never be paid down. Exited ${run.status}:\n${run.output}`,
    );
  });

  it("D: computed member access defeats a naive grep and must fail closed — RED", () => {
    const FILE = "apps/web/src/hooks/use-activate.ts";
    const source = [
      'import { authClient } from "@/lib/auth-client";',
      "",
      "export async function activate(id: string) {",
      '  await authClient["organization"].setActive({ organizationId: id });',
      "}",
      "",
    ].join("\n");

    assert.equal(
      naiveGrepCount(source),
      0,
      "non-vacuity: a naive grep for the literal substring `authClient.organization.` " +
        "sees NOTHING here and would silently report zero callers. The refusal below is " +
        "the only thing standing between this file and a false all-clear.",
    );

    const dir = scenario("org-computed-access", {
      baseFiles: {},
      baseBaseline: {},
      headFiles: { [FILE]: source },
      headBaseline: {},
    });

    const run = runChecker(dir, "check-organization-callers.mjs");
    assert.equal(
      run.status,
      1,
      "a computed member access must fail closed rather than silently score zero. " +
        `Exited ${run.status}:\n${run.output}`,
    );
    assert.match(run.output, /computed member access/);
    assert.ok(run.output.includes(FILE), run.output);
  });

  it("E: a method referenced without being called defeats a naive grep and must fail closed — RED", () => {
    const FILE = "apps/web/src/hooks/use-activate.ts";
    const source = [
      'import { authClient } from "@/lib/auth-client";',
      "",
      "export function activateHandler() {",
      "  const fn = authClient.organization.setActive;",
      "  return fn;",
      "}",
      "",
    ].join("\n");

    assert.equal(
      naiveGrepCount(source),
      0,
      "non-vacuity: a naive grep for the literal substring `authClient.organization.` " +
        "(without a trailing open-paren, which this shape never provides) sees nothing.",
    );

    const dir = scenario("org-method-no-call", {
      baseFiles: {},
      baseBaseline: {},
      headFiles: { [FILE]: source },
      headBaseline: {},
    });

    const run = runChecker(dir, "check-organization-callers.mjs");
    assert.equal(run.status, 1, `exited ${run.status}:\n${run.output}`);
    assert.match(run.output, /referenced without being called/);
  });

  it("F: a comment naming a replaced call must NOT be counted — GREEN (the five-miscount bug)", () => {
    const FILE = "apps/web/src/hooks/use-activate.ts";
    const source = [
      'import { authClient } from "@/lib/auth-client";',
      "",
      "// S10: native replacement for authClient.organization.setActive().",
      "export function activate() {",
      "  return null;",
      "}",
      "",
    ].join("\n");

    assert.equal(
      naiveGrepCount(source) > 0,
      true,
      "sanity: this is exactly the shape that has miscounted this surface five times on " +
        "this project — `grep -c` sees the commented-out method name as a live caller.",
    );

    const dir = scenario("org-comment-only", {
      baseFiles: {},
      baseBaseline: {},
      headFiles: { [FILE]: source },
      headBaseline: {},
    });

    const run = runChecker(dir, "check-organization-callers.mjs");
    assert.equal(
      run.status,
      0,
      "a comment naming a replaced call must not be reported as a caller. Exited " +
        `${run.status}:\n${run.output}`,
    );
    assert.match(run.output, /0 live authClient\.organization\.\* call sites/);
  });

  it("G: a namespace import of the auth-client module fails closed", () => {
    const FILE = "apps/web/src/hooks/use-activate.ts";
    const source = [
      'import * as AuthClientModule from "@/lib/auth-client";',
      "",
      "export async function activate(id: string) {",
      "  await AuthClientModule.authClient.organization.setActive({ organizationId: id });",
      "}",
      "",
    ].join("\n");

    const dir = scenario("org-namespace-import", {
      baseFiles: {},
      baseBaseline: {},
      headFiles: { [FILE]: source },
      headBaseline: {},
    });

    const run = runChecker(dir, "check-organization-callers.mjs");
    assert.equal(run.status, 1, `exited ${run.status}:\n${run.output}`);
    assert.match(run.output, /namespace import/);
  });
});
