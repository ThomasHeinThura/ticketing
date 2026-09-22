#!/usr/bin/env node
/**
 * check:dockerfile-deps — the Dockerfile's `deps` stage COPY list matches the workspace.
 *
 * #170, found while root-causing #168 (`docker build .` failed: Rolldown could not resolve
 * `react/compiler-runtime` from `packages/ui/src/components/button.tsx`). The `deps` stage
 * copies each workspace package's `package.json` individually — `COPY packages/domain/
 * package.json packages/domain/`, one line per package — so that stage can be Docker-layer-
 * cached independently of full source changes. That list is hand-enumerated, and it had
 * silently drifted: `packages/domain` and, at an earlier point, `packages/ui` were both
 * absent, so neither ever got a `node_modules` in that stage. #168 fixed the concrete
 * failure by adding the missing lines; nothing checked that the list was complete, so a new
 * workspace package could go missing again with no CI signal. This is that signal.
 *
 * **Why a text-parsing check and not `COPY --parents`.** BuildKit's `COPY --parents
 * packages/*\/package.json packages/**\/package.json ./` would eliminate the hand-enumerated
 * list entirely, and #170 asked for it to be preferred if the repository's actual CI build
 * environment is confirmed to support it. It is not confirmable: neither `ci-fast.yml` nor
 * `ci-full.yml` contains a `docker build` / `docker buildx build` step at all — the "build
 * the container image" stage docs/04-engineering/ci-cd.md's Main pipeline describes is
 * documented, not yet implemented as a workflow. There is no pinned BuildKit version to
 * check evidence against. Re-evaluate `COPY --parents` once an image-build CI job exists
 * and pins a real `docker`/`buildx` version.
 *
 * Not a Dockerfile parser: it locates the `FROM ... AS deps` stage by literal line match and
 * reads `COPY <manifest> <dir>/` lines inside it with a fixed grammar. Every non-blank,
 * non-comment line inside that stage is classified as exactly one of: the stage's own
 * boundary line, the root-manifest bootstrap COPY, a recognized per-package manifest COPY,
 * an ordinary instruction with no manifest relevance (`RUN`, `ENV`, `WORKDIR`, a `COPY` that
 * does not mention `package.json` at all, ...), or unclassifiable. A line that mentions
 * `package.json` but does not match the recognized per-package or root-bootstrap shape is a
 * HARD FAILURE rather than a silent skip or a silent match — a re-ordered arg, a mismatched
 * source/destination directory, or a heredoc body whose text happens to look like a COPY
 * line are all indistinguishable from each other to a line-based reader, and a `deps` stage
 * containing a line this cannot classify is not a `deps` stage with nothing relevant in it
 * (security review, PR #237, F3 — an earlier draft of this paragraph claimed this behavior
 * without the code to back it; F1 and F2 in the same review are the two false negatives that
 * made the point concrete: a misdirected manifest and an un-named stage boundary each passed
 * green before their fixes below).
 *
 * The set of workspace package manifests, and the accepted `<root>/<name>/package.json`
 * prefixes on the Dockerfile side, both come from `scripts/ci/lib/workspace-membership.mjs`
 * (`readWorkspaceManifests()` and `readWorkspaceRoots()`), the same derivation four other
 * gates already share (see that file's header) — not a second hand-written copy of the
 * workspace list. (Security review F5: this used to hardcode `packages|apps` on this side
 * only, so a new workspace root such as `tools/**` would deadlock the gate — it would report
 * a COPY line as missing when the line was already present, with no way to satisfy the check
 * short of editing this script. Deriving both sides from the same source removes that.)
 *
 * Usage:
 *   node scripts/ci/check-dockerfile-deps.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { finish, readText, repoRoot, violation } from "./lib/repo.mjs";
import {
  readWorkspaceManifests,
  readWorkspaceRoots,
} from "./lib/workspace-membership.mjs";

const NAME = "check:dockerfile-deps";
export const DOCKERFILE_RELATIVE_PATH = "Dockerfile";

const STAGE_START = /^FROM\s+\S+\s+AS\s+deps\s*$/i;
// Deliberately does not require `AS <name>`: an un-named `FROM <image>` stage (ordinary —
// the final stage of a multi-stage build frequently has no name) still ends the `deps`
// stage's boundary. Security review F2: this used to require a name, so an un-named
// intermediate stage was invisible as a boundary and a later stage's COPY lines were
// silently counted as if they belonged to `deps`. Stays distinct from STAGE_START (which
// still requires the literal `AS deps`) so the two are never confused; the loop in
// `extractDepsStage` only tests this pattern once `start` is already set, so the `deps`
// stage's own opening line — matched by STAGE_START on the same iteration — is never
// re-tested against this looser pattern and double-counted as its own boundary.
const ANY_STAGE = /^FROM\s+\S+(\s+AS\s+\S+)?\s*$/i;

/** Roots accepted on the Dockerfile side when no live workspace read is available (tests). */
export const DEFAULT_WORKSPACE_ROOTS = ["apps", "packages"];

