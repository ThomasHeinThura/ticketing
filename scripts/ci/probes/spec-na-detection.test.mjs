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
    // `\b`, and a hyphen is a non-word character, so a genuine filename like
    // `n/a-workflows.md` or `blocked-transitions.md` satisfies that boundary
    // immediately after the first word, even though neither string is
    // declaring a state at all — silently exempting a real spec with real
    // open findings from ever being checked. The OLD exact-match guard did
    // NOT have this specific hole (neither string is literally "n/a"), so
    // this would have been a genuine regression, not a pre-existing gap.
    for (const [spec, label] of [
      // The `.md` extraction regex's character class excludes "/", so
      // "n/a-workflows.md" itself extracts as "a-workflows.md" — the
      // review doc's heading must key on what the regex ACTUALLY extracts,
      // not the raw Spec field text, or this probe tests the wrong thing.
      ["n/a-workflows.md", "a-workflows.md"],
      ["`blocked-transitions.md`", "blocked-transitions.md"],
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
