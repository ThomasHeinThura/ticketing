/**
 * Scratch repositories for the red probes.
 *
 * A gate that only asserts "the list in the current tree contains the right globs" is a
 * unit test of a document, and a unit test of a document is exactly what a same-diff
 * bypass walks past — the diff edits the document. So the probes in `scripts/ci/probes/`
 * run the **real checker binaries** against synthetic two-commit repositories where the
 * bypass is constructed on purpose, and assert the process exits non-zero.
 *
 * Why a synthetic repository and not this one: every register these checks compare
 * against history is introduced BY this branch, so at the real merge base there is
 * nothing to have grown from. A probe against this repository would assert the bootstrap
 * path and prove nothing. `tests/permissions/git-baseline.test.ts` reached the same
 * conclusion for the same reason and says so at the top.
 *
 * The checker scripts derive `repoRoot` from `import.meta.url` — `scripts/ci/lib/../../..`
 * — so copying `scripts/ci/` into a temporary directory makes that directory the
 * repository root as far as they are concerned. Nothing here touches the real repository:
 * no checkout, no stash, no rebase, and the remote-tracking ref is faked with
 * `git update-ref`, the same plumbing a real `git fetch` leaves behind.
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { repoRoot } from "./repo.mjs";

/** Node binary running this process, so the probes do not depend on `node` being on PATH. */
const NODE = process.execPath;

const created = [];

/** A fresh temporary directory, removed by `cleanUpScratchRepos()`. */
export function scratchDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), `taskdesk-${prefix}-`));
  created.push(dir);
  return dir;
}

