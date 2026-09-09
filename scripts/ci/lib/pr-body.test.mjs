/**
 * Unit tests for the pull-request body parser.
 *
 * These exist because `stripComments` was a security fix, not a refactor: CodeQL
 * alert #4 (`js/incomplete-multi-character-sanitization`, HIGH) on the regex it
 * replaced. A sanitiser without a regression test is one careless edit away from
 * the same hole, so the invariant is asserted directly rather than implied.
 *
 * Run: `pnpm test:ci-scripts`, or `node --test scripts/ci/lib/`.
 * No test dependency — node:test ships with the runtime the gates already use.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { describe, it } from "node:test";
import {
  checklistPresenceProblems,
  checklistProblems,
  contentOf,
  declaredState,
  effectivelyNotApplicable,
  field,
  isBlank,
  markedNotApplicable,
  meaningfulLines,
  normaliseHeading,
  resetStripCommentsStepsForTests,
  sections,
  stripComments,
  stripCommentsStepsForTests,
} from "./pr-body.mjs";

/**
 * What the REMOVED expression produced, recorded as data rather than as code.
 *
 * The obvious way to write these tests is to keep the deleted regex here as a live
 * oracle and diff against it. That was the first attempt, and CodeQL correctly raised
 * `js/incomplete-multi-character-sanitization` a second time — on this file — because
 * the vulnerable pattern was still in the repository, one copy-paste away from being
 * reused by someone who did not read why it was here.
 *
 * The alert was NOT suppressed and the regex was NOT rewritten to hide from the
 * scanner. It is simply gone: the outputs it produced are recorded below as literals,
 * measured before deletion, which is all the contrast the tests actually needed.
 */
const OLD_REGEX_OUTPUT = {
  "<!<!-- -->--": "<!--",
  "<!<!--x-->-- hidden from a reviewer": "<!-- hidden from a reviewer",
  "<!--<!-- -->-->": "-->",
  "abc<!-- unterminated": "abc<!-- unterminated",
};

/**
 * An independent, obviously-correct reference implementation of comment
 * stripping — test-only, used ONLY as the differential oracle in HIGH 1c
 * below (2026-09-09, review 2). Deliberately structured nothing like
 * `stripComments`: no output array, no forward-only cursor, no step counter.
 * It repeatedly finds the FIRST "<!--" / "-->" pair, deletes it, and — this
 * is the part the buggy fixed-point loop gets wrong — re-scans the
 * CONCATENATION of what came before and what came after from the very start,
 * rather than resuming a single left-to-right regex pass over the ORIGINAL
 * string. That re-scan is exactly what one call to `String.prototype.replace`
 * (or `.replaceAll`, or `RE[Symbol.replace]`, or any other spelling of the
 * same one-pass sweep) cannot do: `replace` finds all non-overlapping matches
 * in a single left-to-right pass over the input as it was BEFORE any
 * deletion, so it never notices a "<!--" freshly assembled from a leftover
 * "<!" and a leftover "--" that used to be separated by the comment it just
 * deleted. Starting over on the concatenation does notice it, because the
 * next iteration's `indexOf` sees the joined string, not the original one.
 *
 * Quadratic, and does not pretend otherwise — it exists to be correct on the
 * modest inputs a fuzz loop generates, not fast on production-sized ones.
 * `stripComments` (the module under test) is what has to be fast; this is
 * only ever compared against it, never shipped.
 */
function referenceStripComments(input) {
  let text = input;
  // Each iteration removes one "<!--"..."-->" pair or returns, so it cannot
  // loop more than `input.length` times for a well-formed run. The bound
  // exists only so a reasoning error here fails loudly instead of hanging
  // the suite — see the two tests below for the same idea applied to their
  // own fuzz generators ("if this reaches zero the fuzz has stopped...").
  for (let guard = 0; guard < input.length + 1; guard += 1) {
    const openIdx = text.indexOf("<!--");
    if (openIdx === -1) return text;
    const before = text.slice(0, openIdx);
    const rest = text.slice(openIdx + 4);
    const closeIdx = rest.indexOf("-->");
    if (closeIdx === -1) return before; // fails closed, same as stripComments
    text = before + rest.slice(closeIdx + 3);
  }
  throw new Error(
    "referenceStripComments did not converge — the fuzz input defeats this oracle's own reasoning",
  );
}

