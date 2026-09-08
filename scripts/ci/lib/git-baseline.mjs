#!/usr/bin/env node
/**
 * Baseline monotonicity for the CI registers — the JS counterpart of
 * `tests/permissions/git-baseline.ts`, with the same semantics and the same refusals.
 *
 * `env-baseline.json` and `vocabulary-baseline.json` are documented as ratchets that
 * "only ever shrink". Neither compared itself against history, so neither was one (F3).
 * Membership short-circuited the failure and staleness produced a WARNING, so a change
 * that added a violation AND appended the matching baseline line in the same diff went
 * green while printing a number the file itself says must only fall:
 *
 *   process.env.REV19_EXFIL_WEBHOOK_URL added         => check:env exit 1
 *   ...plus one line in env-baseline.json             => check:env exit 0, "53 ... must only fall"
 *
 * A list only shrinks if something the current change cannot rewrite remembers what it
 * used to contain. That is the baseline's own content at the merge base with main.
 *
 * Three outcomes, and only one of them is a pass:
 *
 *   resolved + path present  -> compare; any ADDED key fails.
 *   resolved + path absent   -> bootstrap. This is the branch introducing the file, so
 *                              there is nothing to have grown from. Not a failure.
 *   unresolved               -> FAIL CLOSED. A shallow single-branch checkout produces
 *                              this, and a build that cannot prove a baseline did not
 *                              grow must not report that it did not. Use fetch-depth: 0.
 *
 * On `main` itself the merge base is HEAD, so "previous" equals the working file and no
 * drift is ever reported — correctly, since main has nothing to have grown relative to.
 */

import { spawnSync } from "node:child_process";
import { repoRoot } from "./repo.mjs";

const CANDIDATE_BASE_REFS = ["origin/main", "main"];

function git(args) {
  return spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

function refExists(ref) {
  return (
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).status === 0
  );
}

/** The ref this branch is being compared against, honouring GITHUB_BASE_REF in CI. */
function candidateRefs() {
  const fromCi = process.env.GITHUB_BASE_REF;
  return fromCi
    ? [`origin/${fromCi}`, fromCi, ...CANDIDATE_BASE_REFS]
    : CANDIDATE_BASE_REFS;
}

/**
 * @returns {{kind:"resolved",ref:string,sha:string}|{kind:"unresolved",triedRefs:string[]}}
 */
export function resolveMergeBase() {
  const tried = [];
  for (const ref of candidateRefs()) {
    tried.push(ref);
    if (!refExists(ref)) continue;
    const result = git(["merge-base", "HEAD", ref]);
    if (result.status !== 0) continue;
    const sha = result.stdout.trim();
    if (sha !== "") return { kind: "resolved", ref, sha };
  }
  return { kind: "unresolved", triedRefs: tried };
}

export class BaselineHistoryUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "BaselineHistoryUnavailableError";
  }
}

/**
 * The baseline's parsed content at the merge base, or `null` when the path did not
 * exist there (bootstrap). Throws when the merge base cannot be resolved at all.
 *
 * @param {string} relativePath repository-relative path to the baseline JSON
 */
export function readBaselineAtMergeBase(relativePath) {
  const base = resolveMergeBase();
  if (base.kind === "unresolved") {
    throw new BaselineHistoryUnavailableError(
      `cannot resolve a merge base for ${relativePath} (tried ${base.triedRefs.join(", ")}). ` +
        "This baseline is a shrink-only ratchet, and proving it did not grow requires its " +
        "content at the merge base — a shallow, single-branch checkout has no such history. " +
        "This does NOT mean the baseline is fine: it means the check could not run. Use " +
        "`fetch-depth: 0`, or `git fetch origin main`, and run it again.",
    );
  }

  const shown = readTextAtCommit(base.sha, relativePath);
  if (shown === null) return { base, previous: null };

  try {
    return { base, previous: JSON.parse(shown) };
  } catch (error) {
    throw new BaselineHistoryUnavailableError(
      `${relativePath} at the merge base ${base.sha} is not valid JSON: ${error.message}`,
    );
  }
}

/**
 * Keys present now but absent at the merge base — the additions a ratchet forbids.
 *
 * @param {Record<string, unknown>|undefined} now
 * @param {Record<string, unknown>|null|undefined} previous
 * @returns {string[]}
 */
export function addedKeys(now, previous) {
  if (!previous) return [];
  const before = new Set(Object.keys(previous ?? {}));
  return Object.keys(now ?? {})
    .filter((key) => !before.has(key))
    .sort();
}

/**
 * Values added under an existing key — for baselines whose values are lists of
 * locations or fingerprints. Growth INSIDE a key is the F10 half: a file already
 * baselined must not silently absorb another read.
 *
 * @returns {{key:string, added:string[]}[]}
 */
