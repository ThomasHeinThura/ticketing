import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * `scripts/ci/lib/../../..` — where the checkers live in THIS checkout. Used only as a
 * fallback (see `resolveRepoRoot` below): correct when `git rev-parse` cannot run at all
 * (no git binary, or the caller's cwd genuinely isn't inside a work tree), and relied on by
 * `scratch-repo.mjs`'s red probes for the same reason it existed before this fix.
 */
const scriptOwnRoot = path.resolve(here, "../../..");

/**
 * The repository root, resolved against the CALLING process's cwd — `git rev-parse
 * --show-toplevel` — not against where `repo.mjs` itself happens to live. A checker
 * invoked via an absolute path into a different checkout (e.g. from a worktree at
 * `/tmp/lane-x` while `repo.mjs`'s own file lives in `/home/ubuntu/ticketing.v2`) must
 * resolve *that worktree's* root, or every git-backed check silently operates on the
 * wrong repository state (#399).
 */
function resolveRepoRoot() {
  try {
    const output = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (output) return output;
  } catch {
    // Not a git work tree (or git isn't runnable) from this cwd — fall back below.
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
export const generatedFiles = new Set(["routeTree.gen.ts"]);

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