describe("stripComments", () => {
  it("removes ordinary comments", () => {
    assert.equal(stripComments("abc<!-- x -->def"), "abcdef");
    assert.equal(stripComments("<!-- a --><!-- b -->keep"), "keep");
    assert.equal(stripComments("no comments here"), "no comments here");
    assert.equal(stripComments(""), "");
  });

  it("does not reconstitute an opener — the defect CodeQL named", () => {
    // The "<!" before the comment and the "--" after it are separated by the
    // match, so a single-pass removal joins them into a fresh "<!--".
    // The old regex turned each of these back INTO a comment opener.
    assert.equal(OLD_REGEX_OUTPUT["<!<!-- -->--"], "<!--");
    assert.equal(stripComments("<!<!-- -->--"), "");

    assert.equal(
      OLD_REGEX_OUTPUT["<!<!--x-->-- hidden from a reviewer"],
      "<!-- hidden from a reviewer",
    );
    assert.equal(stripComments("<!<!--x-->-- hidden from a reviewer"), "");
  });

  it("treats a stray closer as text, exactly as the regex did", () => {
    // "-->" is not an opener, so leaving it is correct and matches the old
    // behaviour. Only the opener is a sanitisation concern.
    assert.equal(stripComments("<!--<!-- -->-->"), "-->");
    assert.equal(OLD_REGEX_OUTPUT["<!--<!-- -->-->"], "-->");
  });

  it("fails closed on an unterminated comment", () => {
    // Deliberate divergence from the regex, in the safe direction: content
    // hidden behind an unclosed "<!--" renders invisible on GitHub, so it must
    // not count towards a section looking filled in.
    assert.equal(stripComments("abc<!-- unterminated"), "abc");
    assert.equal(
      OLD_REGEX_OUTPUT["abc<!-- unterminated"],
      "abc<!-- unterminated",
    );
  });

  it("leaves no opener behind, over a fuzz of hostile inputs", () => {
    const alphabet = ["<", "!", "-", ">", " ", "a", "\n"];
    let seed = 12345;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    let sawTheDangerousShape = 0;
    for (let n = 0; n < 200_000; n += 1) {
      const length = 1 + Math.floor(next() * 18);
      let input = "";
      for (let k = 0; k < length; k += 1) {
        input += alphabet[Math.floor(next() * alphabet.length)];
      }

      const stripped = stripComments(input);
      assert.ok(
        !stripped.includes("<!--"),
        `opener survived for ${JSON.stringify(input)} -> ${JSON.stringify(stripped)}`,
      );
      // Stripping again must change nothing; a sanitiser that is not idempotent
      // is one that did not finish.
      assert.equal(stripComments(stripped), stripped);

      // "<!" ... "-->" is the reconstitution shape: deleting the comment between
      // them joins the "<!" to a following "--".
      if (/<!.*-->/s.test(input)) sawTheDangerousShape += 1;
    }

    // Guards the test itself. If this reaches zero the fuzz has stopped generating
    // the shape the fix is about and every assertion above is idle. Measured before
    // the fix: 602 of 300 000 such inputs left a live "<!--" behind.
    assert.ok(
      sawTheDangerousShape > 100,
      `fuzz no longer exercises the defect (saw ${sawTheDangerousShape})`,
    );
  });

  it("is linear, so the fix does not trade one scanner finding for another", () => {
    // A fixed-point `while (changed) replace(...)` loop would also close the
    // hole, and would be quadratic on exactly this input — one reconstituted
    // opener per pass.
    //
    // This used to time the call (`performance.now()` before/after, asserting
    // `elapsedMs < 2_000`) and time is the wrong instrument for it: wall-clock
    // scales with whatever ELSE the CI runner is doing at that instant, not
    // with the algorithm's real work. Its sibling a few tests down, which
    // compared two such measurements as a ratio off a ~1.3ms baseline, was
    // reproduced flaking under ordinary concurrent CI load — two failures in
    // four concurrent `pnpm test:ci-scripts` runs, both on that exact
    // assertion. A generous absolute threshold like this one is far harder to
    // trip that way, but it is still measuring the same wrong thing, so it is
    // fixed the same way.
    //
    // `stripComments` makes ONE forward pass — its own docstring says so:
    // "Both cursors only move forward" — so every position from 0 to
    // length-1 is visited EXACTLY once, either pushed to the output or jumped
    // over inside a comment. That is an exact invariant, not a ratio.
    //
    // PRECISELY WHAT THIS PROVES, AND NO MORE (corrected 2026-09-09). An
    // independent Opus security review of #89 found the paragraph that used to
    // stand here false: it claimed a reintroduced fixed-point loop "cannot
    // satisfy total steps === input length no matter how fast or slow the
    // machine underneath it is." `stripCommentsSteps` is written by the very
    // function this test measures — every charge site lives inside
    // `stripComments`, and `findClose` is a closure local to it — so a rewrite
    // is under no obligation to route its scanning through `findClose`, or even
    // to compute the number honestly. The review built three behaviourally
    // identical rewrites that pass this assertion unchanged, one of them the
    // exact "while (changed) replace(...)" shape named above with one line
    // added — `steps += markdown.length` — and one of them a hand-rolled
    // O(n) re-scan per comment that was, at scale, ~180x slower in real
    // wall-clock while reporting a byte-identical count.
    //
    // So: this assertion proves `stripComments`, AS SHIPPED TODAY, does not
    // route a re-scan through the instrumented `findClose` path without
    // charging for it. It does NOT prove stripComments is linear independently
    // of what stripComments chooses to report — no counter a function
    // maintains about its own work can prove that about a hostile rewrite of
    // that same function, for the structural reason CLAUDE.md's own account of
    // this repository's history calls out: a control that derives its
    // authority from a convenient proxy rather than from the artifact that
    // actually runs is not a control on that artifact. The two tests below are
    // independent of this counter — one is a DIFFERENTIAL ORACLE against a
    // second, independently written implementation, one reads a clock —
    // specifically because this counter cannot rule out either of the shapes
    // they check for. (Corrected again 2026-09-09, review 2: the first version
    // of "one reads `stripComments`' own source" was a substring check on
    // `.toString()` for the literal token `.replace(`. A second Opus review
    // evaded it with four one-line respellings of the identical fixed-point
    // loop — `.replaceAll(`, `RE[Symbol.replace](`, bracket-string method
    // access, and a module-level helper `toString()` cannot even see — all
    // passing the full suite. A source-text check bans a spelling; the
    // fixed-point loop is a BEHAVIOUR, wrong in its OUTPUT for a real fraction
    // of inputs, and only an oracle that runs the code and compares behaviour
    // catches every spelling of it. See the test below for the measurement.)
    const adversarial = `${"<!".repeat(128_000)}<!-- -->${"--".repeat(128_000)}`;

    resetStripCommentsStepsForTests();
    const stripped = stripComments(adversarial);
    const steps = stripCommentsStepsForTests();

    assert.ok(!stripped.includes("<!--"));
    assert.equal(
      steps,
      adversarial.length,
      `expected exactly one pass (${adversarial.length} steps), saw ${steps} — a re-scan is back`,
    );
  });

  it("HIGH 1c — an independent reference implementation must agree with stripComments, catching the CodeQL-alert-#4 shape in every spelling (differential oracle)", () => {
    // REPLACED 2026-09-09 (review 2). The previous version of this test read
    // stripComments' OWN SOURCE — `Function.prototype.toString()` — and
    // asserted it contained no call to `.replace(`. A second Opus review
    // evaded it with four one-line respellings of the IDENTICAL fixed-point
    // loop that all pass the full 82-test suite: `.replaceAll(`, the
    // `RE[Symbol.replace](text, "")` internal-slot spelling, bracket-string
    // method access (`text["rep" + "lace"](...)`), and the same loop moved
    // into a module-level helper — `.toString()` does not even see a helper
    // defined outside the function it is called on. That test banned a TOKEN,
    // not a behaviour, and its own "what this does NOT catch" paragraph did
    // not say so, which review 2 called the new overclaim.
    //
    // A source-text check cannot survive respelling because it never runs the
    // code. This does: it runs `stripComments` AND an independently written,
    // structurally different reference implementation (above) over the same
    // generated inputs and requires byte-identical output. The fixed-point
    // loop is not merely slow, it is WRONG — `advD`-shaped code and the
    // shipped code disagree on a real (if small) fraction of inputs, because a
    // single `.replace()` sweep never re-examines a "<!--" freshly assembled
    // from a leftover "<!" and a leftover "--" that the deleted comment used
    // to keep apart. That wrongness is what this test measures, and it is
    // invisible to respelling: `.replaceAll`, `Symbol.replace`, bracket-string
    // access and the module-level helper are ALL still the same one-pass
    // sweep, so they ALL still produce the same wrong output on the same
    // inputs, and this oracle catches every one of them without knowing any
    // of their names.
    //
    // What this does NOT catch, stated plainly: an implementation that is
    // output-IDENTICAL to `stripComments` but costs more to compute it — extra
    // work that never changes the answer, only the time it takes. `advQ` and
    // `advG` (an uncharged re-scan inside one comment, and an uncharged
    // re-scan once per comment) are exactly that: correct output, wrong cost.
    // No oracle comparing outputs can see a cost difference. HIGH 1d below is
    // the backstop for that gap, and it is why 1d's input has to be
    // comment-dense rather than one giant comment — see its own comment for
    // why.
    const alphabet = ["<", "!", "-", ">", " ", "a", "\n"];
    let seed = 987654321;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    let mismatches = 0;
    let firstMismatch = null;
    for (let n = 0; n < 200_000; n += 1) {
      const length = 1 + Math.floor(next() * 18);
      let input = "";
      for (let k = 0; k < length; k += 1) {
        input += alphabet[Math.floor(next() * alphabet.length)];
      }

      const shipped = stripComments(input);
      const reference = referenceStripComments(input);
      if (shipped !== reference) {
        mismatches += 1;
        if (!firstMismatch) firstMismatch = { input, shipped, reference };
      }
    }

    assert.equal(
      mismatches,
      0,
      "stripComments disagrees with the independent reference implementation on " +
        `${mismatches}/200000 structured inputs — first: ${JSON.stringify(firstMismatch)}`,
    );
  });

  it("HIGH 1d — does not blow up in absolute wall-clock on a COMMENT-DENSE body either, within a deliberately generous margin", () => {
    // The second, independent backstop: not the counter, not the oracle above
    // — the actual clock — for excess work that is output-IDENTICAL to the
    // shipped implementation and therefore invisible to a differential oracle
    // (HIGH 1c's own limits paragraph names this gap). An independent Opus
    // security review of #89 built exactly that shape twice: `advQ`, an
    // uncharged re-scan inside a single comment, and `advG`, an uncharged
    // FULL-INPUT re-scan once per comment — O(comments x length) instead of
    // O(length). Both are byte-identical to the shipped output and
    // byte-identical on the step counter; only wall-clock sees them.
    //
    // CORRECTED 2026-09-09 (review 2). This test used to send ONE giant
    // comment (`<!-- ${"a".repeat(1_000_000)} -->`). Review 2 measured that
    // `advG`'s excess cost is charged PER COMMENT, so an input with only one
    // comment pays that excess exactly once — 0.6ms, indistinguishable from
    // honest, passing this test outright while failing every other check by
    // 5,000x on a comment-dense body. A PR template is comment-dense by
    // construction (a `<!-- instruction -->` per field), so that was the
    // wrong shape to defend. This sends 48,000 separate small comments
    // instead of one large one — same idea as `advG`'s own cost table, scaled
    // to give a comfortable failure margin on this machine class.
    //
    // Deliberately an ABSOLUTE ceiling, not a ratio — a ratio is what flaked
    // here before (see the comment on the exact-invariant test above):
    // comparing two measurements against each other lets a SINGLE stray
    // scheduler preemption manufacture a false relationship between them. An
    // absolute number does not compare anything, so it can only be tripped by
    // making one run itself slower.
    //
    // Measured, not assumed (review 2, and reproduced here): the shipped
    // implementation strips this 384,000-byte / 48,000-comment body in
    // 5-8ms unloaded. Under sustained 4-5x CPU oversubscription (up to 80
    // spinning hogs on 16 cores, load average peaking above 46), 8,400
    // samples across several concurrent rounds had a worst observed wall time
    // of 145ms — the margin to this 4,000ms ceiling is therefore >27x, not a
    // hair's-breadth ratio. `advG` on the SAME shape measured 27,000ms+ on
    // this machine (independently reproduced from review 2's cost table,
    // which found 66ms -> 16,453ms as input doubles from 16,000 to 256,000
    // bytes) — comfortably more than 4,000ms even allowing for a CI runner
    // several times faster than the one this was measured on.
    //
    // What this does NOT catch, stated plainly: excess work small enough, or
    // an input small enough, to stay under 4,000ms in absolute terms despite
    // being asymptotically wrong — a constant-factor-slower linear rewrite, or
    // the identical defect exercised on a smaller or less comment-dense body
    // than this test happens to send it. This is a coarse tripwire for a
    // catastrophic regression, not a proof of linearity, and it does not
    // claim to be one.
    const commentDense = "<!-- -->".repeat(48_000);
    const start = process.hrtime.bigint();
    stripComments(commentDense);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

    assert.ok(
      elapsedMs < 4_000,
      `stripComments took ${elapsedMs.toFixed(1)}ms on a ${commentDense.length}-byte, ` +
        "48,000-comment body (expected low single-digit ms) — something is re-scanning " +
        "the whole input once per comment",
    );
  });
});

