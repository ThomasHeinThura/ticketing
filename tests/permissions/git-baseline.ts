import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Baseline monotonicity — the other half of the anti-v1 control.
 *
 * `inherited-uncovered.json` and `better-auth-plugins-pending-removal.json` are declared
 * **shrinking** lists (see `README.md`), but a list only shrinks if something outside the file
 * itself remembers what it used to contain. Comparing the file against itself — which is all
 * `route-coverage.test.ts` did before this module existed — proves nothing: a PR that adds a
 * route with no policy and appends the route's key to the baseline in the same diff changes
 * both sides of that comparison together, and the gate stays green. The only thing that can
 * catch that is comparing the file's current, working-tree content against its content at a
 * point in git history the current change cannot rewrite: the merge base with `main`.
 *
 * The exact commands, all run with `cwd` set to the repository root:
 *
 *   git rev-parse --verify --quiet <ref>^{commit}   — does this candidate ref resolve at all?
 *   git merge-base HEAD <ref>                        — the commit this branch forked from
 *   git cat-file -e <mergeBaseSha>:<path>            — did the path exist there at all?
 *   git show <mergeBaseSha>:<path>                   — its content, if it did
 *
 * Candidate refs are tried in order: `origin/main`, then `main`. A CI checkout normally has
 * `origin/main` available (either fetched explicitly, or present because history was not
 * truncated to a single ref); a local clone usually carries a local `main` branch even when
 * `origin/main` is stale, unfetched, or there is no `origin` remote at all.
 *
 * Two outcomes both mean "nothing to compare against", and both are `null`, not a failure:
 *
 * - **On `main` itself**, `git merge-base HEAD main` resolves to HEAD's own commit — there is
 *   no other history to diff against, so the "previous" content is read at HEAD and is always
 *   identical to the working file. No drift is ever reported, correctly: main has nothing to
 *   have grown relative to but itself.
 * - **Bootstrap**: the path did not exist yet at the merge base (this is the branch that
 *   introduces the file — issue #7, today). There is no previous baseline to have grown from.
 *   The check goes live for the first time on whatever PR's merge base is the commit this one
 *   lands on `main` as.
 *
 * A merge base that cannot be resolved **at all** — neither candidate ref exists, which is
 * exactly what a shallow, single-branch checkout produces (`actions/checkout`'s default
 * `fetch-depth: 1` against a single ref creates no local `main` and no `origin/main`, proven
 * in `git-baseline.test.ts` with a real `git clone --single-branch --depth 1`) — is not a
 * third "assume it is fine" outcome. `resolveMergeBase` returns `{ kind: "unresolved" }` and
 * `readJsonAtMergeBase` throws. A build that cannot prove a baseline did not grow must not
 * silently report that it did not; the checkout needs `fetch-depth: 0`, or an explicit `git
 * fetch origin main`, for this check to run at all — in either place, locally or in CI.
 */

const CANDIDATE_BASE_REFS = ["origin/main", "main"] as const;

/** The repository root, computed from this file's own location — no shell-out required. */
export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

function git(args: readonly string[], cwd: string) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function refExists(ref: string, cwd: string): boolean {
  return (
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd).status ===
    0
  );
}

export type MergeBaseResolution =
  | { readonly kind: "resolved"; readonly ref: string; readonly sha: string }
  | { readonly kind: "unresolved"; readonly triedRefs: readonly string[] };

/**
 * Resolves the merge base with the first candidate ref that exists at all. Exported directly
 * so its own behaviour — including the "unresolved" case — has dedicated tests; production
 * callers go through `readJsonAtMergeBase`.
 */
export function resolveMergeBase(
  cwd: string,
  candidateRefs: readonly string[] = CANDIDATE_BASE_REFS,
): MergeBaseResolution {
  for (const ref of candidateRefs) {
    if (!refExists(ref, cwd)) continue;
    const result = git(["merge-base", "HEAD", ref], cwd);
    const sha = result.stdout.trim();
    if (result.status === 0 && sha.length > 0) {
      return { kind: "resolved", ref, sha };
    }
  }
  return { kind: "unresolved", triedRefs: [...candidateRefs] };
}

function pathExistsAtCommit(
  cwd: string,
  commit: string,
  relPath: string,
): boolean {
  return git(["cat-file", "-e", `${commit}:${relPath}`], cwd).status === 0;
}

/**
 * The file's parsed JSON content at the merge base with main, or `null` for either of the two
 * legitimate "nothing to compare against" cases documented above. Throws when no merge base
 * can be resolved at all — see the module doc comment.
 */
export function readJsonAtMergeBase(
  cwd: string,
  relPath: string,
  candidateRefs: readonly string[] = CANDIDATE_BASE_REFS,
): unknown | null {
  const resolution = resolveMergeBase(cwd, candidateRefs);
  if (resolution.kind === "unresolved") {
    throw new Error(
      "route-coverage baseline monotonicity: could not resolve a merge base with any of " +
        `${resolution.triedRefs.join(", ")} (cwd: ${cwd}). The checkout needs full history ` +
        "(fetch-depth: 0) or a fetched main/origin/main ref — refusing to treat " +
        '"the previous baseline is unknown" as "the baseline did not grow".',
    );
  }
  if (!pathExistsAtCommit(cwd, resolution.sha, relPath)) return null;
  const shown = git(["show", `${resolution.sha}:${relPath}`], cwd);
  if (shown.status !== 0) {
    throw new Error(
      `git show ${resolution.sha}:${relPath} failed even though the path exists there: ${shown.stderr}`,
    );
  }
  return JSON.parse(shown.stdout);
}

export type BaselineDrift = {
  /** Present now, absent at the merge base — a baseline that grew. Any entry here fails. */
  readonly added: readonly string[];
  /** Present at the merge base, absent now — a baseline that legitimately shrank. Fine. */
  readonly removed: readonly string[];
};

/**
 * Pure set difference between a baseline's previous, committed entries and its current ones.
 * No git, no I/O — independently testable, and reused for both `inherited-uncovered.json`'s
 * `uncovered` list and `better-auth-plugins-pending-removal.json`'s `pendingRemoval` list.
 */
export function diffBaselineEntries(
  previous: readonly string[],
  current: readonly string[],
): BaselineDrift {
  const previousSet = new Set(previous);
  const currentSet = new Set(current);
  return {
    added: [...currentSet].filter((entry) => !previousSet.has(entry)).sort(),
    removed: [...previousSet].filter((entry) => !currentSet.has(entry)).sort(),
  };
}
