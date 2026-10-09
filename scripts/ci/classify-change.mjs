#!/usr/bin/env node
/**
 * Change-scope classifier — decides whether a pull request is POLICY-ONLY.
 *
 * A policy-only pull request changes nothing but the agent operating policy and planning
 * records listed in POLICY_PATHS. For those, product jobs (build, unit, integration, audit,
 * E2E, G4/G8/G11 …) report skipped instead of re-measuring an unchanged product; the policy,
 * template, register, checker-test, gate-reconciliation and secret-scan jobs still run. Every
 * other change — product, dependency, deployment, CI, or any mix — is FULL and runs everything.
 * ci-cd.md § Applicability is the human-readable statement of this rule; this file is the rule.
 *
 * How it is trusted (Thomas, decision log 2026-10-09, "Opus policy-repair conductor"):
 *
 *   - It is executed from the MERGE BASE, never from the pull request's own head: the composite
 *     action .github/actions/change-scope does `git show <merge-base>:scripts/ci/classify-change.mjs`
 *     and runs that copy. A pull request that edits this file cannot classify itself with the
 *     edit. That is also why this file imports nothing from the repository — a base copy run
 *     from a temp directory must not resolve imports against the head checkout.
 *   - It judges LANDED COMMITS, not the net tree: every commit in merge-base..head, merges
 *     charged per parent, no rename detection (a rename lists both paths). A product change
 *     that is later reverted still makes the pull request FULL — the same rule as
 *     lib/security-review-note.mjs (GPT-F5/F6), and inherited commits count.
 *   - Labels, titles and PR bodies are never read.
 *   - It fails closed: any error, an empty range, a root commit, a symlink, an executable bit,
 *     a submodule, or any path outside POLICY_PATHS answers FULL.
 *
 * Output: prints `policy` or `full: <reason>` on stdout and exits 0. A crash exits non-zero,
 * which the composite action also treats as FULL.
 *
 * Usage: node classify-change.mjs --repo <dir> --base <sha> --head <sha>
 */

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Exact paths, and directory prefixes whose Markdown files are policy or planning records. */
export const POLICY_EXACT = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "docs/README.md",
  "docs/04-engineering/agent-workflow.md",
  "docs/04-engineering/definition-of-done.md",
  "docs/04-engineering/sdlc.md",
  "docs/04-engineering/error-fix-loop.md",
]);
export const POLICY_MARKDOWN_PREFIXES = ["docs/07-planning/"];

/** Regular, non-executable file — or absent (an add or a delete). Anything else is FULL. */
const PLAIN_MODES = new Set(["100644", "000000"]);

export function isPolicyPath(relative) {
  if (POLICY_EXACT.has(relative)) return true;
  return POLICY_MARKDOWN_PREFIXES.some(
    (prefix) => relative.startsWith(prefix) && relative.endsWith(".md") && !relative.includes("/../"),
  );
}

function git(repo, args) {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${result.status}): ${(result.stderr ?? "").trim()}`);
  }
  return result.stdout;
}

/**
 * Every (mode, path) a landed commit in base..head touched, merges per parent.
 * @returns {{sha:string, oldMode:string, newMode:string, path:string}[]}
 */
export function landedEntries(repo, base, head) {
  const listed = git(repo, ["rev-list", "--parents", "--reverse", `${base}..${head}`]);
  const entries = [];
  let commits = 0;
  for (const line of listed.split("\n")) {
    const [sha, ...parents] = line.trim().split(/\s+/).filter(Boolean);
    if (!sha) continue;
    commits += 1;
    if (parents.length === 0) throw new Error(`root commit ${sha} inside the range`);
    for (const parent of parents) {
      const raw = git(repo, ["diff-tree", "-r", "--raw", "--no-renames", "-z", parent, sha]);
      const fields = raw.split("\0");
      for (let i = 0; i + 1 < fields.length; i += 2) {
        const meta = fields[i];
        const file = fields[i + 1];
        if (meta === "") break;
        const match = /^:(\d{6}) (\d{6}) /.exec(meta);
        if (!match) throw new Error(`unreadable diff-tree record ${JSON.stringify(meta)}`);
        entries.push({ sha, oldMode: match[1], newMode: match[2], path: file });
      }
    }
  }
  if (commits === 0) throw new Error(`no commits in ${base}..${head}`);
  return entries;
}

/** @returns {{scope:"policy"|"full", reason:string}} */
export function classify(repo, base, head) {
  let entries;
  try {
    entries = landedEntries(repo, base, head);
  } catch (error) {
    return { scope: "full", reason: `history unreadable (${error.message})` };
  }
  for (const entry of entries) {
    if (!PLAIN_MODES.has(entry.oldMode) || !PLAIN_MODES.has(entry.newMode)) {
      return { scope: "full", reason: `${entry.path} has mode ${entry.oldMode}→${entry.newMode} in ${entry.sha.slice(0, 9)}` };
    }
    if (!isPolicyPath(entry.path)) {
      return { scope: "full", reason: `${entry.path} (${entry.sha.slice(0, 9)}) is not a policy or planning document` };
    }
  }
  return { scope: "policy", reason: `${entries.length} change(s), all policy or planning Markdown` };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

const invokedDirectly = (() => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const repo = argument("--repo");
  const base = argument("--base");
  const head = argument("--head");
  if (!repo || !base || !head) {
    process.stdout.write("full: usage — --repo, --base and --head are all required\n");
  } else {
    const { scope, reason } = classify(repo, base, head);
    process.stdout.write(scope === "policy" ? "policy\n" : `full: ${reason}\n`);
  }
}