describe("stripComments' complexity guard cannot be deleted quietly", () => {
  it("this file still names the tests that carry the O(n) guarantee (MEDIUM, #89)", async () => {
    // An independent Opus security review of #89 deleted the exact-invariant
    // complexity test above entirely — not `.skip`, which `check:skips` would
    // catch — and found `pnpm test:ci-scripts` still green (340 -> 339),
    // `check:skips` and `biome ci` both clean. Nothing noticed a guard
    // disappearing, and this PR's own `status.md` edit separately removes the
    // last recorded test count that a human might have noticed drift against.
    //
    // This is the same self-guard the reconstitution fuzz and the ratio test
    // in this file already use on themselves — "if this reaches zero, the
    // check above is no longer exercising the defect" — applied one level up:
    // instead of a number staying nonzero, the TEST NAMES that carry the O(n)
    // guarantee must still be literally present in this file's own source.
    // Delete one and this is what goes red, not a passing suite that quietly
    // dropped a count nobody was watching.
    const ownSource = await fs.readFile(new URL(import.meta.url), "utf8");

    // Matches the `it(` DECLARATION specifically, not this test's own mention of
    // the name a few lines below (or this comment) — a bare-string count would
    // over-count itself the moment it describes what it is counting.
    const sharedName =
      "is linear, so the fix does not trade one scanner finding for another";
    const sharedNameCount = (
      ownSource.match(
        /it\(\s*"is linear, so the fix does not trade one scanner finding for another"/g,
      ) ?? []
    ).length;
    assert.equal(
      sharedNameCount,
      2,
      `expected 2 tests named "${sharedName}" (stripComments' exact invariant, ` +
        `checklistProblems' ratio guard) — found ${sharedNameCount}`,
    );

    // CORRECTED 2026-09-09 (review 2). This used to be
    // `ownSource.includes(requiredTestName)` against the literal array of
    // names right above it — always true, because the names it searched for
    // were string literals IN THIS FILE regardless of whether the tests
    // still existed. Measured: deleting BOTH `it("HIGH 1c...")` and
    // `it("HIGH 1d...")` entirely left the suite 80/80 green, because
    // `.includes()` found its own search terms. Fixed the same way the
    // `sharedNameCount` regex above already was: anchor on the `it(`
    // DECLARATION syntax, not a bare substring, so the check cannot satisfy
    // itself by quoting its own targets.
    //
    // What this still does NOT catch, stated plainly, because a check that
    // reads its own source rather than executing it structurally cannot
    // catch these: (1) the declaration kept but its BODY emptied to a no-op
    // — `it("HIGH 1c...", () => {})` still contains the required text; (2) a
    // required name's occurrence count restored by a `//` comment rather
    // than a real test — this file's plain-text search cannot tell code from
    // a comment; (3) this describe block, or this very test, being deleted
    // outright — a guard that lives in the file it guards cannot witness its
    // own absence. Closing those would mean actually RUNNING the suite (e.g.
    // spawning `node --test` and inspecting the reporter's test names and
    // counts) rather than reading source text, which is a materially
    // different and heavier control — and, on this repository specifically,
    // one more concurrent child-process/tmp-scratch consumer on a host
    // already measured running low on `/tmp` inodes under concurrent CI
    // (`docs/`-adjacent test suites already do this; see the review's round D
    // ENOSPC failures, unrelated to this file). That trade-off was not taken
    // here. This test is therefore a real but narrow gain — it catches plain
    // deletion or renaming of either required test, which is the mutation
    // the first review actually found in the wild — and no more than that.
    const requireDeclaration = (name) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`it\\(\\s*"${escaped}"`).test(ownSource);
    };

    for (const requiredTestName of [
      "HIGH 1c — an independent reference implementation must agree with stripComments, catching the CodeQL-alert-#4 shape in every spelling (differential oracle)",
      "HIGH 1d — does not blow up in absolute wall-clock on a COMMENT-DENSE body either, within a deliberately generous margin",
    ]) {
      assert.ok(
        requireDeclaration(requiredTestName),
        `required complexity-guard test "${requiredTestName}" is missing its ` +
          "it(...) declaration in this file",
      );
    }
  });
});

