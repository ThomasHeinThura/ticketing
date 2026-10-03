import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * `scripts/ci/lib/../../..` — where the checkers live in THIS checkout. Used only as a
 * fallback (see `resolveRepoRoot` below): correct when the caller's cwd genuinely isn't
 * inside any git work tree at all. `scratch-repo.mjs`'s red probes never exercise this path
 * — every scratch directory is made a real git work tree first.
 */
const scriptOwnRoot = path.resolve(here, "../../..");

/**
 * Repo-relative path that only exists in THIS project's checkout (it's this very file).
 * Used by `resolveRepoRoot` (#414) to tell "a different worktree of this same project" —
 * where the marker is present, at some other absolute location — apart from "cwd happens
 * to be inside a completely unrelated git repository", where a resolved root can look
 * superficially fine (a real, absolute path from a real `git rev-parse`) while containing
 * none of this project's checkers at all.
 */
const CHECKOUT_MARKER = "scripts/ci/lib/repo.mjs";

/**
 * True when `candidateRoot` actually looks like this project's checkout (or a worktree of
 * it), not merely some other git repository the caller's cwd happened to resolve into.
 */
function looksLikeThisCheckout(candidateRoot) {
  return existsSync(path.join(candidateRoot, CHECKOUT_MARKER));
}

/**
 * The repository root, resolved against the CALLING process's cwd — `git rev-parse
 * --show-toplevel` — not against where `repo.mjs` itself happens to live. A checker
 * invoked via an absolute path into a different checkout (e.g. from a worktree at
 * `/tmp/lane-x` while `repo.mjs`'s own file lives in `/home/ubuntu/ticketing.v2`) must
 * resolve *that worktree's* root, or every git-backed check silently operates on the
 * wrong repository state (#399).
 *
 * The ONLY legitimate reason to fall back to `scriptOwnRoot` is "cwd genuinely isn't
 * inside any git work tree" — `git rev-parse --show-toplevel` exits 128 with "not a git
 * repository" on stderr for that case. Anything else (git not on PATH — `ENOENT`, a
 * permission error, a hang) must fail loudly instead of silently defaulting: a silent
 * fallback there is the exact same wrong-root failure #399 describes, just re-triggered
 * by "the git call failed" instead of "invoked via absolute path from elsewhere" — see
 * `diff.mjs`'s `DiffUnavailableError` for the same discipline applied one file over.
 *
 * A resolved root can also be a real, unrelated git repository — running a checker via an
 * absolute path while cwd sits inside some OTHER project resolves cleanly to THAT
 * project's top level, which then has zero workspace packages/source files to check. Every
 * checker built on `listWorkspaceManifests`/`walk` reports that as a vacuous, silently
 * clean pass rather than an error (#414). So a resolved root is only accepted once it also
 * passes `looksLikeThisCheckout` — cheap and exact, since the marker is this very file, and
 * true for every worktree of this project (the file is checked in) and false for anything
 * else that isn't this project.
 */
