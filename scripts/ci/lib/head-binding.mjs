import { spawnSync } from "node:child_process";
import { ReviewBindingUnavailableError } from "./security-review-note.mjs";

/**
 * `HEAD`'s own SHA and its parent SHAs, in order.
 *
 * For `refs/pull/N/merge` this is `[base tip, pull request head]` — GitHub documents the
 * second parent as the head. Used by `headAgreesWithPayload` to refuse an event payload
 * that names a head the checked-out tree does not agree with (M-1, from the independent
 * delta review of 074aae3).
 *
 * **C-3 — a non-zero `git` exit is NOT the same as "HEAD is not a merge".** The original
 * version conflated the two: both produced an empty parent list, so a shallow clone
 * missing the commit, a corrupted worktree, or `git` failing for any other reason read as
 * "nothing to check" and an unverified payload head was trusted. This fails CLOSED
 * instead, with the SAME typed error every other refusal in this checker uses — thrown,
 * not returned — so the caller COLLECTS it as a reported problem (`finish()`'s output)
 * rather than the process crashing on an unhandled throw with nothing else reported. See
 * `lib/head-binding.test.mjs` for the direct proof: a `cwd` that is not a git repository
 * at all makes `git rev-list` exit non-zero, and this throws rather than returning `[]`.
 *
 * @param {string} cwd
 * @returns {{ sha: string, parents: string[] }}
 */
export function headParents(cwd) {
  const result = spawnSync(
    "git",
    ["rev-list", "--parents", "-n", "1", "HEAD"],
    { cwd, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new ReviewBindingUnavailableError(
      `could not read HEAD's parents (git exited ${result.status}): ` +
        `${(result.stderr ?? "").trim() || "no output"}. A git failure is not evidence ` +
        "that HEAD is not a merge — treating it as one would trust an unverified " +
        "payload head instead of refusing it.",
    );
  }
  // `<commit> <parent>...`
  const [sha, ...parents] = result.stdout.trim().split(/\s+/);
  return { sha, parents };
}

/**
 * Does the pull-request payload's claimed head agree with the checked-out tree?
 *
 * `refs/pull/N/merge` has exactly two parents, base tip first, the pull request's own
 * head second — GitHub's documented shape. So when HEAD is a merge, the claimed head must
 * be its SECOND parent specifically.
 *
 * **C-2 — `parents.includes(prHead)` accepted ANY parent.** On a two-parent merge that is
 * only the base tip or the real head, so it happened to be equivalent in practice — but a
 * three-parent (octopus) `HEAD` naming an unrelated parent, or a payload naming the BASE
 * tip instead of the head, would have passed. Binds to the SECOND parent specifically now.
 * See `lib/head-binding.test.mjs` for a payload naming the base tip: accepted by
 * `parents.includes`, refused here.
 *
 * **C-1 — hardened, though not reachable in this repository's CI.** The default
 * `actions/checkout` on `on: pull_request` always produces a two-parent merge ref, so the
 * non-merge branch below never runs in this repository's pipeline today — the previous
 * version returned early (`parents.length > 1 && ...`) and left a single-parent `HEAD`
 * completely unchecked, trusting whatever the payload claimed. That is EXTERNAL input
 * (the GitHub Actions event JSON), and a checkout-shape change — a different action, a
 * `fetch-depth` change, a local run against a plain branch checkout — must not silently
 * make an unverified payload trusted again just because it is not exercised today. When
 * HEAD is not a merge, the only head worth believing is HEAD itself.
 *
 * @param {string} cwd
 * @param {string} prHead the 40-character SHA the event payload claims is the head
 * @returns {{ agrees: true } | { agrees: false, reason: string }}
 */
export function headAgreesWithPayload(cwd, prHead) {
  const { sha, parents } = headParents(cwd);
  const isMerge = parents.length > 1;
  const boundHead = isMerge ? parents[1] : sha;
  if (boundHead === prHead) {
    return { agrees: true };
  }
  return {
    agrees: false,
    reason: isMerge
      ? `the event payload names ${prHead.slice(0, 9)} as this pull request's head, but ` +
        "the checked-out merge commit's SECOND parent (the documented head parent) is " +
        `${boundHead.slice(0, 9)} (parents: ${parents.map((p) => p.slice(0, 9)).join(", ")}). ` +
        "A payload naming any OTHER parent — the base tip among them — cannot stand in " +
        "for the head either."
      : `the event payload names ${prHead.slice(0, 9)} as this pull request's head, but ` +
        `the checked-out commit is ${boundHead.slice(0, 9)}, which is not a merge.`,
  };
}
