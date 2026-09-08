#!/usr/bin/env node
/**
 * Which directories the pnpm workspace actually contains — derived, not hand-listed.
 *
 * **A5, and the same defect in three more gates.** `check-overrides` walked `["apps",
 * "packages"]` exactly one level deep while its own comment said "from the
 * pnpm-workspace.yaml globs", which declares `packages/**` and `apps/**` — recursive. And
 * `check-skips`, `check-vocabulary` and `check-env` each carried their own hand-written
 * copy of the same list. Four gates, four literals, one fact: the workspace definition.
 *
 * This is the third shape of the defect class this pull request keeps meeting. F15 and H1
 * are "HEAD read as if it were history". M2 and A2 are "a text scan read as if it were the
 * scheduler". This one is "a hand-maintained list read as if it were a membership rule" —
 * true when written, and quietly false the day someone adds `tools/**` to the workspace or
 * nests a package one level deeper. Nothing would have failed; the gates would simply have
 * stopped covering the new code, which is the failure mode that does not announce itself.
 *
 * **Today this changes no result, and that is stated rather than glossed.** The workspace
 * declares exactly `packages/**` and `apps/**`, there is no package nested deeper than one
 * level, so the derived roots are byte-identical to the literals they replace. The fix is
 * structural: it closes the hole rather than reporting a violation.
 *
 * Not a YAML dependency, for the reason the rest of `scripts/ci` gives: there is no parser
 * at the root and adding one is a dependency change to a frozen manifest. The shape read
 * here is small and fixed — a top-level `packages:` key over a list of globs — and any glob
 * shape outside that grammar is a HARD FAILURE rather than a silent skip. A workspace this
 * cannot read is not a workspace with nothing in it.
 */

import path from "node:path";
import { exists, readText, repoRoot } from "./repo.mjs";

export const WORKSPACE_RELATIVE_PATH = "pnpm-workspace.yaml";

export class WorkspaceMembershipUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "WorkspaceMembershipUnavailableError";
  }
}