function resolveRepoRoot() {
  let output = null;
  try {
    output = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    }).trim();
  } catch (error) {
    const stderr = String(error?.stderr ?? "");
    // Deliberately narrow: git's "cwd genuinely isn't inside any work tree" message is
    // "not a git repository (or any of the parent directories)" (or "... up to mount
    // point ..."). A broader `/not a git repository/i` also matches three OTHER exit-128
    // messages — a worktree whose admin dir is gone, a `.git` file pointing at a missing
    // directory, `GIT_DIR` set to a nonexistent path — all of which mean something is
    // actually broken, not "there is genuinely no repo here." Matching those would
    // silently fall back to the wrong root, the #399 bug again in a narrower disguise.
    const isNotAGitRepo =
      error?.status === 128 && /not a git repository \(or any/i.test(stderr);
    if (!isNotAGitRepo) {
      throw new Error(
        "repo.mjs: could not resolve the repository root via " +
          `'git rev-parse --show-toplevel' from cwd ${process.cwd()}. This is not the ` +
          `expected "cwd isn't inside a git work tree" case, so falling back to this ` +
          `script's own location would silently resolve the WRONG repository root ` +
          `(#399) rather than fail loudly. Original error: ${error?.message ?? error}` +
          (stderr ? ` (stderr: ${stderr.trim()})` : ""),
        { cause: error },
      );
    }
    // Genuinely not inside any git work tree — fall back below.
  }
  if (output) {
    if (looksLikeThisCheckout(output)) return output;
    throw new Error(
      `repo.mjs: 'git rev-parse --show-toplevel' from cwd ${process.cwd()} resolved to ` +
        `"${output}", a real git repository that does not look like this project's ` +
        `checkout (it has no ${CHECKOUT_MARKER}). Refusing to silently treat an ` +
        "unrelated repository as this one's root and report a vacuous, empty-but-clean " +
        "pass (#414) -- rerun this checker with a cwd inside this project's checkout " +
        "(or one of its worktrees) instead.",
    );
  }
  return scriptOwnRoot;
}

/** Absolute path to the repository root. */
export const repoRoot = resolveRepoRoot();

/** Directories that never contain reviewable source. */
export const ignoredDirectories = new Set([
  ".git",
  ".turbo",
  ".next",
  ".source",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "playwright-report",
  "test-results",
]);

/** Generated files that are checked in but are not hand-written source. */
export const generatedFiles = new Set([
  "routeTree.agent.gen.ts",
  "routeTree.portal.gen.ts",
]);

/**
 * Walk a directory, yielding every file path that survives the filters.
 *
 * @param {string} dir absolute directory to walk
 * @param {(relativePath: string) => boolean} [accept] predicate over the repo-relative path
 * @returns {Promise<string[]>} absolute file paths, sorted
 */
export async function walk(dir, accept = () => true) {
  const found = [];
  let entries;

  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return found;
    }
    throw error;
  }

  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(repoRoot, absolute);

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) {
        continue;
      }
      found.push(...(await walk(absolute, accept)));
      continue;
    }

    if (!entry.isFile() || generatedFiles.has(entry.name)) {
      continue;
    }

    if (accept(relative)) {
      found.push(absolute);
    }
  }

  return found.sort();
}

const codeExtensions = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

/** True when the repo-relative path is TypeScript or JavaScript source. */
export function isCode(relativePath) {
  return codeExtensions.has(path.extname(relativePath));
}

/**
 * Every TypeScript/JavaScript file under the given repo-relative roots.
 *
 * @param {string[]} roots repo-relative directories
 * @returns {Promise<string[]>} absolute file paths
 */
export async function codeFilesUnder(roots) {
  const results = await Promise.all(
    roots.map((root) => walk(path.join(repoRoot, root), isCode)),
  );
  return results.flat().sort();
}

/** Repo-relative, forward-slashed path for reporting. */
export function rel(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

export async function readText(absolutePath) {
  return fs.readFile(absolutePath, "utf8");
}

export async function exists(absolutePath) {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Turn a `path/to/file.ts:12` style location plus a message into one printable line.
 */
export function violation(location, message) {
  return `  ${location}\n      ${message}`;
}

/**
 * Standard reporter for a check script.
 *
 * @param {object} report
 * @param {string} report.name the `pnpm` script name, for the header
 * @param {string[]} report.failures blocking problems
 * @param {string[]} [report.warnings] non-blocking notes
 * @param {string} [report.ok] message printed when there are no failures
 */
export function finish({ name, failures, warnings = [], ok = "clean" }) {
  for (const warning of warnings) {
    process.stdout.write(`${name}: note — ${warning}\n`);
  }

  if (failures.length > 0) {
    process.stderr.write(`\n${name}: ${failures.length} problem(s)\n\n`);
    for (const failure of failures) {
      process.stderr.write(`${failure}\n`);
    }
    process.stderr.write("\n");
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`${name}: ${ok}\n`);
}