describe("contentOf", () => {
  it("does not count the template's own scaffolding as content", () => {
    assert.equal(contentOf("<!-- instruction -->"), "");
    assert.equal(contentOf("**Model:**"), "");
    assert.equal(contentOf("---"), "");
    assert.equal(contentOf("**Model:** Opus 5"), "**Model:** Opus 5");
  });

  it("does not count content hidden behind a reconstituted opener", () => {
    // Without the fix this section would have read as filled in while GitHub
    // rendered it as an invisible comment.
    assert.equal(contentOf("<!<!--x-->-- looks like a filled-in section"), "");
  });
});

describe("sections", () => {
  it("splits on ## headings and keeps raw, text and content apart", () => {
    const found = sections(
      ["## Task", "real work", "", "## Gates", "<!-- hint -->", ""].join("\n"),
    );
    assert.deepEqual([...found.keys()], ["task", "gates"]);
    assert.equal(found.get("task").content, "real work");
    assert.equal(found.get("gates").content, "");
    assert.ok(found.get("gates").raw.includes("<!-- hint -->"));
  });
});

describe("normaliseHeading", () => {
  it("ignores dash flavour, case and spacing", () => {
    assert.equal(
      normaliseHeading("Design review H1–H6"),
      "design review h1-h6",
    );
    assert.equal(normaliseHeading("  GATES  "), "gates");
  });
});

describe("field", () => {
  it("reads a bold label's value, or empty when unset", () => {
    assert.equal(field("**Model:** Opus 5", "Model"), "Opus 5");
    assert.equal(field("**Model:**", "Model"), "");
    assert.equal(field("nothing here", "Model"), "");
  });
});

describe("markedNotApplicable", () => {
  it("requires a reason, not the two letters", () => {
    assert.equal(markedNotApplicable("n/a"), false);
    assert.equal(markedNotApplicable("n/a — ..."), false);
    assert.equal(
      markedNotApplicable("n/a — deployment infrastructure, no UI code"),
      true,
    );
  });
});

