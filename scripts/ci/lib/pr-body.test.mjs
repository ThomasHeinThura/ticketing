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
import { describe, it } from "node:test";
import {
  checklistProblems,
  contentOf,
  field,
  markedNotApplicable,
  normaliseHeading,
  sections,
  stripComments,
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
    // opener per pass. Measured: ~0.35 ms at 8k chars, ~12.8 ms at 512k.
    const adversarial = `${"<!".repeat(128_000)}<!-- -->${"--".repeat(128_000)}`;

    const startedAt = performance.now();
    const stripped = stripComments(adversarial);
    const elapsedMs = performance.now() - startedAt;

    assert.ok(!stripped.includes("<!--"));
    assert.ok(
      elapsedMs < 2_000,
      `stripComments took ${elapsedMs.toFixed(0)}ms — quadratic behaviour is back`,
    );
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
    const time = (n) => {
      const body = `### B\n\n${`- [ ] item <!-- ${"a".repeat(n)} -->\n`.repeat(40)}`;
      const t = process.hrtime.bigint();
      checklistProblems(body);
      return Number(process.hrtime.bigint() - t) / 1e6;
    };
    time(2_000);
    const small = Math.max(time(20_000), 0.5);
    const large = time(160_000);
    // 8x the input must not cost anywhere near 64x the time.
    assert.ok(large < small * 24, `non-linear: ${small}ms -> ${large}ms`);
  });
});
