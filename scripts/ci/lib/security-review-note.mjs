/**
 * Bind a committed security-review note to the code it actually reviewed.
 *
 * **GPT-F2 — the note was not bound to the reviewed code.** The PR-template check
 * verified two things about `## Security review`: that **Model:** matched `^Opus`, and
 * that the linked `docs/07-planning/security-reviews/<pr>-<slug>.md` existed in the
 * branch. Both are properties of the pull-request body and of a filename. Neither says
 * anything about *which code* was reviewed, so once a note existed it stayed valid
 * forever:
 *
 *   H1  code            reviewed, CLEAR
 *   H2  the note        committed from that review          -> gate green, correctly
 *   H3  more code       pushed                              -> gate STILL green
 *
 * At H3 the note is a stale artefact: the reviewer never saw H3's code, and nothing in
 * the repository or the body said so. That is the failure mode CLAUDE.md's third absolute
 * names — "a review recorded at the wrong tier is worse than no review, because it closes
 * the field that would otherwise stay visibly open" — with "wrong tier" replaced by
 * "wrong code".
 *
 * ## What is enforced
 *
 * The note declares the head it reviewed, in a machine-readable field:
 *
 *   **Reviewed head:** `6b32ef316c49cc14cc841b32fdcce637a442b813`
 *
 * Full forty-character SHAs, one field per reviewed head, as many as the review chain
 * has. Prose SHAs elsewhere in the note are documentation and are deliberately NOT
 * parsed — the notes on file cite merge bases and post-rebase orphans in the same
 * sentence as reviewed heads, and a checker that guessed between them would be
 * enforcing a coin flip.
 *
 * Four rules, all mechanical:
 *
 * 1. **At least one attested head.** No field, no binding, no pass.
 * 2. **At least one attested head is an ancestor of HEAD.** A note whose heads are all
 *    orphaned (a rebase) or on another branch reviewed code this branch does not
 *    contain.
 * 3. **Every commit that LANDED after the newest attested ancestor must be
 *    review-artefact-only.** Not the net tree between the two — every commit in
 *    `<newest>..HEAD`, each judged on the paths it contributed, all of which must sit
 *    under `docs/07-planning/security-reviews/`. This is exactly the agreed model: H1 is
 *    reviewed, the note-only H2 records it and passes, and any H3 that touches anything
 *    else is stale until a fresh delta review adds `**Reviewed head:** <H3>`. Because the
 *    rule is stated over the *newest* attested ancestor, the H1/H2 artefacts cannot be
 *    kept to cover an H3 — H3 is in the range and fails.
 *
 *    **GPT-F5: it was a net-tree comparison, and that was a bypass.**
 *    `git diff <newest>..HEAD` sees only the endpoints, so H3 plus an exact revert of H3
 *    at H4 cancelled out, the range read as empty, and the old review passed with two
 *    unreviewed commits landed. Reverting does not restore clearance — the reverted diff
 *    is still in the history a bisect replays, and a revert can itself be wrong.
 * 4. **A head may not attest itself.** Rule 3 alone would be satisfied by a commit that
 *    carried the code AND `**Reviewed head:** <that same commit>`, because the delta to
 *    HEAD would then be empty. Stated honestly: with full forty-character SHAs that
 *    commit is a hash fixed point and is not constructible, so this is defence in depth
 *    rather than a reproduced bypass — it is here because it costs one `git show`, and
 *    because the day someone relaxes the parser to accept a short SHA, a tag or a branch
 *    name, it becomes reachable. It is probed against an injected reader
 *    (`readNoteAt`), not against a git scenario that cannot be built.
 *
 * ## What this does not prove
 *
 * It does not prove a review took place, and it is not offered as proof — a determined
 * author can type a SHA into the note. What it proves is that the artefact names a
 * commit, that the commit is in this branch, and that nothing but review artefacts has
 * landed since. That is the difference between a stale note and a current one, and it
 * makes recording a new head a durable, dated, reviewable act instead of something that
 * happens by default.
 */

