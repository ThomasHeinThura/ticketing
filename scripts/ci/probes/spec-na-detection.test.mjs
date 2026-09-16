/**
 * `check:reviews` must read the `**Spec:**` field's DECLARED STATE, not search it for a
 * bare `n/a` token or a `.md`-shaped substring anywhere in its free text.
 *
 * Found while shepherding PR #144: its `**Spec:**` field honestly explained why the
 * change was not a `docs/03-features/` feature — "n/a — this is UAT-deployability
 * infrastructure (tracked in `status.md` and issue #11)..." — and CI failed anyway,
 * because the old guard was a literal `/^n\/a$/i` exact match that only recognised a
 * Spec field that was the two characters "n/a" and nothing else. `.md` filenames
 * mentioned only as part of the honest EXPLANATION were then picked up by the unrelated,
 * intentionally-broad `.md` extraction regex (broad because a real Spec field points at
 * everything from `docs/03-features/*.md` to a retrofit doc, `rbac.md`, or `ci-cd.md` —
 * see the fix commit for the survey of real merged PRs that ruled out anchoring the
 * regex instead) and treated as a genuine spec declaration with open review findings.
 *
 * This is the exact same defect class F9 already closed once in this file's own
 * history, one field over: a control reading "does this string contain a convenient
 * token" instead of "what does this field actually declare."
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  bodyFile,
  cleanUpScratchRepos,
  commit,
  completeBody,
  evaluateInRepo,
  initRepo,
  installCheckers,
  installFromRepo,
  runChecker,
  scratchDir,
  setOriginMain,
  write,
} from "../lib/scratch-repo.mjs";

after(cleanUpScratchRepos);

/** A review document with one OPEN section, keyed by a backtick-quoted filename — the
 * same shape `docs/07-planning/reviews/2026-09-05/consistency.md`'s real "4d" section
 * uses for `status.md` today. */
function reviewDocWithOpenSection(spec) {
  return [
    "# Consistency review",
    "",
    `### 4d · Counts in \`${spec}\` vs the feature index`,
    "",
    "Still unreconciled: the two documents disagree on how many items are done.",
    "",
  ].join("\n");
}

function scenario() {
  const dir = scratchDir("spec-na");
  initRepo(dir);
  installCheckers(dir);
  installFromRepo(dir, ".github/pull_request_template.md");
  write(
    dir,
    "docs/07-planning/reviews/2026-09-05/consistency.md",
    reviewDocWithOpenSection("status.md"),
  );
  const base = commit(dir, "chore: bootstrap");
  setOriginMain(dir, base);
  return dir;
}

function bodyWithSpec(spec) {
  const base = completeBody({});
  const marker = "**Spec:** n/a — CI infrastructure probe";
  // `String.prototype.replace` does not throw when the search string is not
  // found — it silently returns the input unchanged. A future edit to
  // `completeBody`'s default text would then make every test below run
  // against the UNREPLACED default n/a body instead of the intended
  // scenario, and at least one of them (the "PASSES when n/a" case) would
  // still happen to pass — vacuously, not because the fix works. Asserting
  // the replacement actually happened turns that silent drift into a loud,
  // immediate failure here instead.
  assert.ok(
    base.includes(marker),
    `completeBody()'s default text no longer contains ${JSON.stringify(marker)} — ` +
      "update this probe's replacement target to match",
  );
  return bodyFile(base.replace(marker, `**Spec:** ${spec}`));
}

