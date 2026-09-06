import { execFileSync } from "node:child_process";
import { repoRoot } from "./repo.mjs";

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

/** The ref this branch is being merged into. */
export function baseRef() {
  if (process.env.GITHUB_BASE_REF) {
    return `origin/${process.env.GITHUB_BASE_REF}`;
  }
  return "origin/main";
}

/**
 * Files changed against the base ref, with their status letter.
 *
 * @returns {{ status: string, file: string }[]}
 */
export function changedFiles() {
  const base = baseRef();
  let mergeBase;
  try {
    mergeBase = git(["merge-base", base, "HEAD"]).trim();
  } catch {
    return [];
  }

  const output = git([
    "diff",
    "--name-status",
    "--no-renames",
    `${mergeBase}..HEAD`,
  ]);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const [status, ...rest] = line.split(/\t/);
      return { status, file: rest.join("\t") };
    });
}

/** Just the paths. */
export function changedPaths(changes = changedFiles()) {
  return changes.map((change) => change.file);
}

/** Paths added by this branch (status `A`). */
export function addedPaths(changes = changedFiles()) {
  return changes
    .filter((change) => change.status === "A")
    .map((change) => change.file);
}