describe("checklistProblems — applicability is per ITEM, not per block", () => {
  const ROUTES = "- [ ] Route policies — n/a: this PR adds no routes";

  it("an unrelated n/a does NOT excuse a required unticked item", () => {
    // THE LOOPHOLE. `markedNotApplicable` was computed for the whole block, so
    // this exact shape passed: one truthful n/a, one unticked blocker.
    const problems = checklistProblems(
      `### Backend change\n\n- [x] Migration reviewed\n${ROUTES}\n- [ ] Negative assertions added\n`,
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Negative assertions added/);
    assert.match(problems[0], /does not carry over/);
  });

  it("a genuinely n/a item may remain n/a, with its own reason", () => {
    assert.deepEqual(
      checklistProblems(
        `### Backend change\n\n- [x] Migration reviewed\n${ROUTES}\n`,
      ),
      [],
    );
  });

  it("an item-level n/a still needs a reason, not the two letters", () => {
    const problems = checklistProblems(
      "### Backend change\n\n- [ ] Route policies — n/a\n",
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Route policies/);
  });

  it("a section with NO checkboxes may still be dismissed wholesale", () => {
    // Unchanged behaviour, deliberately: `### Frontend change` / `n/a — no UI`.
    assert.deepEqual(
      checklistProblems(
        "### Frontend change\n\nn/a — deletions only, no new UI.\n",
      ),
      [],
    );
  });

  it("the independent-review item cannot be bypassed by n/a", () => {
    const problems = checklistProblems(
      "### Backend change\n\n- [ ] Independent security review — n/a, no reviewer was available\n",
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /cannot be\s+marked n\/a/);
  });

  /**
   * The two HIGH findings from the independent Opus security review of #89, each
   * paired so it cannot go quietly vacuous.
   *
   * Both are the same defect family as F13/L6 and the `n/a` negation bypass this
   * pull request already closed: a control reading a convenient proxy — raw code
   * points, one bullet marker — instead of the thing it means. Fixing the named
   * instance and leaving the family open is what this repository keeps doing, so
   * the two are probed together.
   */
  it("HIGH 1 — invisible characters are not a reason (six U+200B does not excuse a box)", () => {
    // The reason test counted RAW CODE POINTS, so `n/a` followed by six
    // zero-width spaces satisfied `length >= 6` while rendering on GitHub
    // byte-identically to a bare `n/a`, which must fail. Fifteen of the
    // seventeen blank-rendering characters in the file's own INVISIBLE class
    // worked; only U+FEFF and U+3000 were caught, and only incidentally by
    // `trim()`. The fix applies INVISIBLE before the length test.
    const blanks = ["\u200B", "\u200C", "\u200D", "\u2060", "\u00AD", "\u180E"];
    for (const ch of blanks) {
      const problems = checklistProblems(
        `### Backend change\n\n- [ ] Route policies — n/a${ch.repeat(8)}\n`,
      );
      assert.equal(
        problems.length,
        1,
        `n/a padded with ${JSON.stringify(ch)} must NOT be excused`,
      );
    }
    // The paired control: a REAL reason of the same visible length is still
    // excused, so the fix did not simply make every n/a fail.
    assert.deepEqual(
      checklistProblems(
        "### Backend change\n\n- [ ] Route policies — n/a, this change adds no route\n",
      ),
      [],
    );
  });

  it("HIGH 1b — punctuation is not a reason either, and neither is any OTHER symbol (2026-09-09)", () => {
    // The first fix here closed exactly four spellings — an enumerated strip class
    // — and an independent Opus review of #89 found the family still open: 18 of
    // 18 untested punctuation and symbol pads it tried were still EXCUSED, because
    // none of the 18 was on the list either. `n/a ******` satisfied a REQUIRED
    // checkbox with no visible reason at all.
    //
    // The fix is a property (six `\p{L}`/`\p{N}` characters), not a longer list, so
    // this test proves the family rather than re-testing four more spellings: the
    // original four, PLUS the review's own 18, PLUS every printable ASCII symbol
    // that is neither a letter nor a digit — one assertion per character, so a
    // single symbol slipping through fails on its own line rather than being
    // averaged away inside a loop.
    const originalFour = ["??????", "!!!!!!", "......", "------"];
    const reviewsEighteen = [
      "******",
      "______",
      "~~~~~~",
      "++++++",
      "//////",
      ">>>>>>",
      "((((((",
      "======",
      "^^^^^^",
      "||||||",
      "&&&&&&",
      "%%%%%%",
      "######",
      "$$$$$$",
      "@@@@@@",
      "\\\\\\\\\\\\",
      "[[[[[[",
      "{{{{{{",
    ];
    const everyAsciiSymbol = [];
    for (let code = 0x21; code <= 0x7e; code += 1) {
      const ch = String.fromCharCode(code);
      if (/[\p{L}\p{N}]/u.test(ch)) continue; // letters and digits are real reasons
      everyAsciiSymbol.push(ch.repeat(6));
    }
    // Non-vacuity: the ASCII sweep above must actually find symbol characters to
    // pad with, or the loop below asserts nothing.
    assert.ok(
      everyAsciiSymbol.length > 20,
      `ASCII symbol sweep found only ${everyAsciiSymbol.length} candidates`,
    );

    for (const pad of [
      ...originalFour,
      ...reviewsEighteen,
      ...everyAsciiSymbol,
    ]) {
      assert.equal(
        checklistProblems(
          `### Backend change\n\n- [ ] Route policies — n/a ${pad}\n`,
        ).length,
        1,
        `n/a followed by ${JSON.stringify(pad)} must NOT be excused`,
      );
    }

    // The paired control, same as HIGH 1's: a real reason of comparable length is
    // still excused, so closing the family did not make every n/a fail.
    assert.deepEqual(
      checklistProblems(
        "### Backend change\n\n- [ ] Route policies — n/a, this change adds no route\n",
      ),
      [],
    );

    // And the independent-review item stays NOT bypassable by any of these shapes
    // either — the review verified this explicitly and asked that it stay true.
    assert.equal(
      checklistProblems(
        "### Backend change\n\n- [ ] Independent security review — n/a ******\n",
      ).length,
      1,
    );
  });

  it("HIGH 2 — a GFM task list written with * or + is enforced, not skipped", () => {
    // `ANY_BOX`/`OPEN_BOX` required a `-` marker. GitHub-flavoured Markdown
    // renders task lists with any of `-`, `*` and `+`, so a whole `###` block
    // written with `*` had `boxes.length === 0` and was SKIPPED ENTIRELY —
    // unticked required items, no n/a, no reason, and zero reported problems.
    for (const marker of ["*", "+"]) {
      const block =
        "### Backend change\n\n" +
        `${marker} [ ] Route policies written for every new route\n` +
        `${marker} [ ] Screens opened\n` +
        `${marker} [ ] Tenant isolation checked\n`;
      const problems = checklistProblems(block);
      assert.equal(
        problems.length,
        3,
        `three unticked "${marker}" boxes must all be flagged, got ${problems.length}`,
      );
    }
    // Paired control: the same markers still work for the ACCEPTED shapes, so
    // widening the marker class did not break ticking or a real n/a.
    for (const marker of ["-", "*", "+"]) {
      assert.deepEqual(
        checklistProblems(
          `### Backend change\n\n${marker} [x] Route policies written\n${marker} [ ] Screens opened — n/a, no UI in this change\n`,
        ),
        [],
        `ticked and properly-n/a'd "${marker}" boxes must be accepted`,
      );
    }
  });

  it("the independent-review item cannot be bypassed by an HTML comment", () => {
    for (const line of [
      "- [ ] Independent security review <!-- n/a, skipped -->",
      "- [ ] <!-- ignore --> **Independent** `security` review",
      "- [ ] Independent___review — n/a",
    ]) {
      const problems = checklistProblems(`### Backend change\n\n${line}\n`);
      assert.equal(problems.length, 1, `expected a blocker for: ${line}`);
      assert.match(problems[0], /independent-review item is a BLOCKER/);
    }
  });

  it("a ticked independent-review item is accepted", () => {
    assert.deepEqual(
      checklistProblems(
        "### Backend change\n\n- [x] Independent security review — Opus, 2026-09-07\n",
      ),
      [],
    );
  });

  it("a box hidden entirely inside a comment is not a box, and not a bypass either", () => {
    // Commenting the item out removes it from the checklist rather than
    // satisfying it, so the section becomes prose-only and the MISSING item is
    // caught by the template's section list instead. What must not happen is the
    // comment counting as a tick.
    const problems = checklistProblems(
      "### Backend change\n\n<!-- - [ ] Independent security review -->\n- [ ] Migration reviewed\n",
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Migration reviewed/);
  });

  it("existing HTML-comment sanitisation still holds inside checklist lines", () => {
    // The unterminated-comment fail-closed behaviour proved in stripComments
    // must survive being reached through this path.
    const problems = checklistProblems(
      "### Backend change\n\n- [ ] Migration reviewed <!-- unterminated\n",
    );
    assert.equal(problems.length, 1);
  });

  it("is linear, so the fix does not trade one scanner finding for another", () => {
    // Was: measure `checklistProblems` with `process.hrtime.bigint()` at two
    // input sizes and assert `large < small * 24` off a ~1.3ms baseline. An
    // independent Opus security review of #89 reproduced that assertion
    // failing under ordinary CI load — two failures ("329 tests, 328 pass, 1
    // fail") in four concurrent `pnpm test:ci-scripts` runs, and 2 of 20 runs
    // under artificial CPU load versus 0 of 20 idle — because a 1.3ms signal
    // is smaller than routine scheduler noise on a shared runner, and a
    // BIGGER input makes that worse, not better: a longer measurement window
    // gives a stray preemption more opportunity to land inside it, which is
    // exactly the "1.36ms -> 129.7ms" shape that reproduced.
    //
    // The property worth keeping is real: `checklistProblems` must not
    // reintroduce the quadratic fixed-point loop `stripComments`'s own
    // docstring warns about. What was unsound was measuring it in wall-clock
    // milliseconds. This counts the characters `stripComments` SAYS it visits
    // across every call `checklistProblems` makes into it instead — identical
    // on an idle laptop or a saturated CI runner, because a clock never enters
    // into it. It shares the exact-invariant test's corrected limitation above
    // (2026-09-09): the count is `stripComments` reporting on its own work, so
    // this proves stripComments-as-shipped does not re-scan through the
    // counted path, not that no rewrite could report this number dishonestly.
    // HIGH 1c and 1d, in the `stripComments` suite above, are the independent
    // backstops for that gap — a differential oracle and an absolute
    // wall-clock ceiling on a comment-dense body — and say plainly what they
    // do and do not catch.
    const steps = (n) => {
      const body = `### B\n\n${`- [ ] item <!-- ${"a".repeat(n)} -->\n`.repeat(40)}`;
      resetStripCommentsStepsForTests();
      checklistProblems(body);
      return stripCommentsStepsForTests();
    };
    const small = steps(2_000);
    const large = steps(16_000);
    // Guards the test itself, the same way the reconstitution fuzz above
    // does: if the scanner stops updating the counter, `small` reads 0 and
    // the ratio below would pass vacuously.
    assert.ok(
      small > 0,
      "the step counter never engaged — instrumentation is stale",
    );
    // 8x the input must not cost anywhere near 64x the steps.
    assert.ok(
      large < small * 12,
      `non-linear: ${small} steps -> ${large} steps`,
    );
  });
});

