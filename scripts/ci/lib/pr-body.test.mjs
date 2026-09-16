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
      // Math.imul, for the same reason as the oracle fuzz below: `seed * 1103515245`
      // overflows Number.MAX_SAFE_INTEGER for a 31-bit seed, the low bits stop being
      // reliable, and the sequence collapses. Measured on this exact loop: 16,403 distinct
      // seeds out of 200,000 draws before, 200,000 after. Same defect, same one-line fix —
      // it was left behind when its twin was corrected, which is the stale-neighbour
      // pattern this file has already been bitten by.
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
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
    // loop that all pass the full suite: `.replaceAll(`, the
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
    // to keep apart. That reconstitution defect is real — it is what CodeQL
    // alert #4 named — and it is invisible to respelling regardless:
    // `.replaceAll`, `Symbol.replace`, bracket-string access and the
    // module-level helper are ALL still the same one-pass sweep, so they ALL
    // still disagree with the reference on the same inputs, and this oracle
    // catches every one of them without knowing any of their names.
    //
    // CORRECTED 2026-09-10 (review 3, independent Opus). This comment used to
    // call the 200,000 draws below "200,000 structured inputs" and say the
    // fixed-point family's failures were reconstitution failures. Both were
    // wrong, from the same root cause: for a 31-bit seed, `seed * 1103515245`
    // is ~1e18-2e18, far past `Number.MAX_SAFE_INTEGER` (~9e15), so
    // `& 0x7fffffff` was masking floating-point rounding noise, not the LCG's
    // real output. Measured: the seed stream re-entered a cycle after 5,355
    // draws with period 10,466, so 200,000 draws produced only 1,377 DISTINCT
    // strings, of which just 3 ever disagreed with a reintroduced fixed-point
    // loop — the "401/200000" this test used to report was those 3 strings
    // counted ~134 times each, not 401 independent findings. And every one of
    // those 3 was a `<!--` with no closer anywhere in the raw input: none
    // needed a second `.replace()` pass to reach the wrong answer, so none
    // actually exercised RECONSTITUTION (an opener created by deleting the
    // comment between it and a leftover `--`) — contrary to what this comment
    // used to claim.
    //
    // Fixed below with `Math.imul`, which performs the 32-bit integer
    // multiplication the masked arithmetic was supposed to do. Re-measured
    // after the fix: 200,000 draws now produce 154,684 DISTINCT strings, and
    // a reintroduced fixed-point loop disagrees with the reference on 500 of
    // them (495 distinct). The axis finding still holds even at that size,
    // though: of those 500 disagreements, 0 needed a second `.replace()` pass
    // to reach the wrong answer. This generator's short, 7-character alphabet
    // makes the multi-segment shape genuine reconstitution needs (an `<!`,
    // then a nested `<!--...-->`, then a leftover `--`, at least 11
    // characters in the right order) too rare to show up reliably even at
    // 154,684 distinct strings. The oracle still CATCHES the fixed-point
    // family on single-pass wrongness alone, which is a real and sufficient
    // defect — it just does not exercise reconstitution specifically, and
    // this comment no longer claims an axis the fuzz does not cover.
    //
    // What this does NOT catch, stated plainly: an implementation that is
    // output-IDENTICAL to `stripComments` but costs more to compute it — extra
    // work that never changes the answer, only the time it takes. `advQ` and
    // `advG` (an uncharged re-scan inside one comment, and an uncharged
    // re-scan once per comment) are exactly that: correct output, wrong cost.
    // No oracle comparing outputs can see a cost difference. HIGH 1d below is
    // the backstop for `advQ` and `advG` specifically — see its own comment
    // for which shape catches which.
    //
    // It is NOT the backstop for every output-correct-but-expensive rewrite.
    // `advR` — the literal alert-#4 `while (changed) { text.replace(...) }`
    // loop with a three-line fail-closed post-pass appended — is ALSO
    // output-identical to shipped (verified over 31.5 million exhaustive
    // inputs) and IS genuinely quadratic, but it converges in exactly 2 passes
    // on both of HIGH 1d's input shapes, so wall-clock never sees it either:
    // this oracle cannot see it because it is output-correct, and 1d cannot
    // see it because it is fast on the shapes 1d sends. That is exactly why
    // the source-text check immediately below exists ALONGSIDE this oracle
    // rather than instead of it — a source ban catches a known-bad construct
    // that is output-right, which neither an output oracle nor a cost ceiling
    // can, by construction, ever see. The three instruments are complementary,
    // not a ladder. Each covers cases the others miss — but they do NOT jointly cover
    // everything, and an earlier version of this comment said they did. Measured
    // counter-example: the literal CodeQL-alert-#4 loop, respelled to evade the source ban
    // (`.replaceAll`, `RegExp[Symbol.replace]`, a computed member, or a module-level helper
    // `toString()` cannot see) AND given the same three-line fail-closed post-pass documented
    // for advR, is output-identical over 31,536,628 exhaustive inputs, is 234x slower at
    // GitHub's 64KB body cap, converges in 2 passes so neither 1d shape sees it — and passes
    // all three instruments. Tracked, not closed here: it requires commit access to
    // scripts/ci/**, which is itself in security-review scope. Recorded as issue #106.
    const alphabet = ["<", "!", "-", ">", " ", "a", "\n"];
    let seed = 987654321;
    const next = () => {
      // Math.imul does true 32-bit integer multiplication, so the low 31 bits
      // kept by `& 0x7fffffff` are the LCG's real output rather than
      // floating-point rounding noise (see the comment above this test).
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
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
        `${mismatches}/200000 draws — first: ${JSON.stringify(firstMismatch)}`,
    );
  });

  it("HIGH (restored) — refuses to call `.replace()` inside stripComments' own source, the literal CodeQL-alert-#4 shape an output oracle cannot see", () => {
    // RESTORED 2026-09-10 (review 3, independent Opus). This exact check
    // existed under the name "HIGH 1c" and was DELETED when the differential
    // oracle above was added, on the reasoning — in the task brief that
    // produced that change, not in this file — that the oracle "makes this
    // largely redundant". That reasoning was wrong, and it cost real
    // coverage: `advR`, the literal alert-#4 shape —
    // `text.replace(/<!--[\s\S]*?-->/g, "")` inside `while (changed)`, plus a
    // three-line fail-closed post-pass that makes its OUTPUT match shipped —
    // is output-equivalent to `stripComments` over 31,536,625 exhaustive
    // inputs (every string over the comment metacharacters up to length 12).
    // The oracle above cannot see it, by construction: it only compares
    // OUTPUTS, and this rewrite's output is correct. It is also genuinely
    // quadratic — one fixed-point pass per reconstituted opener, measured at
    // 214x slower than shipped at GitHub's own 64KB pull-request-body size
    // cap — but it converges in exactly 2 passes on both of HIGH 1d's input
    // shapes below, so wall-clock never sees it either. Measured: this check
    // was RED at the commit where it still existed (it caught `advR`) and is
    // GREEN at the commit that deleted it.
    //
    // The three instruments in this file are complementary, not a ladder, and
    // that is the point of restoring this one rather than trusting the
    // oracle alone: the differential oracle above catches an implementation
    // that is output-WRONG, whatever it is spelled like; this check catches a
    // SPECIFIC known-bad construct that happens to be output-RIGHT; HIGH 1d
    // below catches expensive-but-correct work, for whichever input shape it
    // is actually given. Each one's blind spot is exactly what the other two
    // are for. Replacing one with another trades coverage rather than
    // improving it, which is what happened here and is what this restores.
    //
    // What this does NOT catch, stated plainly, unchanged from when this
    // check was first written and deleted once already for exactly this
    // reason: `Function.prototype.toString()` sees only the text of the
    // function it is called on, so it cannot see a fixed-point loop moved into
    // a module-level helper that `stripComments` merely calls; and every
    // respelling of the literal token `.replace(` — `.replaceAll(`,
    // `RE[Symbol.replace](`, `text["rep" + "lace"](` — evades a check that
    // only ever looks for that one substring. That is fine, and not a gap left
    // quietly open: every one of those rewrites is still the identical
    // one-pass sweep, so it is still OUTPUT-WRONG on the same fraction of
    // inputs the oracle above draws, and the oracle catches every one of them
    // without needing to read a single character of source.
    assert.ok(
      !/\.replace\s*\(/.test(stripComments.toString()),
      "stripComments now calls .replace() — the fixed-point loop CodeQL " +
        "flagged is back. The differential oracle above and the step counter " +
        "can both stay green against a rewrite like this (see their own " +
        "comments for why); this check does not depend on either of them.",
    );
  });

  it("HIGH 1d — does not blow up in absolute wall-clock on a COMMENT-DENSE body either, within a deliberately generous margin", () => {
    // The second, independent backstop: not the counter, not the oracle above
    // — the actual clock — for excess work that is output-IDENTICAL to the
    // shipped implementation and therefore invisible to a differential oracle
    // (HIGH 1c's own limits paragraph names this gap). An independent Opus
    // security review of #89 built exactly that shape twice, and the two need
    // OPPOSITE input shapes to show up:
    //
    //   `advQ` — an uncharged bare-`indexOf` re-scan INSIDE `findClose`,
    //   quadratic in the length of a SINGLE comment body. A comment-dense
    //   body of many small comments never triggers it, because each comment
    //   is short; it needs one huge comment. Caught below by the
    //   single-giant-comment shape.
    //
    //   `advG` — an uncharged FULL-INPUT re-scan once PER comment, so its
    //   cost is O(comments x length) rather than O(length). A single giant
    //   comment pays that excess exactly once, indistinguishable from honest
    //   cost; it needs MANY comments. Caught below by the
    //   forty-eight-thousand-small-comments shape.
    //
    // Both are byte-identical to the shipped output and byte-identical on the
    // step counter; only wall-clock sees them, and only when this test sends
    // the shape each one actually needs.
    //
    // CORRECTED 2026-09-09 (review 2). This test used to send ONLY one giant
    // comment (`<!-- ${"a".repeat(1_000_000)} -->`), which catches `advQ` but
    // not `advG` — a PR template is comment-dense by construction (a
    // `<!-- instruction -->` per field), so `advG` is the realistic shape and
    // review 2 was right to add it. What review 2 got wrong was REPLACING the
    // giant-comment input rather than keeping it alongside the new one: that
    // traded away `advQ` — the adversary this test was ORIGINALLY written
    // for — when nothing forced that choice.
    //
    // RESTORED 2026-09-10 (review 3, independent Opus). Measured: with only
    // the comment-dense input, `advQ` (reconstructed with its `indexOf`
    // result accumulated, so V8 cannot dead-code-eliminate the whole re-scan)
    // costs 6.2ms — 645x UNDER this test's ceiling — where the giant-comment
    // input costs it 5,124.6ms, comfortably over. Both shapes are run below
    // for exactly that reason: no single input catches both adversaries at a
    // comparable byte budget, and keeping both costs about 7ms of combined
    // honest runtime.
    //
    // Deliberately an ABSOLUTE ceiling, not a ratio — a ratio is what flaked
    // here before (see the comment on the exact-invariant test above):
    // comparing two measurements against each other lets a SINGLE stray
    // scheduler preemption manufacture a false relationship between them. An
    // absolute number does not compare anything, so it can only be tripped by
    // making one run itself slower.
    //
    // Measured, not assumed: the shipped implementation strips the
    // 384,000-byte / 48,000-comment body and the 1,000,009-byte / 1-comment
    // body in low single-digit ms unloaded, combined. Under sustained 4-5x CPU
    // oversubscription (up to 80 spinning hogs on 16 cores, load average
    // peaking at 89), 8,400 samples of this exact assertion had a worst
    // observed wall time of 167.35ms — a margin of nearly 24x to this 4,000ms
    // ceiling, and nothing came within 10x of it. `advG` on the comment-dense
    // shape measured 26,606-32,518ms on this machine; `advQ` on the
    // giant-comment shape measured 5,124.6ms — both comfortably over 4,000ms.
    //
    // What this does NOT catch, stated plainly: excess work small enough, or
    // an input small enough, to stay under 4,000ms in absolute terms despite
    // being asymptotically wrong — a constant-factor-slower linear rewrite, or
    // either defect exercised on a smaller body than the two shapes below
    // happen to send it. Nor does either shape catch `advR`, the
    // output-correct fixed-point-loop shape the restored source-text check
    // above covers: `advR` converges in exactly 2 passes on BOTH shapes
    // below, so it is fast here regardless of input size. This is a coarse
    // tripwire for a catastrophic wall-clock regression, not a proof of
    // linearity, and it does not claim to catch every output-correct rewrite.
    const shapes = [
      {
        label: "48,000-comment, comment-dense body",
        input: "<!-- abc def -->".repeat(48_000),
      },
      {
        // The dimension the first two shapes cannot see: **RETAINED** content -- text that
        // survives stripping. Both of those are pure comment and strip to ZERO bytes
        // (measured: 768,000 -> 0 and 1,000,005 -> 0), so a scanner whose cost scales with
        // what it KEEPS is invisible at any size, however large the input or however much
        // text sits inside the comments. An earlier version of this file tried to close that
        // by putting words inside the comments; that changed nothing, because the comments
        // are still removed. This shape interleaves retained text with comments, so the
        // stripped output is ~64KB rather than empty.
        label: "interleaved: ~65KB input retaining ~64KB after stripping",
        input: `${"lorem ipsum dolor sit amet ".repeat(12)}<!-- c -->`.repeat(
          200,
        ),
      },
      {
        label: "single ~1MB comment",
        input: `<!-- ${"a".repeat(1_000_000)} -->`,
      },
    ];

    for (const { label, input } of shapes) {
      const start = process.hrtime.bigint();
      stripComments(input);
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

      assert.ok(
        elapsedMs < 4_000,
        `stripComments took ${elapsedMs.toFixed(1)}ms on the ${label} ` +
          "(expected low single-digit ms) — something is re-scanning more " +
          "than it should",
      );
    }
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
      // The restored source ban belongs here because it has ALREADY been deleted once --
      // that deletion is the regression this pull request exists to repair. Without this
      // entry, deleting it again leaves the suite 82/82 green and nothing notices.
      "HIGH (restored) — refuses to call `.replace()` inside stripComments' own source, the literal CodeQL-alert-#4 shape an output oracle cannot see",
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

  it("an unrelated, unticked item is not misclassified as the review item just because its own trailing note mentions review words — found adversarially, round 7", () => {
    // The mirror image of the presence-check finding: `REVIEW_ITEM` used to
    // be matched against the whole normalised line here too, so an ordinary
    // unticked item whose trailing commentary happens to say "security
    // review" in passing would have been wrongly forced into the
    // unconditional BLOCKER branch (which cannot be excused by n/a at all)
    // instead of being treated as the ordinary item it is — one that CAN be
    // marked n/a with a reason.
    assert.deepEqual(
      checklistProblems(
        "### Backend change\n\n- [ ] pnpm lint clean — n/a, security review notes tracked in issue #12\n",
      ),
      [],
    );
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
    // satisfying it. What must not happen is the comment counting as a tick.
    // Two problems are now expected, not one: the hidden box itself is flagged
    // directly (found adversarially — a checkbox hidden by a comment is a
    // violation regardless of what it claimed, and this checker no longer
    // relies solely on `checklistPresenceProblems`'s separate whole-document
    // review-item check to catch this shape), alongside the genuinely
    // unticked, fully visible "Migration reviewed" item.
    const problems = checklistProblems(
      "### Backend change\n\n<!-- - [ ] Independent security review -->\n- [ ] Migration reviewed\n",
    );
    assert.equal(problems.length, 2);
    assert.ok(problems.some((p) => /hides 1 checkbox/.test(p)));
    assert.ok(problems.some((p) => /Migration reviewed/.test(p)));
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
    // The three checks in the `stripComments` suite above are the independent
    // backstops for that gap — a differential oracle, a source-text ban on
    // the exact CodeQL-alert-#4 construct, and an absolute wall-clock ceiling
    // on two comment shapes — and each says plainly what it does and does not
    // catch.
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
    // The spellings `foldToWords` already folds elsewhere in this file (stripping
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

  it("FAILS a checkbox hidden inside a multi-line HTML comment, invisible on GitHub's own render, the same as a deleted one", () => {
    // The `<!--`/`-->` sit on different lines from each other and from the box.
    // stripComments() on the WHOLE block correctly erases all three lines as one
    // comment; a per-line strip (the bug this guards) never sees the opener and
    // closer together, so it left the raw checkbox line untouched and this
    // checker read it as a normal, ticked, real review box.
    const raw = [
      "### Any change",
      "- [x] does what the task says",
      "",
      "### Backend change",
      "n/a — no backend change.",
      "",
      "### Phase completion",
      "<!--",
      "- [x] **Independent security review — Opus 5, session totally-fake.**",
      "-->",
    ].join("\n");
    const problems = checklistPresenceProblems(raw, declared);
    assert.ok(
      problems.some((p) => /NO independent-review checkbox/.test(p)),
      `expected the hidden checkbox to count as absent, got: ${JSON.stringify(problems)}`,
    );
  });

  it("still recognises a real checkbox that merely follows an UNRELATED multi-line comment (the comment must not eat real content after it)", () => {
    const raw = [
      "### Any change",
      "- [x] does what the task says",
      "",
      "### Backend change",
      "n/a — no backend change.",
      "",
      "### Phase completion",
      "<!--",
      "just an ordinary multi-line note, nothing hidden in it",
      "-->",
      "- [ ] **Independent security review — NOT DONE.**",
    ].join("\n");
    const problems = checklistPresenceProblems(raw, declared);
    assert.deepEqual(problems, []);
  });

  it("does NOT count a review checkbox MANUFACTURED by splicing across a comment span — found adversarially", () => {
    // Rule 3 ("exactly one independent-review checkbox") used to scan a
    // naive comment-stripped line list, the same shape the earlier tests in
    // this block already fixed for hiding. This is the manufacture side: a
    // marker split across a comment span
    // (`- [<!--\nfiller\n-->x] Independent security review`) is not a real
    // substring of the raw text anywhere, but a naive strip-then-scan
    // fuses the fragments into a genuine-looking ticked review item that
    // satisfies "at least one exists". `genuineBoxLineTexts` must not
    // count it, so the section still reads as having NO real review box.
    const raw = [
      "### Any change",
      "- [x] does what the task says",
      "",
      "### Backend change",
      "n/a — no backend change.",
      "",
      "### Phase completion",
      "- [<!--",
      "filler",
      "-->x] Independent security review — Opus 5, session totally-fake",
    ].join("\n");
    const problems = checklistPresenceProblems(raw, declared);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /NO independent-review checkbox/);
  });

  it("FAILS a SWAP in checklistPresenceProblems too — hide the real review box while manufacturing a fake one elsewhere", () => {
    // The combination that defeats any scalar count comparison: hide the
    // genuine review checkbox entirely inside a comment (so rule 3's naive
    // scan would see zero) while splice-manufacturing a fake one that reads
    // as ticked in a DIFFERENT block. A naive implementation counting only
    // "how many checkbox-shaped lines match REVIEW_ITEM" could land on
    // exactly 1 either way and never notice the swap. genuineBoxLineTexts
    // must exclude the manufactured line specifically, leaving zero genuine
    // review items — not one.
    const raw = [
      "### Any change",
      "- [x] does what the task says",
      "",
      "### Backend change",
      "<!-- - [ ] Independent security review — the real, hidden item -->",
      "",
      "### Phase completion",
      "- [<!--",
      "filler",
      "-->x] Independent security review — Opus 5, session totally-fake",
    ].join("\n");
    const problems = checklistPresenceProblems(raw, declared);
    assert.ok(
      problems.some((p) => /NO independent-review checkbox/.test(p)),
      `expected zero genuine review items despite the swap, got: ${JSON.stringify(problems)}`,
    );
  });

  it("does NOT count a review checkbox whose marker is genuine but whose LABEL is spliced across a comment — found adversarially, round 6", () => {
    // Every prior finding in this block left the marker itself untouched and
    // spliced the CHECKBOX SYNTAX (`[x]`). This one leaves `- [x]` completely
    // intact and splices the WORDING that follows it instead:
    // `- [x] Independent<!--\nzzz\n--> security review`. A marker-only
    // genuineness check (contiguity of just `- [x]`) waves this through as a
    // real, ticked review item, because the marker really is one unbroken
    // run of raw characters — only what comes after it was spliced. Checking
    // the line's wording span too is what catches it.
    const raw = [
      "### Any change",
      "- [x] does what the task says",
      "",
      "### Backend change",
      "n/a — no backend change.",
      "",
      "### Phase completion",
      "- [x] Independent<!--",
      "zzz",
      "--> security review — Opus 5, real",
    ].join("\n");
    const problems = checklistPresenceProblems(raw, declared);
    assert.ok(
      problems.some((p) => /NO independent-review checkbox/.test(p)),
      `expected the spliced-label item not to count as a genuine review box, got: ${JSON.stringify(problems)}`,
    );
  });

  it("does NOT count an unrelated, genuine, ticked item as the review box just because its TRAILING commentary mentions review words — found adversarially, round 7", () => {
    // No comment or splice trickery at all this time. `REVIEW_ITEM` used to
    // be matched against the WHOLE normalised line, so a completely honest,
    // ticked, unrelated item whose own trailing note happens to say
    // "security review" in passing satisfied it — a sentence plausible
    // enough to write by accident, let alone on purpose. `itemSubject`
    // restricts the match to what the item's own text, before its
    // `ITEM_SEPARATOR`, actually claims to BE — "pnpm lint clean" here, not
    // the parenthetical that follows it.
    const raw = [
      "### Any change",
      "- [x] pnpm lint clean — see security review notes in issue #12 (unrelated)",
      "",
      "### Backend change",
      "n/a — no backend change.",
      "",
      "### Phase completion",
      "- [x] pnpm test:ci-scripts green",
    ].join("\n");
    const problems = checklistPresenceProblems(raw, declared);
    assert.ok(
      problems.some((p) => /NO independent-review checkbox/.test(p)),
      `expected the decoy mention not to count as the review box, got: ${JSON.stringify(problems)}`,
    );
  });

  it("does NOT count a review box cushioned by real whitespace on only ONE side of a splicing comment — found adversarially, round 7", () => {
    // Checking each span's own interior (round 6's fix) is not enough: a
    // comment can touch one span's OWN boundary directly, with cushioning
    // appearing only on the far side, and neither span's interior check
    // ever looks at that specific transition. Two mirrored shapes, both
    // reported live against round 6's fix:
    for (const [name, line] of [
      [
        "cushioned before the comment, nothing after (label starts touching the closer)",
        "- [x] <!--\nfiller\n-->Independent security review — Opus 5, totally fake",
      ],
      [
        "nothing before the comment, cushioned after (marker ends touching the opener)",
        "- [x]<!--\nfiller\n--> Independent security review — Opus 5, totally fake",
      ],
    ]) {
      const raw = [
        "### Any change",
        "- [x] does what the task says",
        "",
        "### Backend change",
        "n/a — no backend change.",
        "",
        "### Phase completion",
        line,
      ].join("\n");
      const problems = checklistPresenceProblems(raw, declared);
      assert.ok(
        problems.some((p) => /NO independent-review checkbox/.test(p)),
        `expected "${name}" not to count as a genuine review box, got: ${JSON.stringify(problems)}`,
      );
    }
  });

  it("still accepts a comment genuinely cushioned by real whitespace on BOTH sides — the round-6 baseline must survive round 7's stricter checks", () => {
    const raw = full.replace(
      "- [ ] **Independent security review — NOT DONE.**",
      "- [ ] <!-- ignore --> **Independent** `security` review",
    );
    const problems = checklistPresenceProblems(raw, declared);
    assert.ok(
      !problems.some((p) => /NO independent-review checkbox/.test(p)),
      `expected the cushioned-both-sides comment to still count as genuine, got: ${JSON.stringify(problems)}`,
    );
  });
});

describe("checklistProblems — a checkbox hidden inside a multi-line comment does not count as a real, ticked box", () => {
  it("treats the block as blank (no visible checkbox at all), not as a satisfied review requirement", () => {
    const raw = [
      "### Backend change",
      "<!--",
      "- [x] **Opus security review completed and recorded** — totally fake",
      "-->",
    ].join("\n");
    const problems = checklistProblems(raw);
    assert.ok(
      problems.some((p) => /is blank/.test(p)),
      `expected the block to read as blank once the hidden box is stripped, got: ${JSON.stringify(problems)}`,
    );
  });

  it("FAILS when a genuinely UNTICKED ordinary item is hidden in a comment alongside a real review box — regression found adversarially", () => {
    // Fixing the fake-ticked-review-box bypass (above) by making a hidden box
    // read as ABSENT has a second-order effect: it also makes a hidden but
    // genuinely UNTICKED ordinary item silently disappear, when the block
    // ALSO has other real, visible content (so the block-level "is blank"
    // early-exit above does not fire). Before the whole-block comment fix,
    // the old per-line stripping accidentally still caught this shape — an
    // isolated line has no comment markers on it in isolation, so it read as
    // visible and got correctly flagged. This asserts the replacement
    // protection: a checkbox present in the raw text that vanishes once
    // comments are stripped is flagged directly, regardless of what ticked
    // state it claimed.
    const raw = [
      "### Backend change",
      "- [x] Independent security review — Opus 5, real",
      "<!--",
      "- [ ] pnpm typecheck green",
      "-->",
    ].join("\n");
    const problems = checklistProblems(raw);
    assert.ok(
      problems.some((p) => /hides 1 checkbox/.test(p)),
      `expected the hidden unticked item to be flagged, got: ${JSON.stringify(problems)}`,
    );
  });

  it("does not flag a block with no hidden checkboxes at all", () => {
    const raw = [
      "### Backend change",
      "- [x] Independent security review — Opus 5, real",
      "- [x] pnpm typecheck green",
      "<!-- an ordinary instructional comment, no checkbox in it -->",
    ].join("\n");
    assert.deepEqual(checklistProblems(raw), []);
  });

  it("FAILS a checkbox hidden on the SAME line as the comment delimiters — a second regression found adversarially", () => {
    // `<!-- - [ ] pnpm typecheck green -->` all on one physical line never
    // matches the line-ANCHORED `ANY_BOX` on that raw line at all — the line
    // starts with `<!--`, not the marker — so a per-LINE raw-vs-stripped
    // comparison sees 0 either way and misses it entirely, even though
    // `stripComments` erases it just as completely as the separate-line
    // shape the first regression test covers. Counting marker occurrences as
    // SUBSTRINGS anywhere in the block's text, not as a count of matching
    // lines, is what catches this shape too.
    const raw = [
      "### Backend change",
      "- [x] Independent security review — Opus 5, real",
      "<!-- - [ ] pnpm typecheck green -->",
    ].join("\n");
    const problems = checklistProblems(raw);
    assert.ok(
      problems.some((p) => /hides 1 checkbox/.test(p)),
      `expected the same-line hidden item to be flagged, got: ${JSON.stringify(problems)}`,
    );
  });

  it("FAILS a checkbox MANUFACTURED by splicing across a comment span — a third regression found adversarially", () => {
    // The mirror image of the previous two: `stripComments` deletes a
    // comment by directly concatenating what comes before it to what comes
    // after — the exact splice-adjacency hazard its own docstring already
    // names for `<!--` reconstitution (CodeQL alert #4), here applied to
    // checkbox syntax instead. `- [<!--\nfiller\n-->x] Independent security
    // review` contains the complete `- [x]` substring NOWHERE in the raw
    // text (the raw fragments are `- [` and `x] ...`, never adjacent), but
    // stripping the comment splices them into a genuine, complete,
    // fake-ticked checkbox that did not exist before.
    const raw = [
      "### Backend change",
      "- [<!--",
      "genuinely blank filler",
      "-->x] Independent security review — Opus 5, session totally-fake",
    ].join("\n");
    const problems = checklistProblems(raw);
    assert.ok(
      problems.some((p) =>
        /manufacturing one that was never in the raw text/.test(p),
      ),
      `expected the manufactured checkbox to be flagged, got: ${JSON.stringify(problems)}`,
    );
  });

  it("FAILS a SWAP — hide one real checkbox while manufacturing a different one, netting raw and visible counts to the SAME total", () => {
    // The structural ceiling of every prior fix in this describe block: a
    // scalar comparison between a raw count and a visible count (`>`, `!==`,
    // however phrased) is defeated once hide-and-manufacture are combined in
    // one block. Hide one real, unticked, throwaway checkbox entirely inside
    // a comment (raw count includes it, visible count does not) while
    // splice-manufacturing a different fake-ticked one elsewhere in the same
    // block (visible count includes it, raw count does not) — the two
    // changes cancel: raw and visible totals land on the identical number,
    // and any inequality over just those two totals reads "nothing
    // happened." Closing this needed per-match genuineness
    // (`genuineBoxCount`), not a smarter arithmetic condition — this test
    // exists specifically because three prior "smarter conditions" in a row
    // were each defeated by the next round of adversarial review.
    const raw = [
      "### Backend change",
      "<!-- - [ ] throwaway to balance the arithmetic -->",
      "- [<!--",
      "filler",
      "-->x] Independent security review — Opus 5, session totally-fake",
    ].join("\n");
    const problems = checklistProblems(raw);
    assert.ok(
      problems.some((p) => /hides 1 checkbox/.test(p)),
      `expected the hidden throwaway to be flagged, got: ${JSON.stringify(problems)}`,
    );
    assert.ok(
      problems.some((p) =>
        /manufacturing one that was never in the raw text/.test(p),
      ),
      `expected the manufactured review box to be flagged, got: ${JSON.stringify(problems)}`,
    );
  });

  it("FAILS a genuine, unticked ordinary item whose n/a EXCUSE is spliced across a comment — found adversarially, round 6", () => {
    // The marker `- [ ]` is completely untouched here — only the excuse text
    // after it is spliced: `n/a<!--\nfiller\n-->: a fabricated excuse`. A
    // marker-only genuineness check waves the line through as genuine (the
    // marker really is contiguous), and `itemMarkedNotApplicable` then reads
    // the spliced excuse as a real one — silently closing a genuinely
    // unticked, unresolved item with zero problems reported. Checking the
    // wording span too means this line is not genuine, so it is reported the
    // same way a hidden-and-manufactured box is: present in the raw text,
    // absent from the genuine count.
    const raw = [
      "### Backend change",
      "- [ ] pnpm typecheck green — n/a<!--",
      "filler",
      "-->: a fabricated excuse",
    ].join("\n");
    const problems = checklistProblems(raw);
    assert.ok(
      problems.some((p) => /hides 1 checkbox/.test(p)),
      `expected the spliced-excuse item to be flagged as non-genuine, got: ${JSON.stringify(problems)}`,
    );
    assert.ok(
      problems.some((p) =>
        /manufacturing one that was never in the raw text/.test(p),
      ),
      `expected the spliced-excuse item to be flagged as manufactured too, got: ${JSON.stringify(problems)}`,
    );
  });
});

describe("round 9 — findings from the final Opus security review, no comment or splice trickery needed at all", () => {
  it("F1: an anchored, ticked, unrelated marker cannot smuggle a SECOND, unticked, embedded review checkbox past the gate", () => {
    // `- [x] Docs updated + [ ] Independent security review` is plain ASCII,
    // nothing spliced. The old unanchored marker search identified the
    // EMBEDDED `[ ]` as "the" checkbox for this line — genuine (no comment
    // touched it) — while the anchored ticked-state check (`OPEN_BOX`) only
    // ever looked at the line's own START, which is ticked (`- [x]`). The
    // unticked review item was never separately examined at all.
    const raw = [
      "### Any change",
      "- [x] `pnpm lint` clean",
      "- [x] `pnpm typecheck` green",
      "- [x] Tests added and green",
      "- [x] Docs updated + [ ] Independent security review",
    ].join("\n");
    const declared = ["Any change"];
    assert.ok(
      checklistPresenceProblems(raw, declared).length > 0,
      "expected the embedded, unticked review checkbox not to be silently accepted",
    );
    assert.ok(
      checklistProblems(raw).length > 0,
      "expected checklistProblems to flag this block too",
    );
  });

  it("F1 (barer): a checkbox with no anchored marker at its own line-start is not a checklist item just because a marker-shaped substring appears somewhere in its prose", () => {
    const raw =
      "### Backend change\n\nIndependent security review + [ ] pending\n";
    const declared = ["Backend change"];
    assert.ok(
      checklistPresenceProblems(raw, declared).length > 0,
      "expected an un-anchored embedded marker not to count as a genuine review checkbox",
    );
  });

  it("F2: text BEFORE an anchored-but-shifted marker is not exempt from genuineness checking just because it precedes the line's only recognised marker", () => {
    // With the anchored-marker fix, this line has NO anchored marker at all
    // (it starts with "Indep", a letter) — so it falls into the whole-line
    // contiguity check, which correctly catches the "Indep"+"endent" splice.
    const raw = [
      "### Backend change",
      "Indep<!--",
      "FILLER",
      "-->endent security review + [x] noted",
    ].join("\n");
    assert.ok(
      checklistProblems(raw).length > 0,
      "expected the pre-marker splice to be caught, not silently accepted",
    );
  });

  it("F3: a declared heading hidden entirely inside its own multi-line HTML comment reads as MISSING, the same as if it had been deleted", () => {
    const raw = [
      "### Any change",
      "- [x] Independent security review",
      "",
      "<!--",
      "### Backend change",
      "-->",
    ].join("\n");
    const declared = ["Any change", "Backend change"];
    const problems = checklistPresenceProblems(raw, declared);
    assert.ok(
      problems.some((p) => /"Backend change" is MISSING/.test(p)),
      `expected the comment-hidden heading to read as missing, got: ${JSON.stringify(problems)}`,
    );
  });

  it("still recognises a genuinely visible declared heading whose OWN content happens to contain a comment", () => {
    // Non-vacuity check on F3's fix in the other direction: `headingBlocks`
    // must not start rejecting ordinary, visible headings.
    const raw = [
      "### Any change",
      "- [x] Independent security review",
      "",
      "### Backend change",
      "n/a — <!-- note --> no backend change",
    ].join("\n");
    const declared = ["Any change", "Backend change"];
    assert.deepEqual(checklistPresenceProblems(raw, declared), []);
  });

  it("correctness (not a bypass): a separator with nothing before it falls back to the whole wording, so a real review item is not misread as absent", () => {
    // Found by ordinary review: an item-subject split on `ITEM_SEPARATOR`
    // that lands immediately after the marker used to fold to an EMPTY
    // subject, which does not match `REVIEW_ITEM` — a false BLOCKER on an
    // otherwise genuine, ticked entry.
    const raw = [
      "### Any change",
      "- [x] — Opus security review completed and recorded",
    ].join("\n");
    assert.deepEqual(checklistPresenceProblems(raw, ["Any change"]), []);
  });
});

describe("round 10 — findings from ordinary + adversarial review of round 9's fix", () => {
  const declared = ["Any change", "Backend change", "Phase completion"];
  const fullBody = (phaseItem) =>
    [
      "### Any change",
      "- [x] does what the task says",
      "",
      "### Backend change",
      "n/a — no backend change.",
      "",
      "### Phase completion",
      phaseItem,
    ].join("\n");

  it("CRITICAL: content before the FIRST declared heading is not silently dropped — found adversarially", () => {
    // An unticked, explicitly "NOT DONE" independent-review line placed
    // before the first `### ` heading used to belong to no block at all
    // (`headingBlocks` started with `current = null` and only ever
    // attached a line when a block was already open) — invisible to both
    // checkers, no comment or splice needed, as long as some LATER,
    // properly-formed block satisfied the presence/state rules on its own.
    const raw = [
      "- [ ] Independent security review — NOT DONE, ran out of time",
      "",
      fullBody("- [x] Independent security review — Opus 5, 2026-09-15"),
    ].join("\n");
    assert.ok(
      checklistPresenceProblems(raw, declared).length > 0,
      "expected orphaned content before the first heading to be flagged",
    );
    assert.ok(
      checklistProblems(raw).length > 0,
      "expected checklistProblems to flag it too",
    );
  });

  it("still accepts the template's own legitimate instructional comment in that exact position", () => {
    const raw = [
      "<!--",
      "Paste the relevant checklist(s) from docs/04-engineering/definition-of-done.md below each",
      "heading and tick them.",
      "-->",
      "",
      fullBody("- [x] Independent security review — Opus 5, 2026-09-15"),
    ].join("\n");
    assert.deepEqual(checklistPresenceProblems(raw, declared), []);
    assert.deepEqual(checklistProblems(raw), []);
  });

  it("correctness (not a bypass): a heading with a harmless, self-contained TRAILING comment on its own line is not misread as missing", () => {
    // Found by both ordinary and adversarial review of round 9's fix: an
    // earlier version of the heading-visibility check required the ENTIRE
    // raw heading line to survive comment-stripping verbatim, so
    // `### Backend change <!-- delete if not applicable -->` — a harmless,
    // common authoring shape, comment fully self-contained on the heading's
    // own line — was rejected as "not a heading", reporting the whole
    // section MISSING even though a human (or GitHub's own render) sees it
    // exactly as declared.
    const raw = [
      "### Any change",
      "- [x] does what the task says",
      "",
      "### Backend change <!-- delete if not applicable -->",
      "n/a — no backend change.",
      "",
      "### Phase completion",
      "- [x] Independent security review — Opus 5, 2026-09-15",
    ].join("\n");
    assert.deepEqual(checklistPresenceProblems(raw, declared), []);
  });

  it('correctness (not a bypass): a heading with a harmless, self-contained comment BETWEEN "###" and its name is not misread as missing', () => {
    // Found by the final Opus security review's own LOW note: `HEADING_MARKER`
    // used to include a trailing `\s+`, folding the whitespace GAP between
    // "###" and the name into "the marker" itself. That made the marker-span
    // contiguity check reject a comment cushioned by real whitespace on BOTH
    // sides of that gap (`### <!-- note --> Backend change`) — a shape the
    // docstring already claimed was accepted (matching the checklist-item
    // version of this same check), but wasn't. Leaving the gap out of the
    // marker — the same as the checkbox marker already does, ending cleanly
    // at `]` rather than consuming trailing whitespace — fixes it.
    const raw = [
      "### Any change",
      "- [x] does what the task says",
      "",
      "### <!-- note --> Backend change",
      "n/a — no backend change.",
      "",
      "### Phase completion",
      "- [x] Independent security review — Opus 5, 2026-09-15",
    ].join("\n");
    assert.deepEqual(checklistPresenceProblems(raw, declared), []);
  });

  it("MEDIUM: duplicate declared headings no longer let checklistPresenceProblems silently drop an earlier, genuinely unticked review item", () => {
    // `present` (a Map keyed by normalised heading name) kept only the LAST
    // of two same-named blocks, so rule 3 never saw a review item living in
    // the discarded first occurrence — while `checklistProblems`, which has
    // no such dedup, still enforced it, meaning the two checkers could
    // disagree about whether a genuine, unresolved review item exists.
    const raw = [
      "### Any change",
      "- [x] does what the task says",
      "",
      "### Phase completion",
      "- [ ] Independent security review — NOT DONE",
      "",
      "### Phase completion",
      "- [x] Independent security review — Opus 5, 2026-09-15",
    ].join("\n");
    const presence = checklistPresenceProblems(raw, [
      "Any change",
      "Phase completion",
    ]);
    assert.ok(
      presence.some((p) => /2 independent-review checkboxes/.test(p)),
      `expected both occurrences to be counted, got: ${JSON.stringify(presence)}`,
    );
  });

  it("MEDIUM: duplicate declared headings no longer let rule 2 ('at least one block has a checkbox') miss a genuine checkbox in a discarded earlier occurrence", () => {
    // The other half of the same fix — found by ordinary review after the
    // rule-3 half above landed: rule 2 ALSO iterated the deduplicated
    // `present` map, so a genuine, ticked checkbox living in the discarded
    // FIRST "Phase completion" occurrence was invisible to it, and the
    // section was wrongly reported as having no checkbox at all — a false
    // positive (fail-safe direction, not a bypass), but the exact same root
    // cause left half-fixed.
    const raw = [
      "### Phase completion",
      "- [x] Independent security review",
      "",
      "### Phase completion",
      "n/a — nothing else to add",
    ].join("\n");
    assert.deepEqual(checklistPresenceProblems(raw, ["Phase completion"]), []);
  });

  it("correctness (not a bypass): the hides/manufactured diagnostics don't blame a comment when none is involved", () => {
    // Found by ordinary review: an embedded, plain-ASCII extra marker (no
    // comment anywhere) disqualifies a line the same way a hidden or
    // manufactured one does, but the old message text unconditionally told
    // the author to "restructure the comment" — pointing at something that
    // does not exist in this exact input.
    const raw =
      "### Any change\n\n- [x] Docs updated + [ ] Independent security review\n";
    const problems = checklistProblems(raw);
    assert.ok(
      !problems.some((p) => /restructure the comment/i.test(p)),
      `expected no message to blame a comment when none exists, got: ${JSON.stringify(problems)}`,
    );
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