describe("check:reviews — an honest n/a explanation must not be read as a spec declaration", () => {
  it("PASSES when the Spec field is n/a WITH A REASON that happens to mention a tracked .md file", () => {
    const dir = scenario();
    const result = runChecker(dir, "check-reviews.mjs", [
      "--body",
      bodyWithSpec(
        "n/a — this is UAT-deployability infrastructure (tracked in `status.md` and " +
          "issue #11), not a `docs/03-features/` product feature.",
      ),
    ]);
    assert.equal(
      result.status,
      0,
      `expected an honest n/a explanation to pass, exited ${result.status}:\n${result.output}`,
    );
  });

  it("still FAILS a genuine spec declaration with real open review findings — non-vacuity of the fix", () => {
    // The fix must not have widened "n/a" so far that it stops recognising a real
    // declaration. A Spec field that IS a genuine, non-n/a reference to a doc with an
    // open review section must still be caught.
    const dir = scenario();
    write(
      dir,
      "docs/07-planning/reviews/2026-09-05/consistency.md",
      reviewDocWithOpenSection("workflows.md"),
    );
    commit(dir, "docs: retarget the open section at workflows.md");
    const result = runChecker(dir, "check-reviews.mjs", [
      "--body",
      bodyWithSpec("`docs/03-features/workflows.md`"),
    ]);
    assert.notEqual(
      result.status,
      0,
      `expected a genuine spec with open findings to still fail, exited ${result.status}:\n${result.output}`,
    );
    assert.match(
      result.output,
      /workflows\.md.*still has open review findings/s,
    );
  });

  it("still FAILS a genuine retrofit-doc Spec reference with open findings — the .md regex must stay unanchored", () => {
    // Ruled out anchoring the `.md` extraction to `docs/03-features/` specifically:
    // real merged PRs (#104, #105, #109, #112, #85) reference retrofit docs, and
    // #80/#81 reference architecture/engineering docs, all as legitimate `**Spec:**`
    // values this checker is meant to see. This probe pins that down as a regression
    // test, not just a survey finding.
    const dir = scenario();
    write(
      dir,
      "docs/07-planning/reviews/2026-09-05/consistency.md",
      reviewDocWithOpenSection("organization-plugin-retrofit.md"),
    );
    commit(dir, "docs: retarget the open section at the retrofit doc");
    const result = runChecker(dir, "check-reviews.mjs", [
      "--body",
      bodyWithSpec(
        "`docs/07-planning/retrofits/organization-plugin-retrofit.md` (S6a row)",
      ),
    ]);
    assert.notEqual(
      result.status,
      0,
      `expected a genuine retrofit-doc reference with open findings to still fail, exited ${result.status}:\n${result.output}`,
    );
  });

  it("still FAILS a genuine spec whose OWN filename happens to start with 'n/a' or 'blocked' — found adversarially by review of this fix", () => {
    // Two of the three independent Sonnet reviews of this fix found the same
    // regression: `effectivelyNotApplicable`'s opener regexes end in a bare
    // `\b`, and any non-word character satisfies it, so a genuine filename
    // like `n/a-workflows.md` or `blocked-transitions.md` satisfies that
    // boundary immediately after the first word, even though neither string
    // is declaring a state at all — silently exempting a real spec with
    // real open findings from ever being checked. The OLD exact-match guard
    // did NOT have this specific hole (neither string is literally "n/a"),
    // so this would have been a genuine regression, not a pre-existing gap.
    //
    // `blocked.md` (a PERIOD, not a hyphen) was found by a third review
    // round after the hyphen-specific fix landed, and then an allow-list
    // fix for THAT was itself found (by two more reviewers) to reject
    // ordinary sentence punctuation and reopen the false-positive bug, and
    // THEN a scan-forward fix for THAT was found (by yet another reviewer)
    // to misread a real separator used with no surrounding space at all as
    // fusion too — see the two tests below this one. Enumerating "which
    // characters are safe to glue onto the opener", in any direction or
    // shape, kept recurring. `fieldOpener()` now asks a different question
    // entirely: does the opener's own matched span OVERLAP a real `.md`
    // token found by the same extraction regex `main()` uses? No character
    // adjacency of any kind is examined.
    for (const [spec, label] of [
      // The `.md` extraction regex's character class excludes "/", so
      // "n/a-workflows.md" itself extracts as "a-workflows.md" — the
      // review doc's heading must key on what the regex ACTUALLY extracts,
      // not the raw Spec field text, or this probe tests the wrong thing.
      ["n/a-workflows.md", "a-workflows.md"],
      ["`blocked-transitions.md`", "blocked-transitions.md"],
      ["blocked.md", "blocked.md"],
    ]) {
      const dir = scenario();
      write(
        dir,
        "docs/07-planning/reviews/2026-09-05/consistency.md",
        reviewDocWithOpenSection(label),
      );
      commit(dir, `docs: retarget the open section at ${label}`);
      const result = runChecker(dir, "check-reviews.mjs", [
        "--body",
        bodyWithSpec(spec),
      ]);
      assert.notEqual(
        result.status,
        0,
        `expected "${spec}" (a genuine filename, not a declaration) with open findings to still fail, exited ${result.status}:\n${result.output}`,
      );
    }
  });

  it("still PASSES an honest n/a explanation glued to ORDINARY SENTENCE PUNCTUATION — found adversarially by review of the round-3 allow-list fix", () => {
    // Two of three independent reviewers of round 3's allow-list fix found the SAME
    // regression, from the opposite direction of round 2's: the allow-list
    // (`COMPACT_FIELD_SEPARATOR = /[\s:,—–]/`) only accepted whitespace/colon/comma/dash
    // immediately after the opener — so a period, semicolon, exclamation mark, closing
    // paren, or bold-markdown `**` (all ordinary ways a human writes a sentence) made the
    // guard treat an HONEST n/a explanation as a genuine spec declaration, reopening the
    // exact original PR #144 bug via different punctuation. This is why round 4 replaced
    // the whole allow-list/deny-list approach with a "does it hit whitespace before a
    // letter/digit" scan instead of enumerating characters at all.
    for (const glue of [
      "n/a. This is UAT-deployability infrastructure (tracked in `status.md` and issue #11), not a `docs/03-features/` product feature.",
      "n/a; this is CI infrastructure work, tracked in `status.md` and issue #11, not a feature.",
      "n/a! this only touches CI scripts (see status.md for tracking), no product feature here.",
      "n/a) this note refers to status.md in passing, not a real spec.",
      "**n/a** — this is UAT-deployability infrastructure, tracked in `status.md`, not a feature.",
    ]) {
      const dir = scenario();
      const result = runChecker(dir, "check-reviews.mjs", [
        "--body",
        bodyWithSpec(glue),
      ]);
      assert.equal(
        result.status,
        0,
        `expected the honest n/a explanation ${JSON.stringify(glue.slice(0, 40))}... to pass, exited ${result.status}:\n${result.output}`,
      );
    }
  });

  it("still FAILS a terse 'blocked: <filename>' declaration, regardless of how much explanation follows — found adversarially by a third review round", () => {
    // A third reviewer found that `effectivelyNotApplicable`'s BLOCKED_EXPLANATION_MINIMUM
    // (built for whole-SECTION prose, where a bare one-word "BLOCKED" with no real
    // explanation is treated as an unsubstantiated exemption) was being reused unmodified
    // at the FIELD level — where the whole point is often to be terse. "blocked:
    // workflows.md" is short enough to read as "blocked-bare" and silently exempted a real,
    // named spec, while a more VERBOSE phrasing of the identical claim was correctly
    // checked: naming the spec more precisely and tersely was what triggered the bypass.
    //
    // Fixed by no longer delegating to that length heuristic for "blocked" at the field
    // level at all: once a real `.md` filename is named, it is always checked, regardless
    // of how much surrounding explanation there is. ("n/a" keeps its own unconditional
    // exemption — it asserts "there is no spec", true no matter what else is mentioned;
    // "blocked" never carried that assertion.)
    for (const spec of [
      "blocked: workflows.md",
      "blocked: waiting on design approval before continuing with workflows.md",
      "BLOCKED. Waiting on infra described in workflows.md before this can proceed at all here.",
    ]) {
      const dir = scenario();
      write(
        dir,
        "docs/07-planning/reviews/2026-09-05/consistency.md",
        reviewDocWithOpenSection("workflows.md"),
      );
      commit(dir, "docs: retarget the open section at workflows.md");
      const result = runChecker(dir, "check-reviews.mjs", [
        "--body",
        bodyWithSpec(spec),
      ]);
      assert.notEqual(
        result.status,
        0,
        `expected ${JSON.stringify(spec)} to still fail (a real spec is named, "blocked" ` +
          `never exempts it), exited ${result.status}:\n${result.output}`,
      );
    }
  });

  it("checks EVERY `.md` mention in the Spec field, not just the first — found adversarially by a third review round", () => {
    // The extraction regex was non-global and `main()` only ever added its first match, so
    // a Spec field naming a decoy/context document before the real spec let the real one's
    // open findings go completely unchecked.
    const dir = scenario();
    write(
      dir,
      "docs/07-planning/reviews/2026-09-05/consistency.md",
      reviewDocWithOpenSection("workflows.md"),
    );
    commit(dir, "docs: retarget the open section at workflows.md");
    const result = runChecker(dir, "check-reviews.mjs", [
      "--body",
      bodyWithSpec(
        "`docs/07-planning/decision-log.md` (see also `docs/03-features/workflows.md`)",
      ),
    ]);
    assert.notEqual(
      result.status,
      0,
      `expected the second-mentioned "workflows.md" to still be checked, exited ${result.status}:\n${result.output}`,
    );
    assert.match(
      result.output,
      /workflows\.md.*still has open review findings/s,
    );
  });

  it("still PASSES an honest n/a explanation glued with NO SPACE AT ALL around the punctuation — found adversarially by a fourth review round", () => {
    // Round 4's scan-forward test ("does whitespace or a letter/digit come first after
    // the opener?") could not tell a real separator used with no surrounding space at all
    // (an em dash typeset directly against both words, a common style: "word—word") from a
    // hyphen that is genuinely part of a filename ("n/a-workflows.md") — both look
    // identical to that scan: non-alphanumeric, then immediately a letter. A reviewer of
    // round 4 found this reopens the original false-positive bug via unspaced punctuation
    // instead of the punctuation characters earlier rounds already covered.
    //
    // Fixed by abandoning the character-adjacency scan entirely: `fieldOpener` now checks
    // whether the opener's own matched span OVERLAPS a real `.md` token found by the same
    // extraction regex `main()` uses. "n/a—this is..." extracts no `.md` token anywhere
    // near the opener at all (the eventual `status.md` mention is far away in the string),
    // so there is nothing to overlap — genuinely standalone, regardless of spacing.
    for (const glue of [
      "n/a—this is UAT-deployability infrastructure, tracked in status.md, not a feature.",
      "n/a-this is UAT-deployability infrastructure, tracked in status.md, not a feature.",
      "**n/a**—this is UAT-deployability infrastructure, tracked in status.md, not a feature.",
      "n/a.this is UAT-deployability infrastructure, tracked in status.md, not a feature.",
      "n/a;this is CI infrastructure work, tracked in status.md, not a feature.",
    ]) {
      const dir = scenario();
      const result = runChecker(dir, "check-reviews.mjs", [
        "--body",
        bodyWithSpec(glue),
      ]);
      assert.equal(
        result.status,
        0,
        `expected the honest, unspaced n/a explanation ${JSON.stringify(glue.slice(0, 40))}... to pass, exited ${result.status}:\n${result.output}`,
      );
    }
  });

  it("DOCUMENTED LIMITATION: an 'n/a' opener still exempts a second, real spec named later in the same field", () => {
    // Found adversarially by a fourth review round: a compound sentence that opens with
    // "n/a" for one part of a PR but goes on to explicitly name a second, real,
    // separately-applicable spec in the same field is still fully exempted — the second
    // mention is never checked.
    //
    // This is a DELIBERATE, DOCUMENTED trade-off, not something this fix closes: making
    // "n/a" behave like "blocked" (never exempting once a `.md` is named) would close it,
    // but would also reopen the original PR #144 bug, since an honest "n/a — reason
    // (tracked in `status.md`...)" explanation is structurally the same shape as this
    // compound case, and there is no mechanical way to tell "an incidental supporting
    // reference" from "a second, real, applicable spec" without actually understanding the
    // sentence. The PR template documents `**Spec:**` as a single value; a PR with a
    // genuine second applicable spec should name it directly rather than bury it after an
    // "n/a" opener. This test pins down the ACTUAL (accepted) behavior so a future change
    // that alters it does so knowingly, not by accident.
    const dir = scenario();
    write(
      dir,
      "docs/07-planning/reviews/2026-09-05/consistency.md",
      reviewDocWithOpenSection("workflows.md"),
    );
    commit(dir, "docs: retarget the open section at workflows.md");
    const result = runChecker(dir, "check-reviews.mjs", [
      "--body",
      bodyWithSpec(
        "n/a for the backend, but see `docs/03-features/workflows.md` for the frontend " +
          "piece, which is NOT covered by this n/a and has real open review findings.",
      ),
    ]);
    assert.equal(
      result.status,
      0,
      `expected the compound "n/a ... but see workflows.md" field to be exempted as a ` +
        `whole (the accepted trade-off), exited ${result.status}:\n${result.output}`,
    );
  });

  it("non-vacuity: the OLD exact-match guard really did misread the honest n/a explanation as a declaration", () => {
    const dir = scenario();
    const declared =
      "n/a — this is UAT-deployability infrastructure (tracked in `status.md` and " +
      "issue #11), not a `docs/03-features/` product feature.";
    const old = evaluateInRepo(
      dir,
      `const declared = ${JSON.stringify(declared)};
       const named = /([a-z0-9-]+\\.md)/.exec(declared);
       console.log(JSON.stringify({
         oldGuardTreatedAsDeclared: Boolean(named) && !/^n\\/a$/i.test(declared.trim()),
       }));`,
    );
    assert.equal(
      old.oldGuardTreatedAsDeclared,
      true,
      "the probe is vacuous: the pre-fix exact-match guard would already have rejected " +
        "this input, so the fix could not be observed to change anything",
    );
  });
});