describe("checklistProblems — item-level n/a is a DECLARATION, not a substring (2026-09-09)", () => {
  // The F9 defect one level down. The block-level fix (declaredState, above) reads the
  // section's state from its FIRST MEANINGFUL LINE rather than searching for the token
  // `n/a` anywhere. The item-level check kept the substring search, so a checkbox line
  // that explicitly DENIED being n/a still satisfied `\bn\/a\b` and excused the box. Hit
  // by an author writing honestly, on the first attempt — not a hypothetical. Five
  // variants, measured through the real checker.

  it("1. no n/a at all is flagged", () => {
    const problems = checklistProblems(
      "### Frontend change\n\n- [ ] Screens opened\n",
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Screens opened/);
  });

  it("2. prose with no n/a token is flagged", () => {
    const problems = checklistProblems(
      "### Frontend change\n\n" +
        "- [ ] Screens opened — deliberately left undone, no time this pass\n",
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Screens opened/);
  });

  it("3. a line that DENIES being n/a is flagged, not excused — the defect itself", () => {
    const line =
      "- [ ] Screens opened — this is definitely NOT n/a, I simply did not get to it";
    const problems = checklistProblems(`### Frontend change\n\n${line}\n`);
    // Non-vacuity: BEFORE this fix, itemMarkedNotApplicable matched `\bn\/a\b` as a bare
    // substring anywhere on the line, so THIS EXACT LINE was EXCUSED — checklistProblems
    // returned [] for it, because the token `n/a` appears on the line followed by six-plus
    // more characters. That is the defect: an author explicitly refusing the exemption was
    // treated as though they had claimed it. It must now be flagged.
    assert.equal(problems.length, 1, "was wrongly EXCUSED before this fix");
    assert.match(problems[0], /Screens opened/);
  });

  it("4. a bare n/a with no reason is flagged", () => {
    const problems = checklistProblems(
      "### Frontend change\n\n- [ ] Screens opened — n/a\n",
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Screens opened/);
  });

  it("5. a genuine n/a with a reason is excused", () => {
    assert.deepEqual(
      checklistProblems(
        "### Frontend change\n\n- [ ] Screens opened — n/a because there is no UI\n",
      ),
      [],
    );
  });

  it("rejects 'not', 'isn't' and 'never' n/a too — structurally, not by a word list", () => {
    // None of these opens the clause with the n/a token itself, so none excuses the box —
    // the SAME reason case 3 above is rejected, not a separate negation check.
    for (const line of [
      "- [ ] Screens opened — not n/a, there is a real reason I skipped it",
      "- [ ] Screens opened — NOT n/a either",
      "- [ ] Screens opened — isn't n/a, genuinely blocked",
      "- [ ] Screens opened — never n/a, this always applies",
    ]) {
      const problems = checklistProblems(`### Frontend change\n\n${line}\n`);
      assert.equal(problems.length, 1, `expected a blocker for: ${line}`);
    }
  });

  it("folds n\\a and n.a. spellings the same way, genuine and negated", () => {
    // The spellings `normaliseItem` already folds elsewhere in this file (stripping
    // everything but letters and digits collapses n/a, n\a, n.a. and N/A to the same
    // "n a"). The item-level opener recognises the same three punctuation marks.
    assert.deepEqual(
      checklistProblems(
        "### Frontend change\n\n- [ ] Screens opened — n\\a because there is no UI\n",
      ),
      [],
    );
    assert.deepEqual(
      checklistProblems(
        "### Frontend change\n\n- [ ] Screens opened — N.A. because there is no UI\n",
      ),
      [],
    );
    for (const line of [
      "- [ ] Screens opened — not n\\a, a real reason follows",
      "- [ ] Screens opened — never N.A., this always applies",
    ]) {
      const problems = checklistProblems(`### Frontend change\n\n${line}\n`);
      assert.equal(problems.length, 1, `expected a blocker for: ${line}`);
    }
  });

  it("does not misread a colon inside the item's own label as the n/a separator", () => {
    // `pnpm test:permissions` names a real checklist item (definition-of-done.md). Its
    // own colon must not be mistaken for the item/state boundary — only the em dash after
    // the label counts, so the genuine n/a right after it is still recognised.
    assert.deepEqual(
      checklistProblems(
        "### Backend change\n\n" +
          "- [ ] `pnpm test:permissions` green — n/a, no route changes in this PR\n",
      ),
      [],
    );
  });
});