import {
  BaselineHistoryUnavailableError,
  commitDepth,
  commitsBetween,
  isAncestor,
  readTextAtCommit,
  resolveCommit,
} from "./git-baseline.mjs";

/** Where review artefacts live. Nothing else may change after the attested head. */
export const REVIEW_ARTEFACT_PREFIX = "docs/07-planning/security-reviews/";

/** `**Reviewed head:** \`<40 hex>\`` — the only field this parser trusts. */
const ATTESTATION = /^[ \t]*\*\*Reviewed heads?:\*\*[ \t]*(.+?)[ \t]*$/gim;

export class ReviewBindingUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReviewBindingUnavailableError";
  }
}

/**
 * Full SHAs declared by `**Reviewed head(s):**` fields, in document order, deduplicated.
 *
 * @param {string} source note contents
 * @returns {string[]}
 */
export function attestedHeads(source) {
  const found = [];
  ATTESTATION.lastIndex = 0;
  for (
    let match = ATTESTATION.exec(source);
    match !== null;
    match = ATTESTATION.exec(source)
  ) {
    for (const sha of match[1].matchAll(/`([0-9a-f]{40})`/g)) {
      if (!found.includes(sha[1])) found.push(sha[1]);
    }
  }
  return found;
}

/**
 * Does the note at `sha` already contain `**Reviewed head:** <sha>`?
 *
 * Rule 4. `null` when the note did not exist there at all, which is the ordinary case
 * and the safe one.
 *
 * @returns {boolean}
 */
function attestsItself(sha, notePath, readNoteAt) {
  const atCommit = readNoteAt(sha, notePath);
  if (atCommit === null) return false;
  return attestedHeads(atCommit).includes(sha);
}

/**
 * @typedef {object} ReviewBinding
 * @property {"bound"|"unbound"} kind
 * @property {string} [head] the newest valid attested ancestor
 * @property {string[]} [drifted] non-artefact paths contributed since `head`
 * @property {string[]} [offending] the landed commits that contributed them
 * @property {string} [reason] why the note is not bound, when it is not
 * @property {string[]} attested every SHA the note declares
 * @property {string[]} selfAttested declared SHAs rejected by rule 4
 */

/**
 * Is the committed note bound to the code at `head`?
 *
 * @param {object} input
 * @param {string} input.notePath repo-relative path to the committed note
 * @param {string} input.noteSource the note's contents in the working tree
 * @param {string} [input.head] the revision to bind to; defaults to `HEAD`
 * @param {(sha: string, notePath: string) => string|null} [input.readNoteAt] the note's
 *   contents at a commit. Injectable only so rule 4 can be probed against an input the
 *   git plumbing cannot produce; the default is git.
 * @returns {ReviewBinding}
 */