/** The globs under the workspace file's `packages:` key, in declaration order. */
export async function readWorkspaceGlobs() {
  const absolute = path.join(repoRoot, WORKSPACE_RELATIVE_PATH);
  let source;
  try {
    source = await readText(absolute);
  } catch (error) {
    throw new WorkspaceMembershipUnavailableError(
      `${WORKSPACE_RELATIVE_PATH} could not be read (${error.code ?? error.message}). ` +
        "Four gates derive the directories they scan from it, so an unreadable workspace " +
        'definition must not arrive as "there is nothing to scan".',
    );
  }

  const globs = [];
  let inside = false;
  for (const line of source.split("\n")) {
    if (/^packages:\s*$/.test(line)) {
      inside = true;
      continue;
    }
    if (!inside) continue;
    if (/^\S/.test(line)) break;
    const item = /^\s+-\s*(?:["']?)([^"'#]+?)(?:["']?)\s*(?:#.*)?$/.exec(line);
    if (item) globs.push(item[1].trim());
  }

  if (globs.length === 0) {
    throw new WorkspaceMembershipUnavailableError(
      `${WORKSPACE_RELATIVE_PATH} declares no \`packages:\` globs. A workspace with no ` +
        "members is indistinguishable from one whose members were all removed, and the " +
        "gates that scan `apps/**` and `packages/**` would silently scan nothing.",
    );
  }
  return globs;
}

/**
 * The static directory prefix of one glob, or null when the glob only excludes.
 *
 * Grammar accepted: `dir`, `dir/*`, `dir/**`, `dir/sub/**`, and any of those negated with
 * a leading `!`. Anything else throws — a glob whose scope this cannot compute would
 * otherwise silently narrow every gate built on it.
 */
export function globRoot(glob) {
  const negated = glob.startsWith("!");
  const pattern = negated ? glob.slice(1) : glob;
  const segments = pattern.split("/").filter((segment) => segment !== "");

  if (segments.length === 0) {
    throw new WorkspaceMembershipUnavailableError(
      `${WORKSPACE_RELATIVE_PATH} declares the glob "${glob}", which names no directory.`,
    );
  }

  const wildcardAt = segments.findIndex((segment) => /[*?[\]{}]/.test(segment));
  const staticSegments =
    wildcardAt === -1 ? segments : segments.slice(0, wildcardAt);

  if (staticSegments.length === 0) {
    throw new WorkspaceMembershipUnavailableError(
      `${WORKSPACE_RELATIVE_PATH} declares the glob "${glob}", whose first segment is a ` +
        "wildcard. The directories every scanning gate walks are derived from these " +
        "globs, and a glob rooted at the repository itself would either scan " +
        "node_modules or — depending on the caller — nothing at all. Name the directory.",
    );
  }

  for (const segment of segments.slice(staticSegments.length)) {
    if (!/^(\*|\*\*)$/.test(segment)) {
      throw new WorkspaceMembershipUnavailableError(
        `${WORKSPACE_RELATIVE_PATH} declares the glob "${glob}", which uses the pattern ` +
          `segment "${segment}". This reader understands \`*\` and \`**\` only, and a ` +
          "pattern it cannot evaluate must fail rather than quietly match nothing.",
      );
    }
  }

  return { root: staticSegments.join("/"), negated, pattern, segments };
}

/**
 * The top-level directories the workspace covers, deduplicated.
 *
 * What a scanning gate should walk. Negations narrow within a root rather than removing
 * it, so they do not remove a root here — `codeFilesUnder` walks trees, and a gate that
 * wants to skip a subtree says so itself.
 */
export async function readWorkspaceRoots() {
  const roots = [];
  for (const glob of await readWorkspaceGlobs()) {
    const parsed = globRoot(glob);
    if (parsed.negated) continue;
    if (!roots.includes(parsed.root)) roots.push(parsed.root);
  }
  return roots.sort();
}

/** Does one path match one parsed glob? `**` spans segments; `*` spans exactly one. */
function matches(relative, parsed) {
  const target = relative.split("/").filter(Boolean);
  const pattern = parsed.segments;

  const walk = (t, p) => {
    if (p === pattern.length) return t === target.length;
    const segment = pattern[p];
    if (segment === "**") {
      for (let skip = t; skip <= target.length; skip += 1) {
        if (walk(skip, p + 1)) return true;
      }
      return false;
    }
    if (t >= target.length) return false;
    if (segment === "*" || segment === target[t]) return walk(t + 1, p + 1);
    return false;
  };

  return walk(0, 0);
}

/**
 * Every workspace package's `package.json`, repo-relative, root manifest first.
 *
 * Enumerated by walking each glob's root and testing directories against the glob, so a
 * package nested two levels deep is found — which one level of `readdir` could not do.
 */
export async function readWorkspaceManifests() {
  const globs = (await readWorkspaceGlobs()).map(globRoot);
  const includes = globs.filter((glob) => !glob.negated);
  const excludes = globs.filter((glob) => glob.negated);

  const found = new Set(["package.json"]);
  const { readdir } = await import("node:fs/promises");

  const walkDirectory = async (relative) => {
    let entries;
    try {
      entries = await readdir(path.join(repoRoot, relative), {
        withFileTypes: true,
      });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw new WorkspaceMembershipUnavailableError(
        `${relative} is inside a workspace glob and could not be listed ` +
          `(${error.code}). A directory that cannot be read is not an empty one.`,
      );
    }

    const isMember =
      includes.some((glob) => matches(relative, glob)) &&
      !excludes.some((glob) => matches(relative, glob));
    if (
      isMember &&
      (await exists(path.join(repoRoot, relative, "package.json")))
    ) {
      found.add(`${relative}/package.json`);
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      await walkDirectory(`${relative}/${entry.name}`);
    }
  };

  for (const root of new Set(includes.map((glob) => glob.root))) {
    await walkDirectory(root);
  }

  return [...found].sort((a, b) =>
    a === "package.json" ? -1 : b === "package.json" ? 1 : a.localeCompare(b),
  );
}