export function cleanUpScratchRepos() {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

export function git(dir, args) {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${dir} (status ${result.status}): ${result.stderr}`,
    );
  }
  return result.stdout;
}

/**
 * A repository with `main` as its initial branch and an identity of its own, so the
 * probes never depend on the ambient git configuration.
 */
export function initRepo(dir, branch = "main") {
  git(dir, ["init", "-q", "-b", branch]);
  git(dir, ["config", "user.email", "ci-probes@example.invalid"]);
  git(dir, ["config", "user.name", "ci probes"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
}

export function write(dir, relative, contents) {
  const absolute = path.join(dir, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

export function remove(dir, relative) {
  rmSync(path.join(dir, relative), { force: true, recursive: true });
}

/** Stage everything and commit. Returns the new commit's full SHA. */
export function commit(dir, message) {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]).trim();
}

/**
 * Point `refs/remotes/origin/main` at a commit without a real remote — what the checkers
 * resolve as the base ref in CI.
 */
export function setOriginMain(dir, sha) {
  git(dir, ["update-ref", "refs/remotes/origin/main", sha]);
}

/**
 * Copy `scripts/ci/` (minus the tests and the probes themselves) into the scratch repo,
 * so the checker that runs there is byte-for-byte the one this branch ships.
 */
export function installCheckers(dir) {
  cpSync(path.join(repoRoot, "scripts/ci"), path.join(dir, "scripts/ci"), {
    recursive: true,
    filter: (source) =>
      !source.endsWith(".test.mjs") && !source.includes(`${path.sep}probes`),
  });

  // A5: `check-skips`, `check-env`, `check-vocabulary` and `check-overrides` derive the
  // directories they scan from pnpm-workspace.yaml, and they FAIL CLOSED when it cannot
  // be read. That is the behaviour those gates want in CI and it is the behaviour a
  // scratch repository must reproduce, so the workspace definition travels with the
  // checkers rather than being remembered by each harness. Installed here, once, because
  // the alternative — every probe author remembering — is how the previous hardcoded
  // lists survived four rewrites.
  //
  // A probe that wants a DIFFERENT workspace definition simply writes one afterwards;
  // probes/workspace-membership.test.mjs does exactly that, including the unreadable case.
  cpSync(
    path.join(repoRoot, "pnpm-workspace.yaml"),
    path.join(dir, "pnpm-workspace.yaml"),
  );

  // `check-overrides` also reads pnpm-lock.yaml (the removal-invariant check: does a
  // resolved `next@`/`sharp@` entry exist while the override is still declared) and FAILS
  // CLOSED when it cannot be read. Same reasoning as the workspace file above: install it
  // once here so every scratch repo can run check-overrides without crashing on a file
  // this fix made it depend on. A probe that wants a DIFFERENT lockfile — to construct the
  // removal invariant itself — simply writes one afterwards;
  // probes/override-removal-effect.test.mjs does exactly that.
  cpSync(
    path.join(repoRoot, "pnpm-lock.yaml"),
    path.join(dir, "pnpm-lock.yaml"),
  );
}

/** Copy one file out of the real repository, at its real path. */
export function installFromRepo(dir, relative) {
  const absolute = path.join(dir, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  cpSync(path.join(repoRoot, relative), absolute);
}

/**
 * Run a checker script inside the scratch repo.
 *
 * @returns {{status: number, stdout: string, stderr: string, output: string}}
 */
export function runChecker(dir, script, args = [], env = {}) {
  const result = spawnSync(
    NODE,
    [path.join(dir, "scripts/ci", script), ...args],
    {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_BASE_REF: "main",
        GITHUB_EVENT_PATH: "",
        GITHUB_REF: "",
        ...env,
      },
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

/**
 * Evaluate a module snippet with the scratch repo as the repository root, and parse the
 * single JSON object it prints.
 *
 * This is how a probe proves it is NOT vacuous: it evaluates the *previous* predicate in
 * the same scenario and asserts that the old one would have passed while the checker as
 * shipped fails.
 */
export function evaluateInRepo(dir, code) {
  const result = spawnSync(NODE, ["--input-type=module", "-e", code], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GITHUB_BASE_REF: "main" },
  });
  if (result.status !== 0) {
    throw new Error(
      `probe evaluation failed in ${dir} (status ${result.status}):\n${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout.trim().split("\n").pop());
}

/**
 * A pull-request body that satisfies every check except the one under test, so a probe's
 * exit code is attributable to its own scenario rather than to a half-filled template.
 *
 * The section list and the checklist headings come from the real
 * `.github/pull_request_template.md`, which the scratch repo also carries — the template
 * stays the single definition of "every fixed section", here too.
 */
export function completeBody({
  securityModel = "Opus 5",
  securityNote = null,
  gates = [],
  extraSecurityLines = [],
} = {}) {
  const gateRows =
    gates.length > 0
      ? gates.map(([gate, result, link]) => `| ${gate} | ${result} | ${link} |`)
      : [
          "| G1 — No bespoke primitives | n/a | |",
          "| Route coverage (`test:permissions`) | pass | |",
        ];

  return [
    "## Task",
    "",
    "A probe scenario.",
    "",
    "**Spec:** n/a — CI infrastructure probe",
    "**Rules in scope:** n/a — CI infrastructure probe",
    "",
    "## Implemented by",
    "",
    "**Model:** Sonnet 5",
    "**Session:** implementer-session",
    "",
    "## Reviewed by",
    "",
    "**Model:** Opus 5",
    "**Session:** reviewer-session",
    "",
    "## Security review",
    "",
    `**Model:** ${securityModel}`,
    "**Session:** security-reviewer-session",
    "**Surfaces examined:** the probe's synthetic surface.",
    `**Note:** ${securityNote ?? "n/a — the probe supplies no note."}`,
    ...extraSecurityLines,
    "",
    "## Screens opened",
    "",
    "n/a — the probe touches no apps/web path.",
    "",
    "## Gates",
    "",
    "| Gate | Result (pass / n/a / waived) | Decision-log link |",
    "| --- | --- | --- |",
    ...gateRows,
    "",
    "## Checklists",
    "",
    "### Any change",
    "",
    "- [x] Branch named `feat/…`, `fix/…`, `docs/…`, `chore/…`",
    "- [x] **Independent security review** completed and recorded",
    "",
    "### Backend change",
    "",
    "n/a — no backend change in this probe.",
    "",
    "### Frontend change",
    "",
    "n/a — no frontend change in this probe.",
    "",
    "### New `packages/ui` primitive",
    "",
    "n/a — no primitive in this probe.",
    "",
    "### New feature",
    "",
    "n/a — no feature in this probe.",
    "",
    "### New plugin",
    "",
    "n/a — no plugin in this probe.",
    "",
    "### Bug fix",
    "",
    "n/a — not a bug fix.",
    "",
    "### Phase completion",
    "",
    "n/a — no phase completes here.",
    "",
    "## Design review H1–H6",
    "",
    "## Not done",
    "",
    "Everything except the scenario under probe.",
    "",
  ].join("\n");
}

/**
 * Write a body to a file OUTSIDE the scratch repository and return its path.
 *
 * Outside deliberately: `commit()` stages everything, so a body written inside the tree
 * would land in the diff the checker is about to measure and quietly change the scenario.
 */
export function bodyFile(contents) {
  const file = path.join(scratchDir("pr-body"), "pr-body.md");
  writeFileSync(file, contents);
  return file;
}
