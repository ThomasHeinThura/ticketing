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
import { mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";
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

/**
 * The bootstrap half of `scenario()`, exposed on its own for probes below that need to add
 * something `scenario()`'s file-content map cannot express — a symlink, or a second
 * tsconfig — between the bootstrap commit and the head commit under probe. Same shape,
 * same reason: a fresh scratch repository with an empty baseline, a real `origin/main`
 * ref so `readBaselineAtMergeBase` has history to compare against instead of raising
 * `BaselineHistoryUnavailableError` (which would fail the probe for the wrong reason).
 */
function baseSetup(prefix) {
  const dir = scratchDir(prefix);
  initRepo(dir);
  installCheckers(dir);
  installFromRepo(dir, TSCONFIG);
  write(dir, AUTH_CLIENT, AUTH_CLIENT_SOURCE);
  write(dir, BASELINE, baselineWith({}));
  const base = commit(dir, "chore: bootstrap");
  setOriginMain(dir, base);
  return dir;
}

/** A symlink at `dir/relativeLinkPath`, pointing at the absolute path `absoluteTarget`
 * (inside or outside `dir` — the caller decides which case it is building). */
function symlink(dir, relativeLinkPath, absoluteTarget) {
  const linkAbsolute = path.join(dir, relativeLinkPath);
  mkdirSync(path.dirname(linkAbsolute), { recursive: true });
  symlinkSync(absoluteTarget, linkAbsolute);
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

  it("H: a dynamic import() of the auth-client module fails closed (F1)", () => {
    const FILE = "apps/web/src/hooks/use-dynamic-activate.ts";
    const source = [
      "export async function activateA(id: string) {",
      '  const { authClient } = await import("@/lib/auth-client");',
      "  await authClient.organization.createRole({ organizationId: id });",
      "}",
      "",
      "export async function activateB(id: string) {",
      '  await (await import("@/lib/auth-client")).authClient.organization.deleteRole({',
      "    organizationId: id,",
      "  });",
      "}",
      "",
    ].join("\n");

    const dir = scenario("org-dynamic-import", {
      baseFiles: {},
      baseBaseline: {},
      headFiles: { [FILE]: source },
      headBaseline: {},
    });

    const run = runChecker(dir, "check-organization-callers.mjs");
    assert.equal(
      run.status,
      1,
      "a dynamic import() of the client must fail closed rather than silently score " +
        `zero. Exited ${run.status}:\n${run.output}`,
    );
    assert.match(run.output, /dynamic `import\(/);
    assert.ok(run.output.includes(FILE), run.output);
  });

  it("I: a symlinked FILE reaching a live caller is not silently skipped (F2)", () => {
    const REAL = "external-code/real-caller.ts";
    const LINK = "apps/web/src/hooks/use-symlinked-file.ts";
    const dir = baseSetup("org-symlink-file");
    write(dir, REAL, setActiveCallFile());
    symlink(dir, LINK, path.join(dir, REAL));
    commit(dir, "feat: reach the client through a symlinked file");

    const run = runChecker(dir, "check-organization-callers.mjs");
    assert.equal(
      run.status,
      1,
      "a live call reached only through a symlinked file must not be silently omitted " +
        "— the blanket `isSymbolicLink() -> skip` bug this closes. Exited " +
        `${run.status}:\n${run.output}`,
    );
    assert.ok(run.output.includes(REAL), run.output);
  });

  it("J: a symlinked DIRECTORY reaching a live caller is not silently skipped (F2)", () => {
    const REAL_DIR = "external-code/roles";
    const REAL_FILE = `${REAL_DIR}/activate.ts`;
    const LINK_DIR = "apps/web/src/hooks/external-roles";
    const dir = baseSetup("org-symlink-dir");
    write(dir, REAL_FILE, setActiveCallFile());
    symlink(dir, LINK_DIR, path.join(dir, REAL_DIR));
    commit(dir, "feat: reach the client through a symlinked directory");

    const run = runChecker(dir, "check-organization-callers.mjs");
    assert.equal(
      run.status,
      1,
      "a live call reached only through a symlinked directory must not be silently " +
        `omitted. Exited ${run.status}:\n${run.output}`,
    );
    assert.ok(run.output.includes(REAL_FILE), run.output);
  });

  it("K: a symlink resolving outside the repository is refused, not silently followed (F2)", () => {
    const outside = scratchDir("org-symlink-outside-target");
    write(outside, "real-caller.ts", setActiveCallFile());

    const LINK = "apps/web/src/hooks/use-outside-symlink.ts";
    const dir = baseSetup("org-symlink-outside");
    symlink(dir, LINK, path.join(outside, "real-caller.ts"));
    commit(
      dir,
      "feat: reach the client through a symlink pointing outside the repository",
    );

    const run = runChecker(dir, "check-organization-callers.mjs");
    assert.equal(
      run.status,
      1,
      "a symlink resolving outside the repository must be refused, not silently " +
        `followed OR silently skipped. Exited ${run.status}:\n${run.output}`,
    );
    assert.match(run.output, /outside the repository/);
    assert.ok(run.output.includes(LINK), run.output);
  });

  it("L: a barrel OUTSIDE the scanned root, re-exporting the client, is not a silent bypass (F3)", () => {
    const BARREL = "external-lib/barrel.ts";
    const CONSUMER = "apps/web/src/hooks/use-external-barrel.ts";
    const dir = baseSetup("org-external-barrel");
    write(
      dir,
      BARREL,
      'export { authClient } from "../apps/web/src/lib/auth-client";\n',
    );
    write(
      dir,
      CONSUMER,
      [
        'import { authClient } from "../../../../external-lib/barrel";',
        "",
        "export async function activate(id: string) {",
        "  await authClient.organization.createRole({ organizationId: id });",
        "}",
        "",
      ].join("\n"),
    );
    commit(dir, "feat: reach the client through a barrel outside apps/web/src");

    const run = runChecker(dir, "check-organization-callers.mjs");
    assert.equal(
      run.status,
      1,
      "a barrel living outside apps/web/src, re-exporting the client, must not be a " +
        `complete silent bypass. Exited ${run.status}:\n${run.output}`,
    );
    assert.match(run.output, /does not resolve directly to the auth-client/);
    assert.ok(run.output.includes(CONSUMER), run.output);
  });

  it("M: a CommonJS require() of the auth-client module fails closed (F4)", () => {
    const FILE = "apps/web/src/scripts/legacy-activate.cjs";
    const source = [
      'const { authClient } = require("../lib/auth-client");',
      "",
      "async function activate(id) {",
      "  await authClient.organization.createRole({ organizationId: id });",
      "}",
      "",
      "module.exports = { activate };",
      "",
    ].join("\n");

    const dir = scenario("org-cjs-require", {
      baseFiles: {},
      baseBaseline: {},
      headFiles: { [FILE]: source },
      headBaseline: {},
    });

    const run = runChecker(dir, "check-organization-callers.mjs");
    assert.equal(
      run.status,
      1,
      "a CommonJS require() of the client must fail closed rather than silently score " +
        `zero — the ESM-only import grammar never matches it. Exited ${run.status}:\n` +
        run.output,
    );
    assert.match(run.output, /CommonJS `require\(/);
    assert.ok(run.output.includes(FILE), run.output);
  });

  it("N: tsconfig `paths` moved behind `references` does not collapse the alias map (F6)", () => {
    const FILE = "apps/web/src/hooks/use-activate.ts";
    const dir = baseSetup("org-tsconfig-references");
    // The ordinary refactor this pins: `paths` moves OUT of the root tsconfig.json and
    // into the project it already `references`, exactly like `tsconfig.app.json` holds it
    // for real in this repository today, duplicated in the root file only by accident.
    write(
      dir,
      TSCONFIG,
      JSON.stringify({
        files: [],
        references: [{ path: "./tsconfig.app.json" }],
        compilerOptions: {},
      }),
    );
    write(
      dir,
      "apps/web/tsconfig.app.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    );
    write(dir, FILE, setActiveCallFile());
    commit(dir, "feat: dedupe tsconfig paths behind references");

    const run = runChecker(dir, "check-organization-callers.mjs");
    assert.equal(
      run.status,
      1,
      "a live call reached through an `@/`-aliased import must still be detected once " +
        "`paths` lives only behind a tsconfig `references` entry — the alias map must " +
        `not silently collapse to empty. Exited ${run.status}:\n${run.output}`,
    );
    assert.match(
      run.output,
      /not in scripts\/ci\/organization-callers-baseline\.json/,
      "this must fail as an ORDINARY newly-observed caller (the alias resolved and the " +
        "call was found), not merely fail for some other reason — output:\n" +
        run.output,
    );
    assert.ok(run.output.includes(FILE), run.output);
  });

  it("O: an IN-ROOT barrel re-exporting the client is refused end-to-end (F5)", () => {
    const BARREL = "apps/web/src/lib/barrel.ts";
    const CONSUMER = "apps/web/src/hooks/use-barrel-consumer.ts";
    const dir = scenario("org-inroot-barrel-e2e", {
      baseFiles: {},
      baseBaseline: {},
      headFiles: {
        [BARREL]: 'export { authClient } from "@/lib/auth-client";\n',
        [CONSUMER]: [
          'import { authClient } from "@/lib/barrel";',
          "",
          "export async function activate(id: string) {",
          "  await authClient.organization.setActive({ organizationId: id });",
          "}",
          "",
        ].join("\n"),
      },
      headBaseline: {},
    });

    const run = runChecker(dir, "check-organization-callers.mjs");
    assert.equal(
      run.status,
      1,
      "an in-root barrel re-exporting the client must be refused end-to-end, through the " +
        `real checker binary — not only in the lib-level unit test. Exited ${run.status}` +
        `:\n${run.output}`,
    );
    assert.match(run.output, /re-export of the auth-client module/);
    assert.ok(run.output.includes(BARREL), run.output);
  });
});
