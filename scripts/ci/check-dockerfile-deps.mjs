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
 * reads `COPY <manifest> <dir>/` lines inside it with a fixed grammar. Anything the grammar
 * cannot read (a re-ordered arg, a multi-line COPY, a heredoc) is a HARD FAILURE rather than
 * a silent skip — a `deps` stage this cannot read is not a `deps` stage with nothing in it.
 *
 * The set of workspace package manifests comes from
 * `scripts/ci/lib/workspace-membership.mjs`, the same derivation four other gates already
 * share (see that file's header) — not a second hand-written copy of the workspace list.
 *
 * Usage:
 *   node scripts/ci/check-dockerfile-deps.mjs
 */

import path from "node:path";
import { finish, readText, repoRoot, violation } from "./lib/repo.mjs";
import { readWorkspaceManifests } from "./lib/workspace-membership.mjs";

const NAME = "check:dockerfile-deps";
export const DOCKERFILE_RELATIVE_PATH = "Dockerfile";

const STAGE_START = /^FROM\s+\S+\s+AS\s+deps\s*$/i;
const ANY_STAGE = /^FROM\s+\S+\s+AS\s+\S+\s*$/i;
const COPY_MANIFEST = new RegExp(
  "^COPY\\s+((?:packages|apps)/[^/\\s]+/package\\.json)\\s+" +
    "(?:packages|apps)/[^/\\s]+/\\s*$",
);

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
 * @param {string[]} stageLines
 * @returns {Set<string>}
 */
export function copiedManifests(stageLines) {
  const found = new Set();
  for (const rawLine of stageLines) {
    const match = COPY_MANIFEST.exec(rawLine.trim());
    if (match) found.add(match[1]);
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

  const copied = copiedManifests(stageLines);
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

await main();