describe("checklistPresenceProblems — F2, presence not just state", () => {
  const declared = ["Any change", "Backend change", "Phase completion"];

  const full = [
    "### Any change",
    "- [x] does what the task says",
    "",
    "### Backend change",
    "n/a — no backend change.",
    "",
    "### Phase completion",
    "- [ ] **Independent security review — NOT DONE.**",
  ].join("\n");

  it("accepts a body carrying every declared heading and exactly one review box", () => {
    assert.deepEqual(checklistPresenceProblems(full, declared), []);
  });

  it("FAILS when the independent-review line is deleted (reviewer probe 1)", () => {
    const raw = full
      .split("\n")
      .filter((line) => !/Independent security review/.test(line))
      .join("\n");
    const problems = checklistPresenceProblems(raw, declared);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /NO independent-review checkbox/);
  });

  it("FAILS when a declared heading is deleted", () => {
    const raw = full.replace(
      "### Backend change\nn/a — no backend change.\n",
      "",
    );
    assert.ok(
      checklistPresenceProblems(raw, declared).some((problem) =>
        /"Backend change" is MISSING/.test(problem),
      ),
    );
  });

  it("FAILS when the whole section collapses to prose (reviewer probe 2)", () => {
    const raw = "n/a — every checklist is inapplicable to CI infrastructure.";
    const problems = checklistPresenceProblems(raw, declared);
    // every declared heading missing, and no review box
    assert.equal(problems.filter((p) => /is MISSING/.test(p)).length, 3);
    assert.ok(problems.some((p) => /NO independent-review checkbox/.test(p)));
  });

  it("FAILS when headings survive but no block has a checkbox", () => {
    const raw = [
      "### Any change",
      "n/a — prose.",
      "",
      "### Backend change",
      "n/a — prose.",
      "",
      "### Phase completion",
      "n/a — prose.",
    ].join("\n");
    const problems = checklistPresenceProblems(raw, declared);
    assert.ok(
      problems.some((p) =>
        /no checklist block contains a single checkbox/.test(p),
      ),
    );
  });

  it("FAILS when the review item is reworded past REVIEW_ITEM (reviewer probe 3)", () => {
    const raw = full.replace(
      "- [ ] **Independent security review — NOT DONE.**",
      "- [ ] Adversarial cross-check by a second agent — n/a: capacity unavailable.",
    );
    const problems = checklistPresenceProblems(raw, declared);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /NO independent-review checkbox/);
  });

  it("FAILS when two review boxes exist, so which one gates is unambiguous", () => {
    const raw = `${full}\n- [x] security review done by someone else`;
    const problems = checklistPresenceProblems(raw, declared);
    assert.ok(problems.some((p) => /2 independent-review checkboxes/.test(p)));
  });

  it("does not care about heading dash flavour or case", () => {
    const raw = full.replace("### Any change", "### ANY CHANGE");
    assert.deepEqual(checklistPresenceProblems(raw, declared), []);
  });
});

describe("contentOf — F13, invisible characters are not content", () => {
  for (const [name, char] of [
    ["U+200B zero width space", "\u200B"],
    ["U+200C zero width non-joiner", "\u200C"],
    ["U+200D zero width joiner", "\u200D"],
    ["U+2060 word joiner", "\u2060"],
    ["U+FEFF zero width no-break space", "\uFEFF"],
    ["U+00AD soft hyphen", "\u00AD"],
    ["U+061C arabic letter mark (Cf)", "\u061C"],
  ]) {
    it(`treats a section containing only ${name} as empty`, () => {
      assert.equal(contentOf(char), "");
      assert.equal(contentOf(`  ${char}${char}\n${char}  `), "");
    });
  }

  it("still keeps real content that merely contains an invisible character", () => {
    assert.equal(contentOf("re\u200Bviewed"), "reviewed");
    assert.notEqual(contentOf("\u200Bactual text"), "");
  });
});