export function addedWithinKeys(now, previous) {
  if (!previous) return [];
  const out = [];
  for (const [key, value] of Object.entries(now ?? {})) {
    const before = previous[key];
    if (before === undefined) continue; // a wholly new key is addedKeys()' business
    const beforeSet = new Set(Array.isArray(before) ? before : []);
    const nowList = Array.isArray(value) ? value : [];
    const added = nowList.filter((item) => !beforeSet.has(item)).sort();
    if (added.length > 0) out.push({ key, added });
  }
  return out;
}

/**
 * Raw text of a repo-relative path at a commit, or `null` when the path does not exist
 * there. Shared with lib/security-paths.mjs, which needs the authority document's
 * content at the merge base for exactly the same reason a baseline does: the current
 * change cannot rewrite history, so history is the only thing it cannot move.
 *
 * @param {string} sha
 * @param {string} relativePath
 * @returns {string|null}
 */
export function readTextAtCommit(sha, relativePath) {
  const exists = git(["cat-file", "-e", `${sha}:${relativePath}`]);
  if (exists.status !== 0) return null;

  const shown = git(["show", `${sha}:${relativePath}`]);
  if (shown.status !== 0) {
    throw new BaselineHistoryUnavailableError(
      `\`git show ${sha}:${relativePath}\` failed: ${shown.stderr.trim()}`,
    );
  }
  return shown.stdout;
}

/**
 * True when `ancestor` is an ancestor of `descendant` (or the same commit).
 * `git merge-base --is-ancestor` exits 0 for yes, 1 for no, and anything else is a
 * plumbing failure that must not be read as "no".
 *
 * @returns {boolean}
 */
export function isAncestor(ancestor, descendant) {
  const result = git(["merge-base", "--is-ancestor", ancestor, descendant]);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new BaselineHistoryUnavailableError(
    `\`git merge-base --is-ancestor ${ancestor} ${descendant}\` failed ` +
      `(status ${result.status}): ${result.stderr.trim()}. "could not tell" is not "no".`,
  );
}

/**
 * Repo-relative paths that differ between two commits.
 *
 * @returns {string[]}
 */
export function changedPathsBetween(from, to) {
  const result = git(["diff", "--name-only", "--no-renames", `${from}..${to}`]);
  if (result.status !== 0) {
    throw new BaselineHistoryUnavailableError(
      `\`git diff --name-only ${from}..${to}\` failed: ${result.stderr.trim()}`,
    );
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** How many commits reach `sha`, used only to order attested heads along a history. */
export function commitDepth(sha) {
  const result = git(["rev-list", "--count", sha]);
  if (result.status !== 0) {
    throw new BaselineHistoryUnavailableError(
      `\`git rev-list --count ${sha}\` failed: ${result.stderr.trim()}`,
    );
  }
  return Number(result.stdout.trim());
}

/** Resolve a revision to a full SHA, or `null` when it does not exist. */
export function resolveCommit(rev) {
  const result = git(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
  return result.status === 0 ? result.stdout.trim() : null;
}

/**
 * Normalise a ratchet section into `key -> string[]`, whether the value is a bare list
 * or an object carrying one under `listField`.
 *
 * GPT-F3: `unattributableReads` values are objects — `{ reason, occurrences }` — and
 * `addedWithinKeys` compares arrays. `previous[key]` was an object, so `beforeSet` was
 * empty AND `nowList` was empty, and the function returned `[]` for every possible
 * change. Proven before this fix:
 *
 *   addedWithinKeys({f:{reason:"x",reads:2}}, {f:{reason:"x",reads:1}})  ->  []
 *
 * So the diff that added a second computed `process.env` read and bumped the same
 * file's baseline from `reads: 1` to `reads: 2` moved both sides of the comparison
 * together and stayed green — the very same-diff bypass F3 was supposed to close, one
 * level down. Normalising first makes the existing comparison see the list it was
 * written for.
 *
 * @param {Record<string, unknown>|null|undefined} section
 * @param {string} listField
 * @returns {Record<string, string[]>|null}
 */
export function normaliseSection(section, listField) {
  if (!section) return null;
  const out = {};
  for (const [key, value] of Object.entries(section)) {
    if (Array.isArray(value)) {
      out[key] = value.map(String);
      continue;
    }
    if (value !== null && typeof value === "object") {
      const list = value[listField];
      out[key] = Array.isArray(list) ? list.map(String) : [];
      continue;
    }
    // A scalar (the pre-GPT-F3 `reads: 1`) carries no identities at all. An empty list
    // is the fail-closed reading: every currently observed identity then counts as
    // ADDED relative to it, which is what "we cannot tell what was there" must mean.
    out[key] = [];
  }
  return out;
}