/**
 * Build the per-package manifest COPY pattern for a given set of workspace roots.
 *
 * Group 1 captures the source directory (with trailing slash, e.g. `packages/domain/`) and
 * is back-referenced for the destination, so `COPY packages/domain/package.json
 * packages/ui/` — same manifest, wrong destination directory — does not match. Security
 * review F1: the destination used to be matched only as *some* `(packages|apps)/.../`
 * directory, never compared to the source's own directory, so a misdirected manifest (the
 * single most likely shape of a copy-pasted-and-half-edited new line) passed as if correct.
 *
 * @param {string[]} roots workspace root directory names (e.g. `["apps", "packages"]`)
 * @returns {RegExp}
 */
export function buildCopyManifestPattern(roots) {
  const escaped = roots.map((root) =>
    root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const alternation = escaped.join("|");
  return new RegExp(
    `^COPY\\s+((?:${alternation})/[^/\\s]+/)package\\.json\\s+\\1\\s*$`,
  );
}

/**
 * The root manifest bootstrap line — `COPY .npmrc pnpm-lock.yaml pnpm-workspace.yaml
 * package.json ./`, or any COPY of two or more root-level files ending in `package.json`
 * and landing at the repo root (`./` or `.`). This is deliberately excluded from the
 * per-package comparison (see the filter in `main()` below) but must still be recognized as
 * a legitimate line rather than tripping the hard-failure scan just below, since it is the
 * one line in the real `deps` stage that mentions `package.json` without being a per-package
 * COPY. Requires at least one other file ahead of `package.json` so a single misdirected
 * per-package COPY (`COPY packages/domain/package.json ./`) does NOT match this and falls
 * through to the hard failure instead.
 */
const ROOT_MANIFEST_COPY = /^COPY\s+(?:\S+\s+){1,}package\.json\s+\.\/?\s*$/;

/**
 * A BuildKit heredoc opener (`RUN <<EOF`, `RUN <<-EOF`, `COPY <<EOF /dest`, a quoted
 * terminator, ...). Captures the terminator word so the body can be skipped up to its
 * matching close line.
 */
const HEREDOC_START = /<<-?(['"]?)([A-Za-z_][\w]*)\1/;

/**
 * The `deps` stage's own lines — from its `FROM ... AS deps` line up to (not including)
 * the next `FROM ... AS <stage>` line, or end of file if it is the last stage.
 *
 * @param {string} source the whole Dockerfile
 * @returns {string[]} the stage's lines
 */
export function extractDepsStage(source) {
  const lines = source.split("\n");
  let start = -1;
  let end = lines.length;

  for (let i = 0; i < lines.length; i += 1) {
    if (start === -1) {
      if (STAGE_START.test(lines[i].trim())) start = i;
      continue;
    }
    if (ANY_STAGE.test(lines[i].trim())) {
      end = i;
      break;
    }
  }

  if (start === -1) {
    throw new Error(
      `No \`FROM ... AS deps\` stage found in ${DOCKERFILE_RELATIVE_PATH}. This check reads ` +
        "the deps stage's COPY lines by exact stage-boundary match, and a Dockerfile with " +
        "no stage by that name is not a Dockerfile with nothing to check — it is one this " +
        "gate cannot read.",
    );
  }

  return lines.slice(start, end);
}

/**
 * Every `packages/<name>/package.json` / `apps/<name>/package.json` path COPYed in the
 * given stage lines, exactly as the Dockerfile spells it.
 *
 * Every non-blank, non-comment line is classified: the stage's own boundary line, a heredoc
 * body (opened by `RUN <<EOF` or similar — see below), the root manifest bootstrap COPY, a
 * recognized per-package manifest COPY, or — if none of those and the line nonetheless
 * mentions `package.json` — a hard failure (security review F3). Lines with no
 * `package.json` mention at all (`RUN pnpm install ...`, `ENV ...`, `WORKDIR ...`, a COPY of
 * something else entirely) are not manifest-relevant and are silently skipped, as before.
 *
 * **Heredocs are always a hard failure, regardless of what their body contains.** A
 * line-based reader cannot tell a heredoc's body content apart from a real top-level
 * instruction that happens to read the same — probed for real: a `RUN <<EOF` body
 * containing the exact text of a valid `COPY <pkg>/package.json <pkg>/` line matches the
 * per-package pattern just as confidently as the real thing would, so a substring check on
 * `package.json` alone cannot distinguish "malformed COPY" from "well-formed-looking
 * heredoc body". Tracking the heredoc's open/close boundary and refusing to classify
 * anything inside it — whatever it contains — is what actually closes that gap.
 *
 * @param {string[]} stageLines
 * @param {string[]} [roots] workspace root directory names; defaults to
 *   `DEFAULT_WORKSPACE_ROOTS` for callers (tests) that have no live workspace read.
 * @returns {Set<string>}
 */
export function copiedManifests(stageLines, roots = DEFAULT_WORKSPACE_ROOTS) {
  const copyManifest = buildCopyManifestPattern(roots);
  const found = new Set();
  let heredocTerminator = null;

  for (const rawLine of stageLines) {
    const line = rawLine.trim();

    if (heredocTerminator !== null) {
      if (line === heredocTerminator) {
        heredocTerminator = null;
        continue;
      }
      throw new Error(
        `A line inside a heredoc (opened by \`<<${heredocTerminator}\`) sits in the ` +
          `\`deps\` stage: \`${rawLine.trim()}\`. This gate reads the deps stage's COPY ` +
          "lines by literal line match, so it cannot tell a heredoc body's content apart " +
          "from a real top-level instruction that happens to look the same — a `deps` " +
          "stage containing a heredoc is not a `deps` stage this gate can read.",
      );
    }

    if (line === "" || line.startsWith("#")) continue;
    if (STAGE_START.test(line)) continue;

    const heredocStart = HEREDOC_START.exec(line);
    if (heredocStart) {
      heredocTerminator = heredocStart[2];
      continue;
    }

    const match = copyManifest.exec(line);
    if (match) {
      found.add(`${match[1]}package.json`);
      continue;
    }

    if (ROOT_MANIFEST_COPY.test(line)) continue;

    if (line.includes("package.json")) {
      throw new Error(
        "A line in the `deps` stage mentions `package.json` but is not a recognized " +
          "`COPY <pkg>/package.json <pkg>/` line or the root-manifest bootstrap COPY: " +
          `\`${rawLine.trim()}\`. This is either a malformed COPY (a mismatched source and ` +
          "destination directory, an extra flag, a line wrapped across multiple lines) or " +
          "other content that merely resembles a COPY line. Either way this gate cannot " +
          "classify it, and a `deps` stage containing a line it cannot classify is not a " +
          "`deps` stage with nothing relevant in it.",
      );
    }
  }

  if (heredocTerminator !== null) {
    throw new Error(
      `A heredoc opened by \`<<${heredocTerminator}\` in the \`deps\` stage is never ` +
        "closed before the stage ends. This gate cannot tell what such a heredoc's body " +
        "would have contained, so it refuses to run rather than silently ignoring it.",
    );
  }

  return found;
}

async function main() {
  const failures = [];
  const dockerfilePath = path.join(repoRoot, DOCKERFILE_RELATIVE_PATH);
  const source = await readText(dockerfilePath);

  let stageLines;
  try {
    stageLines = extractDepsStage(source);
  } catch (error) {
    finish({
      name: NAME,
      failures: [violation(DOCKERFILE_RELATIVE_PATH, error.message)],
    });
    return;
  }

  const roots = await readWorkspaceRoots();

  let copied;
  try {
    copied = copiedManifests(stageLines, roots);
  } catch (error) {
    finish({
      name: NAME,
      failures: [violation(DOCKERFILE_RELATIVE_PATH, error.message)],
    });
    return;
  }

  const workspaceManifests = (await readWorkspaceManifests()).filter(
    // The root manifest is copied on its own line (`COPY .npmrc pnpm-lock.yaml
    // pnpm-workspace.yaml package.json ./`), never as a per-package `COPY <pkg>/
    // package.json <pkg>/` line, so it is not part of what this gate compares.
    (manifest) => manifest !== "package.json",
  );
  const expected = new Set(workspaceManifests);

  const missing = [...expected]
    .filter((manifest) => !copied.has(manifest))
    .sort();
  const extra = [...copied]
    .filter((manifest) => !expected.has(manifest))
    .sort();

  for (const manifest of missing) {
    const dir = manifest.replace(/package\.json$/, "");
    failures.push(
      violation(
        DOCKERFILE_RELATIVE_PATH,
        `${manifest} is a workspace package manifest (pnpm-workspace.yaml) that the ` +
          `\`deps\` stage does not COPY. Add \`COPY ${manifest} ${dir}\` next to the other ` +
          "per-package lines — otherwise that package has no node_modules after " +
          "`pnpm install --frozen-lockfile` in that stage, and anything that imports it " +
          "fails to build (#168).",
      ),
    );
  }

  for (const manifest of extra) {
    failures.push(
      violation(
        DOCKERFILE_RELATIVE_PATH,
        `${manifest} is COPYed in the \`deps\` stage but is not a workspace package per ` +
          "pnpm-workspace.yaml. Remove the stale COPY line, or add the package back to the " +
          "workspace if it was removed by mistake.",
      ),
    );
  }

  finish({
    name: NAME,
    failures,
    ok: `${expected.size} workspace package manifest(s) match the \`deps\` stage COPY list.`,
  });
}

// Only run when invoked directly (`node scripts/ci/check-dockerfile-deps.mjs`, or via the
// `pnpm check:dockerfile-deps` alias, or spawned as a subprocess by test-all.mjs) — never
// as a side effect of a test file importing `extractDepsStage` / `copiedManifests` for unit
// testing against fixture strings.
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await main();
}