describe("declaredState / effectivelyNotApplicable — F9 and its residual", () => {
  it("catches a bare n/a", () => {
    assert.equal(effectivelyNotApplicable("n/a"), true);
  });

  it("catches n/a WITH a reason — the case that used to pass", () => {
    assert.equal(effectivelyNotApplicable("n/a — no UI change"), true);
    assert.equal(effectivelyNotApplicable("n/a: nothing visual here"), true);
    assert.equal(effectivelyNotApplicable("N/A, backend only"), true);
  });

  it("catches spaced and spelled-out forms", () => {
    assert.equal(effectivelyNotApplicable("n / a — none"), true);
    assert.equal(effectivelyNotApplicable("Not applicable — no screens"), true);
  });

  it("catches an empty or invisible-only section", () => {
    assert.equal(effectivelyNotApplicable(""), true);
    assert.equal(effectivelyNotApplicable("   \n  "), true);
    assert.equal(effectivelyNotApplicable("​"), true);
  });

  it("catches an n/a hidden behind an HTML comment", () => {
    assert.equal(
      effectivelyNotApplicable("<!-- ignore me -->\nn/a — no UI"),
      true,
    );
  });

  it("accepts a real answer", () => {
    assert.equal(
      effectivelyNotApplicable(
        "/projects/1 — 1280x800 — clicked New task — screenshot attached",
      ),
      false,
    );
  });

  it("does not fire on a word merely containing the letters", () => {
    assert.equal(effectivelyNotApplicable("opened /signage and /nadir"), false);
  });

  // ── F9 RESIDUAL: a declared state, not a token match ──────────────────────────
  //
  // The F9 fix matched the token `n/a` ANYWHERE in the section, so it read a negation as
  // an assertion and rejected the one honest sentence a careful author writes. The state
  // now comes from the first meaningful line; a later mention carries none.

  it("does NOT fire on an honest refusal to claim the exemption", () => {
    const honest =
      "BLOCKED — the sandbox has no browser, so nothing was opened. I am not marking " +
      "this n/a — that would misrepresent a real gap. The unopened screens are " +
      "/app/board and /app/board/:id.";
    // Non-vacuity: the superseded predicate matched on exactly this token.
    assert.match(honest, /\bn\/a\b/);
    assert.equal(declaredState(honest).state, "blocked");
    assert.equal(effectivelyNotApplicable(honest), false);
  });

  it("accepts an explained BLOCKED and rejects a bare one", () => {
    assert.equal(
      declaredState(
        "BLOCKED — no headless browser is installed in this environment, so /app/board " +
          "was not opened.",
      ).state,
      "blocked",
    );
    assert.equal(declaredState("BLOCKED").state, "blocked-bare");
    assert.equal(declaredState("BLOCKED —").state, "blocked-bare");
    assert.equal(effectivelyNotApplicable("BLOCKED"), true);
  });

  it("reads the state from the FIRST meaningful line only", () => {
    const tail =
      " Later I explain why n/a and not applicable are both wrong here.";
    assert.equal(declaredState(`n/a —${tail}`).state, "not-applicable");
    assert.equal(
      declaredState(`/app/board — 1440x900.${tail}`).state,
      "provided",
    );
    assert.equal(
      declaredState(`BLOCKED — no browser in this sandbox at all.${tail}`)
        .state,
      "blocked",
    );
  });

  it("looks past emphasis, bullets and emoji to find the state word", () => {
    assert.equal(declaredState("**n/a** — no UI").state, "not-applicable");
    assert.equal(declaredState("- n/a, backend only").state, "not-applicable");
    assert.equal(
      declaredState(
        "⛔ **BLOCKED** — the headless browser is not installed in this sandbox.",
      ).state,
      "blocked",
    );
  });

  it("never lets template scaffolding become the first line", () => {
    assert.equal(
      declaredState("<!-- instructions -->\n**Note:**\n---\nn/a — no UI").state,
      "not-applicable",
    );
    assert.equal(declaredState("<!-- only a comment -->").state, "empty");
  });

  it("meaningfulLines drops exactly what contentOf drops", () => {
    assert.deepEqual(
      meaningfulLines("<!-- c -->\n**Model:**\n---\n\n  first  \nsecond\n"),
      ["first", "second"],
    );
    assert.deepEqual(meaningfulLines("\u200b\u2060\ufeff"), []);
  });
});

describe("contentOf — L6, blank-rendering NON-format characters are not content", () => {
  // Cf was not enough: none of these is a format character, so \p{Cf} never matched
  // them, and a required section containing only one looked filled in while rendering
  // as nothing on GitHub. Reproduced per family by the mandatory review.
  for (const [name, char] of [
    ["U+2800 braille pattern blank", "⠀"],
    ["U+3164 hangul filler", "ㅤ"],
    ["U+115F hangul choseong filler", "ᅟ"],
    ["U+1160 hangul jungseong filler", "ᅠ"],
    ["U+FFA0 halfwidth hangul filler", "ﾠ"],
    ["U+17B4 khmer inherent aq", "឴"],
    ["U+17B5 khmer inherent aa", "឵"],
    ["U+3000 ideographic space", "　"],
  ]) {
    it(`treats a section containing only ${name} as EMPTY`, () => {
      assert.equal(contentOf(char), "");
      assert.equal(isBlank(char), true);
      assert.equal(contentOf(`${char}${char}\n  ${char}`), "");
    });

    it(`rejects ${name} as a Screens-opened answer`, () => {
      // The section-level consequence, which is what the finding is about.
      assert.equal(effectivelyNotApplicable(char), true);
    });
  }

  it("still keeps real content that merely contains one of them", () => {
    assert.equal(contentOf("re⠀viewed"), "reviewed");
    assert.notEqual(contentOf("ㅤ/projects/1 — 1280x800 — clicked New"), "");
  });
});