export function reviewBinding({
  notePath,
  noteSource,
  head = "HEAD",
  readNoteAt = readTextAtCommit,
}) {
  const attested = attestedHeads(noteSource);

  if (attested.length === 0) {
    return {
      kind: "unbound",
      attested,
      selfAttested: [],
      reason:
        `${notePath} declares no reviewed head. Add one line per head the review ` +
        "actually read, with the FULL forty-character SHA:\n" +
        "        **Reviewed head:** `<40-character sha>`\n" +
        "      Without it the note is an artefact with no code attached to it, and it " +
        "would keep passing this gate after every later push (GPT-F2). SHAs written in " +
        "prose are not parsed on purpose — the notes on file cite merge bases and " +
        "post-rebase orphans in the same breath as reviewed heads.",
    };
  }

  const resolvedHead = resolveCommit(head);
  if (resolvedHead === null) {
    throw new ReviewBindingUnavailableError(
      `cannot resolve \`${head}\` to a commit, so the committed review note cannot be ` +
        "bound to the code it reviewed. This is a checkout problem, not a clean tree.",
    );
  }

  const ancestors = [];
  const notAncestors = [];
  const selfAttested = [];
  for (const sha of attested) {
    if (resolveCommit(sha) === null) {
      notAncestors.push(`${sha} (not an object in this repository)`);
      continue;
    }
    if (!isAncestor(sha, resolvedHead)) {
      notAncestors.push(
        `${sha} (not an ancestor of ${resolvedHead.slice(0, 9)})`,
      );
      continue;
    }
    if (attestsItself(sha, notePath, readNoteAt)) {
      selfAttested.push(sha);
      continue;
    }
    ancestors.push(sha);
  }

  if (ancestors.length === 0) {
    const detail = [
      ...selfAttested.map((sha) => `${sha} (self-attested)`),
      ...notAncestors,
    ];
    return {
      kind: "unbound",
      attested,
      selfAttested,
      reason:
        `${notePath} declares ${attested.length} reviewed head(s), and none of them is ` +
        "usable:\n        " +
        detail.join("\n        ") +
        "\n      A head is usable when it is an ancestor of this branch's HEAD AND the " +
        "note at that commit did not already declare it. A self-attested head is the " +
        "one-commit bypass: land the code and the sentence saying it was reviewed " +
        "together, and the delta to HEAD is empty. A non-ancestor head is code this " +
        "branch does not contain — an orphan left by a rebase, or another branch " +
        "entirely. Neither is a review of what is about to merge.",
    };
  }

  let newest = ancestors[0];
  let newestDepth = commitDepth(newest);
  for (const sha of ancestors.slice(1)) {
    const depth = commitDepth(sha);
    if (depth > newestDepth) {
      newest = sha;
      newestDepth = depth;
    }
  }

  // GPT-F5: LANDED COMMITS, not the net tree. `changedPathsBetween(newest, HEAD)` compared
  // two endpoints, so a commit and a later exact revert of it cancelled out and the range
  // read as empty — a four-commit bypass past a rule that is stated over history. See
  // lib/git-baseline.mjs § commitsBetween for the attribution, merges included.
  const offending = commitsBetween(newest, resolvedHead)
    .map((commit) => ({
      ...commit,
      outside: commit.paths.filter(
        (file) => !file.startsWith(REVIEW_ARTEFACT_PREFIX),
      ),
    }))
    .filter((commit) => commit.outside.length > 0);

  if (offending.length > 0) {
    const drifted = [
      ...new Set(offending.flatMap((commit) => commit.outside)),
    ].sort();
    const detail = offending
      .slice(0, 10)
      .map(
        (commit) =>
          `${commit.sha.slice(0, 9)}${commit.parents.length > 1 ? " (merge)" : ""} — ` +
          `${commit.outside.slice(0, 6).join(", ")}` +
          (commit.outside.length > 6
            ? `, …${commit.outside.length - 6} more`
            : ""),
      )
      .join("\n        ");

    return {
      kind: "unbound",
      attested,
      selfAttested,
      head: newest,
      drifted,
      offending: offending.map((commit) => commit.sha),
      reason:
        `${notePath} is STALE. Its newest usable reviewed head is ${newest.slice(0, 9)}, ` +
        `and ${offending.length} commit(s) that LANDED after it touched paths outside ` +
        `${REVIEW_ARTEFACT_PREFIX}:\n        ${detail}` +
        (offending.length > 10
          ? `\n        …and ${offending.length - 10} more commit(s)`
          : "") +
        "\n      The reviewer never read this code. A note-only commit after a reviewed " +
        "head is fine and is the intended shape — reviewed head, then the note that " +
        "records it. Anything else needs a fresh delta review of " +
        `${newest.slice(0, 9)}..${resolvedHead.slice(0, 9)}, and that review adds its own ` +
        "**Reviewed head:** line for the new head. Keeping the old lines and pushing " +
        "code is what this check exists to refuse.\n      Judged over LANDED COMMITS, " +
        "not the net tree (GPT-F5): reverting a commit does NOT restore the clearance. " +
        "The reverted diff is still in this branch's history, it is what a bisect " +
        "replays, and a revert can itself be wrong — so a reviewer has to see both. If " +
        "the revert is the right answer, it is still a fresh delta review.",
    };
  }

  return {
    kind: "bound",
    head: newest,
    attested,
    selfAttested,
    drifted: [],
    offending: [],
  };
}

export { BaselineHistoryUnavailableError };
