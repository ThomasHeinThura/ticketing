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
export class DiffUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "DiffUnavailableError";
  }
}

export function changedFiles() {
  const base = baseRef();
  let mergeBase;
  try {
    mergeBase = git(["merge-base", base, "HEAD"]).trim();
  } catch (error) {
    // F4: DO NOT return []. An empty change set is indistinguishable from "the diff
    // could not be computed", and every caller treats empty as "nothing sensitive was
    // touched" -- so a shallow clone, a trimmed fetch-depth or a renamed default branch
    // silently converts the security-review requirement into a green no-op whose output
    // reads like a successful check. Reproduced: GITHUB_BASE_REF=refs-that-do-not-exist
    // printed "no security-review path touched" and skipped the branch entirely.
    //
    // "the gate did not run" and "the gate ran and found nothing" are different facts,
    // exactly as the route-policy job's own comment says. Fail closed and say which.
    throw new DiffUnavailableError(
      `cannot determine the changed files: \`git merge-base ${base} HEAD\` failed ` +
        `(${String(error?.message ?? error).split("\n")[0]}). This is a CHECKOUT ` +
        "problem, not a clean diff. Any path-conditional gate -- the mandatory " +
        "security review among them -- would silently pass on an empty change set, so " +
        "it fails here instead. In CI, confirm `fetch-depth: 0` and that the base ref " +
        "exists; locally, fetch the base branch.",
    );
  }

  if (mergeBase === "") {
    throw new DiffUnavailableError(
      `\`git merge-base ${base} HEAD\` returned nothing. See above -- this is a ` +
        "checkout problem, not an empty diff.",
    );
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
