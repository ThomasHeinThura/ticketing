import fs from "node:fs/promises";

/**
 * Test-only instrumentation for `stripComments`' complexity, not its behaviour.
 *
 * `pr-body.test.mjs` proves this scanner stays O(n) — see the docstring below for why
 * that matters — by counting the characters this loop actually visits, rather than
 * timing it with `performance.now()`/`hrtime`. Wall-clock scales with whatever ELSE the
 * CI runner is doing at that instant, not with the algorithm's real work: a ratio
 * measured off a ~1.3ms baseline (`large < small * 24`) reproduced two failures in four
 * concurrent `pnpm test:ci-scripts` runs under ordinary machine load, both landing on
 * that exact assertion, because a single scheduler preemption lands more easily inside a
 * LONGER measurement window, not less. A step counter has no such window: it counts the
 * same thing whether the runner is idle or saturated.
 *
 * Deliberately always-on rather than gated behind a test flag — a conditional the
 * production path never takes is itself untested, and one integer increment per
 * character is immaterial next to the string work already happening. If a future rewrite
 * of `stripComments` stops updating this counter, the reader below falls back to a flat
 * zero, and the tests that depend on it treat "zero regardless of input size" as a
 * failure — the same self-guard this file already uses for the reconstitution fuzz
 * below ("if this reaches zero the fuzz has stopped generating the shape the fix is
 * about").
 */
let stripCommentsSteps = 0;

/** Test-only: zero the step counter before a measurement. */
export function resetStripCommentsStepsForTests() {
  stripCommentsSteps = 0;
}

/** Test-only: characters `stripComments` has visited since the last reset. */
export function stripCommentsStepsForTests() {
  return stripCommentsSteps;
}

/**
 * Remove HTML comments — the template's instructions are not content.
 *
 * Scanned by hand rather than with `markdown.replace(/<!--[\s\S]*?-->/g, "")`,
 * which CodeQL flagged as `js/incomplete-multi-character-sanitization` (HIGH,
 * alert #4) and which was genuinely incomplete: one pass can *reconstitute* the
 * very sequence it removes.
 *
 *   "<!<!--x-->-- still a comment opener"  ->  "<!-- still a comment opener"
 *   "<!<!-- -->--"                         ->  "<!--"
 *
 * The `<!` before the comment and the `--` after it are separated by the match,
 * so deleting the match joins them into a fresh `<!--`. That is a real gate
 * bypass here, not a theoretical one: an author could put such a sequence in a
 * required section, GitHub would render the reconstituted comment as invisible,
 * and this checker would count it as filled-in content.
 *
 * The fix is to look for the opener in the OUTPUT rather than the input, which
 * is exactly what "reconstituted" means. Every character is appended, and if
 * appending completes a `<!--` in the output, that opener is dropped and the
 * input is skipped past the next `-->`. Both cursors only move forward, so this
 * is O(n) — no fixed-point loop, which would have been quadratic on a nested
 * body and would have traded one scanner finding for another.
 *
 * One deliberate behaviour change: an unterminated `<!--` now swallows the rest
 * of the input instead of being left as content. That is the fail-closed
 * direction for a gate — a section whose content hides behind an unclosed
 * comment reads as empty and the check fails, rather than counting text that a
 * reviewer cannot see.
 */
export function stripComments(markdown) {
  const out = [];
  let i = 0;

  // Charges the step counter with what THIS search actually scanned, not with
  // how far the cursor ends up moving — so a future change that calls this
  // more than once per comment (redundant re-scanning, the shape a regression
  // is likely to take) is charged for every one of those scans, not just the
  // net distance covered. That is what makes the counter a faithful proxy for
  // real work rather than a restatement of "the cursor moved forward".
  const findClose = (from) => {
    const close = markdown.indexOf("-->", from);
    const reached = close === -1 ? markdown.length : close;
    stripCommentsSteps += reached - from;
    return close;
  };

  while (i < markdown.length) {
    out.push(markdown[i]);
    i += 1;
    stripCommentsSteps += 1;

    const end = out.length;
    if (
      end >= 4 &&
      out[end - 4] === "<" &&
      out[end - 3] === "!" &&
      out[end - 2] === "-" &&
      out[end - 1] === "-"
    ) {
      out.length = end - 4;
      const close = findClose(i);
      if (close !== -1) stripCommentsSteps += 3; // the closing marker itself
      i = close === -1 ? markdown.length : close + 3;
    }
  }

  return out.join("");
}

/**
 * Like `stripComments`, but keeps each surviving character's ORIGINAL index
 * in `markdown` alongside it, so a caller can tell whether a run of the
 * stripped output is genuinely contiguous in the raw source or was spliced
 * together across a removed comment span.
 *
 * Exists because a scalar count comparison between raw and stripped text —
 * however the count is taken — cannot close this class of defect. Three
 * rounds of independent review on this exact file found, in order: a
 * checkbox hidden by a comment (raw count too high), a checkbox manufactured
 * by a comment splicing two fragments together (stripped count too high),
 * and then the combination of both in one block — hide one checkbox, splice-
 * manufacture a different one — which nets the SAME totals as if nothing
 * happened, defeating any inequality over the two counts, however it is
 * phrased. Comparing counts is comparing quantities; the defect is about
 * IDENTITY — whether a specific span of visible text actually came from one
 * unbroken run of the author's own words, not whether the tally balances.
 */
function stripCommentsWithPositions(markdown) {
  const out = [];
  const positions = [];
  let i = 0;

  while (i < markdown.length) {
    out.push(markdown[i]);
    positions.push(i);
    i += 1;

    const end = out.length;
    if (
      end >= 4 &&
      out[end - 4] === "<" &&
      out[end - 3] === "!" &&
      out[end - 2] === "-" &&
      out[end - 1] === "-"
    ) {
      out.length = end - 4;
      positions.length = end - 4;
      const close = markdown.indexOf("-->", i);
      i = close === -1 ? markdown.length : close + 3;
    }
  }

  return { text: out.join(""), positions };
}

/**
 * Every LINE of `body`'s VISIBLE (comment-stripped) text, paired with
 * whether the WHOLE line is genuine — every character on it traces to one
 * unbroken run of the raw source, with no comment spliced out of any part
 * of it. Line-level, not marker-level: found adversarially, after an
 * earlier version of this check verified only the checkbox MARKER's own
 * five characters. A genuine, untouched marker with its LABEL TEXT spliced
 * in from elsewhere (`- [x] Independent<!--\nfiller\n--> security review`)
 * has a marker that is perfectly contiguous — the splice sits entirely
 * after it — so a marker-only check waved it through as a real, ticked
 * review item. Checking the ENTIRE line closes that: the splice still sits
 * somewhere within the line's own span, so the line as a whole is not
 * contiguous, and nothing built on "is this specific line trustworthy"
 * mistakes it for one that is.
 */
function genuineLineFlags(body) {
  const { text, positions } = stripCommentsWithPositions(body);
  const lines = text.split("\n");
  const flags = [];
  let lineStart = 0;

  // Is every character in [from, to) consecutive in the RAW source — no
  // comment removed from within this exact span, regardless of what sits
  // outside it?
  const contiguous = (from, to) => {
    for (let k = from + 1; k < to; k += 1) {
      if (positions[k] !== positions[k - 1] + 1) return false;
    }
    return true;
  };

  for (const line of lines) {
    const lineEnd = lineStart + line.length; // exclusive, before the "\n"
    const marker = ANY_BOX_ANYWHERE.exec(line);
    ANY_BOX_ANYWHERE.lastIndex = 0; // it carries the "g" flag; reset for the next line

    if (!marker) {
      // No checkbox on this line — not what `genuineBoxLineTexts` looks at,
      // but keep the array aligned with `lines` regardless.
      flags.push(contiguous(lineStart, lineEnd));
    } else {
      // A self-contained comment sitting in the WHITESPACE between the marker
      // and the item's own wording changes nothing either side says — found
      // adversarially, after an earlier version of this check treated ANY
      // comment anywhere on the line as disqualifying, which also rejected
      // ordinary, harmless authoring (`- [ ] <!-- note --> Some item`). What
      // must never be trusted is a comment INSIDE the marker itself, or INSIDE
      // the wording that follows it — so two spans are checked, not one: the
      // marker's own characters, and the line's own wording from its first
      // non-whitespace character onward. A gap that falls only in the padding
      // between those two spans is exactly the shape a real author's own
      // spacing choice would leave, and is not evidence of anything spliced.
      const markerStart = lineStart + marker.index;
      const markerEnd = markerStart + marker[0].length;
      let wordingStart = markerEnd;
      while (wordingStart < lineEnd && /\s/.test(text[wordingStart])) {
        wordingStart += 1;
      }

      // Checking each span's OWN interior is not enough — found
      // adversarially, in two mirrored shapes:
      //
      // `- [x] <!--\nfiller\n-->Independent security review` cushions the
      // comment with a real space BEFORE it but nothing AFTER (the closer
      // lands directly on "I"). `contiguous(wordingStart, lineEnd)` alone
      // never compares `positions[wordingStart]` against what precedes it,
      // so this passed: everything FROM "I" onward really is one unbroken
      // run, even though "I" itself was smuggled in right across the
      // comment with no real character between it and the one genuine
      // space before it.
      //
      // `- [x]<!--\nfiller\n--> Independent security review` is the mirror:
      // nothing cushions the comment on the marker side at all, so it starts
      // immediately after "]". `contiguous(markerStart, markerEnd)` alone
      // never compares `positions[markerEnd]` against what precedes IT,
      // so this passed too, for the same reason from the other direction.
      //
      // Both are closed the same way: extend each span by the one boundary
      // character adjoining the gap, so the transition INTO the gap from the
      // marker and the transition OUT of the gap into the wording are both
      // checked, while the gap's own interior — wherever a comment is fully
      // cushioned by real whitespace on the side facing each span, the
      // accepted `- [ ] <!-- note --> Some item` shape — is still exempt.
      flags.push(
        contiguous(markerStart, Math.min(markerEnd + 1, lineEnd)) &&
          contiguous(wordingStart - 1, lineEnd),
      );
    }

    // Every path above must fall through to here — an early `continue`
    // previously skipped this on the no-marker branch, leaving `lineStart`
    // stuck at 0 for every line after the first and corrupting every
    // position check downstream of it.
    lineStart = lineEnd + 1;
  }
  return { lines, flags };
}

/**
 * How many checkbox markers appear on a GENUINE line of `body`'s visible
 * text — the ground truth `checklistProblems` and `checklistPresenceProblems`
 * check against, in place of a raw-vs-visible count comparison. Comparing
 * two totals cannot close this class of defect: three straight rounds of
 * independent review found, in order, a checkbox hidden by a comment (raw
 * count too high), one manufactured by a comment splicing two fragments
 * together (visible count too high), the combination of both in the same
 * block (the two changes cancel, so any inequality between the two totals
 * reads "nothing happened"), and finally a genuine marker whose
 * surrounding LABEL TEXT was itself spliced (no count anywhere is wrong,
 * because the marker was never touched — only what the line goes on to say
 * was). A per-LINE genuineness verdict is not a smarter comparison of the
 * same two numbers; it is a different question — does this specific line
 * trace to one unbroken run of the author's own words — and it is asked of
 * every line independently, so no combination of hiding and manufacturing
 * elsewhere in the block can make an answer here wrong.
 */
function genuineBoxCount(body) {
  return genuineBoxLineTexts(body).reduce(
    (sum, line) => sum + (line.match(ANY_BOX_ANYWHERE) ?? []).length,
    0,
  );
}

/**
 * The full text of every GENUINE line in `body`'s visible text that
 * contains at least one checkbox marker — so a caller can check the
 * item's whole wording (ticked state, `REVIEW_ITEM`, an `n/a` excuse)
 * against text that is guaranteed to be the author's own unbroken words,
 * never a fragment fused across a removed comment.
 */
function genuineBoxLineTexts(body) {
  const { lines, flags } = genuineLineFlags(body);
  const results = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (flags[i] && lines[i].match(ANY_BOX_ANYWHERE)) {
      results.push(lines[i]);
    }
  }
  return results;
}

/**
 * What the author actually wrote. The template's own scaffolding does not count: an
 * instruction comment, a bold field label with nothing after it, or a horizontal rule is
 * the template, not a filled-in section.
 */
/**
 * Characters that occupy no visual space but are not whitespace to `String.trim()`.
 * A section whose only content is one of these renders BLANK on GitHub and used to pass
 * the non-empty test (F13): U+200B ZERO WIDTH SPACE, U+200C/D the joiners, U+2060 WORD
 * JOINER, U+FEFF ZERO WIDTH NO-BREAK SPACE, U+00AD SOFT HYPHEN, U+180E MONGOLIAN VOWEL
 * SEPARATOR, plus the whole Cf (format) category, which covers the bidi controls.
 *
 * L6 — Cf was not enough. These render blank and are NOT format characters, so
 * `\\p{Cf}` never matched them: U+2800 BRAILLE PATTERN BLANK, U+3164 HANGUL FILLER,
 * U+115F/U+1160 the HANGUL CHOSEONG/JUNGSEONG FILLERS, U+FFA0 HALFWIDTH HANGUL FILLER,
 * U+17B4/U+17B5 the KHMER INHERENT VOWELS, and U+3000 IDEOGRAPHIC SPACE. A required
 * section containing only one of them looked filled in and rendered as nothing.
 *
 * Deliberately an explicit, closed list — structural and deterministic. No visual
 * similarity heuristic and no width guessing: a character is on the list because it was
 * reproduced rendering blank, not because it might.
 *
 * Applied ONLY when testing emptiness. Visible body content is never mutated by this —
 * the caller keeps the original text for its error messages.
 */
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00AD\u180E\p{Cf}⠀ㅤᅟᅠﾠ឴឵　]/gu;

/** True when `text` contains nothing a human would see. */
export function isBlank(text) {
  return contentOf(text) === "";
}

export function contentOf(markdown) {
  return stripComments(markdown)
    .split("\n")
    .filter((line) => !/^\s*\*\*[^*]+:\*\*\s*$/.test(line))
    .filter((line) => !/^\s*-{3,}\s*$/.test(line))
    .join("\n")
    .replace(INVISIBLE, "")
    .trim();
}

/** Compare headings without caring about dash flavour or case. */
export function normaliseHeading(heading) {
  return heading
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Split a pull-request body into its `##` sections.
 *
 * @param {string} markdown
 * @returns {Map<string, { heading: string, raw: string, text: string }>} keyed by normalised heading
 */
export function sections(markdown) {
  const found = new Map();
  const lines = markdown.split("\n");
  let heading = null;
  let buffer = [];

  const flush = () => {
    if (heading === null) {
      return;
    }
    const raw = buffer.join("\n");
    found.set(normaliseHeading(heading), {
      heading,
      raw,
      text: stripComments(raw).trim(),
      content: contentOf(raw),
    });
  };

  for (const line of lines) {
    const match = /^##\s+(.*\S)\s*$/.exec(line);
    if (match) {
      flush();
      heading = match[1];
      buffer = [];
      continue;
    }
    buffer.push(line);
  }
  flush();

  return found;
}

/** `**Model:** Opus 5` → `Opus 5`. */
export function field(text, label) {
  const pattern = new RegExp(`^\\s*\\*\\*${label}:\\*\\*\\s*(.*)$`, "im");
  const match = pattern.exec(text);
  return match ? match[1].trim() : "";
}

/** True when a section says "n/a" and gives a reason rather than just the two letters. */
export function markedNotApplicable(text) {
  if (!/\bn\/a\b/i.test(text)) {
    return false;
  }
  const remainder = text
    .replace(/\bn\/a\b/gi, "")
    .replace(/[\s.:—–-]+/g, " ")
    .trim();
  return remainder.length >= 12;
}

/** Read a pull-request body from a file, or from the GitHub Actions event payload. */
export async function loadBody({ bodyFile, eventPath }) {
  if (bodyFile) {
    return fs.readFile(bodyFile, "utf8");
  }
  if (eventPath) {
    const event = JSON.parse(await fs.readFile(eventPath, "utf8"));
    return event?.pull_request?.body ?? "";
  }
  return "";
}

/**
 * The pull request's OWN head SHA, from the event payload — not `HEAD`.
 *
 * **Why this exists.** GitHub checks a pull request out at `refs/pull/N/merge`, which is a
 * SYNTHETIC MERGE COMMIT of the branch into the base. So in CI `HEAD` is not any commit the
 * author pushed, and it has two parents: the base tip and the real branch head.
 *
 * That broke the security-review-note binding, and broke it in the worst direction — a
 * control that could never be satisfied. `commitsBetween` attributes a merge commit's paths
 * against EVERY parent (deliberately, see lib/git-baseline.mjs), so diffing the synthetic
 * merge against its BASE parent yields the branch's entire diff. Every one of those files
 * then reads as "landed after the reviewed head", and the note is declared stale no matter
 * what it says. Measured on PR #81: against the pushed branch head the range was
 * `outside=0`; against the synthetic merge it was `outside=4`, listing the branch's own
 * reviewed code.
 *
 * A gate that cannot be satisfied is not strict, it is broken: it produces a permanently red
 * required check, and a permanently red check is one nobody can distinguish from a real
 * finding. Hence: bind to the head the author actually pushed and the reviewer actually read.
 *
 * @returns {Promise<string | null>} the head SHA, or null when there is no payload (a local
 *   run, or a `push` event) — in which case the caller falls back to `HEAD`, which is
 *   correct there because `HEAD` really is the branch head.
 */
export async function loadPullRequestHead({ eventPath }) {
  if (!eventPath) {
    return null;
  }
  let event;
  try {
    event = JSON.parse(await fs.readFile(eventPath, "utf8"));
  } catch (error) {
    // Fail CLOSED. A payload we were told about but cannot read is not the same as no
    // payload: silently falling back to HEAD would bind the note to the merge ref again.
    throw new Error(
      `Could not read the event payload at ${eventPath}: ${error.message}. ` +
        "Refusing to fall back to HEAD, which in a pull-request checkout is a synthetic " +
        "merge commit and would mis-bind the security-review note.",
    );
  }
  const sha = event?.pull_request?.head?.sha;
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) {
    // A push event has no pull_request key at all, which is fine and returns null.
    // Null covers two shapes a caller must treat the SAME way, so they are not
    // distinguished: a `push` event, which has no `pull_request` key at all and is normal;
    // and a `pull_request` payload whose head SHA is missing or malformed. An earlier
    // revision returned a ternary yielding null on BOTH branches — dead code advertising a
    // distinction it never implemented, flagged by review. Both mean "no usable head from
    // the payload"; the CALLER decides what that means, and it refuses to fall back to a
    // merge ref.
    return null;
  }
  return sha;
}

/**
 * Which pull request is being checked.
 *
 * A waiver is scoped to one pull request (lib/gate-waiver.mjs), so the number is part of
 * what the gate verifies rather than decoration. Three sources, in order of authority:
 * an explicit `--pr`, the pull-request event payload, and `GITHUB_REF`'s
 * `refs/pull/<n>/merge`. `null` when none of them answers — the caller fails closed
 * rather than accepting an unscoped waiver.
 *
 * @returns {Promise<number|null>}
 */
export async function loadPullRequestNumber({ number, eventPath, ref }) {
  if (number !== undefined && number !== null && String(number).trim() !== "") {
    const parsed = Number(String(number).trim().replace(/^#/, ""));
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  if (eventPath) {
    try {
      const event = JSON.parse(await fs.readFile(eventPath, "utf8"));
      const fromEvent = event?.pull_request?.number ?? event?.number;
      if (Number.isInteger(fromEvent) && fromEvent > 0) return fromEvent;
    } catch {
      // Fall through to the ref. A malformed payload is not a number.
    }
  }
  const fromRef = /^refs\/pull\/(\d+)\//.exec(ref ?? "");
  if (fromRef) return Number(fromRef[1]);
  return null;
}

/**
 * Words that identify the independent-review checklist item, whatever its wording.
 *
 * Matched against a NORMALISED line — comments stripped, emphasis and backticks
 * removed, case folded — so `**Independent** security review`, `<!-- x -->
 * independent review` and `independent_review` all resolve to the same item.
 */
const REVIEW_ITEM = /\bindependent\b[^\n]*\breview\b|\bsecurity\s+review\b/;

/**
 * A checkbox line, ticked or not.
 *
 * **The marker class is `[-*+]`, not `-`, and that is a fix rather than a
 * flourish.** GitHub-flavoured Markdown renders a task list with any of the
 * three bullet markers, and these patterns only matched `-`. A whole `###`
 * block written with `*` therefore had `boxes.length === 0`, so
 * `checklistProblems` and `checklistPresenceProblems` both **skipped it
 * entirely** — three unticked required items, no `n/a`, no reason, and zero
 * reported problems. Found by the independent Opus security review of pull
 * request #89. The independent-review item itself was not reachable that way
 * (verified on both routes), so what this voided was the rest of the
 * definition-of-done enforcement rather than the review gate.
 */
const ANY_BOX = /^\s*[-*+]\s*\[[ xX]\]/;
/** An UNticked checkbox line. Same marker class, same reason. */
const OPEN_BOX = /^\s*[-*+]\s*\[\s\]/;
/**
 * Same marker class as `ANY_BOX`, but NOT anchored to the start of a line, and
 * global so every occurrence in a block of text can be counted rather than
 * only the first. `ANY_BOX`'s `^` anchor is exactly what a same-line comment
 * prefix defeats: `<!-- - [ ] pnpm typecheck green -->` never matches `ANY_BOX`
 * on that raw line at all (the line starts with `<!--`, not the box marker),
 * so a raw-vs-stripped LINE-count comparison sees 0 either way and never
 * notices anything vanished — even though the box is exactly as hidden as one
 * whose `<!--`/`-->` sit on their own separate lines. Counting substring
 * occurrences across the whole block's text, independent of line boundaries,
 * catches both shapes the same way.
 */
const ANY_BOX_ANYWHERE = /[-*+]\s*\[[ xX]\]/g;

/**
 * Strips the decoration an author could hide behind: HTML comments, emphasis
 * markers, backticks and the box itself. Linear — one pass of single-character
 * classes, no nested quantifier, so this cannot reintroduce the polynomial
 * backtracking CodeQL flagged in the original one-regex sanitiser.
 */
function foldToWords(text) {
  return text
    .replace(/[*_`~]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

/**
 * The item's own SUBJECT — its text up to (not including) the `ITEM_SEPARATOR`
 * that introduces its declared state — folded the same way `foldToWords`
 * folds any other text in this file.
 *
 * `REVIEW_ITEM` must be checked against this, not the whole line: found
 * adversarially, a genuine, ticked, unrelated item whose TRAILING commentary
 * happens to mention "security review" in passing — `- [x] pnpm lint clean —
 * see security review notes in issue #12 (unrelated)` — matched `REVIEW_ITEM`
 * against the whole normalised line and was counted as THE independent
 * review checkbox, with no comment or splice needed at all, and a sentence
 * plausible enough an author could write it by accident. This mirrors
 * `itemMarkedNotApplicable`'s own item/state split on the same
 * `ITEM_SEPARATOR`: the subject is what the item IS, the clause after the
 * separator is what STATE it declares, and "security review" appearing only
 * in the latter does not make the former true.
 */
function itemSubject(line) {
  const withoutBox = stripComments(line)
    .replace(OPEN_BOX, "")
    .replace(ANY_BOX, "");
  const split = ITEM_SEPARATOR.exec(withoutBox);
  const subject = split ? withoutBox.slice(0, split.index) : withoutBox;
  return foldToWords(subject);
}

/**
 * Is THIS checklist line dismissed with a reason of its own?
 *
 * `markedNotApplicable` cannot answer this. It asks whether a *section* carries
 * an `n/a` plus twelve characters of other text — and on a single item the
 * item's own label supplies those twelve characters, so `- [ ] Route policies —
 * n/a` would pass with no reason at all. An item is different: the reason has to
 * come AFTER the `n/a`, because the words before it are the thing being excused.
 *
 * **The negation bypass (found 2026-09-09, not a hypothetical).** The first version of
 * this predicate detected `n/a` as a bare substring found ANYWHERE on the line — the same
 * mistake F9 made at block granularity, fixed there by reading a DECLARED state instead
 * of searching for a token. One level down, at the checkbox line, the substring search
 * survived: `- [ ] Screens opened — this is definitely NOT n/a, I simply did not...`
 * contains the substring `n/a` followed by 6+ more characters, so it satisfied the old
 * regex and excused the box — even though the author explicitly denied being n/a. That
 * was hit by an author writing honestly, on the first attempt, not a hypothetical.
 *
 * The fix is the same shape as F9's: `n/a` must be a STATE DECLARATION — the first thing
 * after the item's own text and its separator — not a token found anywhere on the line.
 * `n/a` is looked for at the START of the clause that follows the item's separator, never
 * inside it. That is deliberately structural rather than linguistic (no negation
 * word-list, no sentiment reading): "this is definitely NOT n/a" does not OPEN with
 * `n/a` — it opens with "this" — so it is rejected the same way any other wrong opening
 * word would be, not because the checker recognised "NOT" as a negation. `not n/a`,
 * `isn't n/a` and `never n/a` are rejected for the identical, non-linguistic reason: none
 * of them is the literal sequence `n`, optional space, `/` (or `\` or `.`, the spellings
 * `foldToWords` already folds elsewhere in this file), optional space, `a` — the clause
 * opens with "not"/"isn't"/"never", not with the n/a token itself.
 *
 * Linear: one separator search, one anchored opener match, no nested quantifier over the
 * same input.
 */

/**
 * The separator between an item's own text and its declared state: a typographic dash, or
 * a spaced hyphen. Deliberately NOT a bare colon, semicolon or unspaced hyphen — every
 * real n/a in this file's own convention follows an em dash, and `` `pnpm
 * test:permissions` `` inside an item's own label (definition-of-done.md) has a colon of
 * its own that must never be misread as the item/state boundary. A colon still works
 * fine AFTER the declaration — "n/a: this PR adds no routes" — because by then `n/a` has
 * already matched as the opener and the colon is just part of the reason.
 */
const ITEM_SEPARATOR = /—|–|\s-\s/;

/**
 * `n/a`, spelled with a slash, backslash or dot — as an OPENER only, never a substring
 * match. `not n/a` does not match this: after the leading `n` it expects (optional
 * whitespace, then) a slash-like character, and `not` has an `o` there instead.
 */
const ITEM_NOT_APPLICABLE_OPENER = /^n\s*[/.\\]\s*a\b/i;

function itemMarkedNotApplicable(line) {
  const withoutBox = stripComments(line)
    .replace(OPEN_BOX, "")
    .replace(ANY_BOX, "");
  const split = ITEM_SEPARATOR.exec(withoutBox);
  if (!split) {
    return false; // no separator at all: there is no declared state to read
  }
  const clause = withoutLeadingDecoration(
    withoutBox.slice(split.index + split[0].length),
  );
  const opener = ITEM_NOT_APPLICABLE_OPENER.exec(clause);
  if (!opener) {
    return false; // the clause opens with something other than n/a — including a negation
  }
  // The reason must contain SIX MEANINGFUL CHARACTERS. Stripping `INVISIBLE` here
  // is the fix for the first hole the independent Opus review of #89 found: the
  // length test counted raw code points, so `n/a` followed by six U+200B
  // zero-width spaces satisfied it while rendering on GitHub byte-identically to
  // a bare `n/a`, which must fail. Fifteen of the seventeen blank-rendering
  // characters in `INVISIBLE` worked; only U+FEFF and U+3000 were caught, and
  // then only incidentally by `trim()`. This is the F13/L6 defect class
  // reappearing one level down, so it is closed with the SAME class the rest of
  // this file already uses for emptiness rather than with a second list.
  //
  // The SAME review found a second hole in the fix for the first one: an
  // enumerated punctuation strip (`.,:;!?—–`'"-`) closed the four spellings the
  // paired test tried and left the family open — `n/a ******`, `n/a ______`,
  // and sixteen more single-symbol pads all still excused a required checkbox,
  // because none of those symbols was on the list either. Rather than adding a
  // fifth, sixth and n-th spelling to a list that will always be missing the
  // next one, the reason is now a PROPERTY: it must contain at least six
  // characters that are `\p{L}` (a letter, any script) or `\p{N}` (a digit) —
  // not "not on the strip list", but "actually a word or a number". Punctuation
  // and symbol characters are never in either class, so a reason made only of
  // them is never sufficient, however it is spelled, without maintaining a
  // second list of the ones that fail. The count is taken from the string with
  // `INVISIBLE` already removed so a blank-rendering Hangul filler — itself
  // `\p{L}` (see `INVISIBLE`'s own doc comment) — cannot be counted as a letter
  // and reopen the F13/L6 hole this same fix relies on `INVISIBLE` to close.
  const remainder = clause.slice(opener[0].length).replace(INVISIBLE, "");
  const meaningfulChars = (remainder.match(/[\p{L}\p{N}]/gu) ?? []).length;
  return meaningfulChars >= 6; // six letters-or-digits, not six characters of any kind
}

/**
 * Checklist enforcement, at ITEM granularity.
 *
 * **The loophole this replaces.** Applicability used to be decided for a whole
 * `###` block: `markedNotApplicable(block)` was computed once, and a single
 * truthful `n/a` anywhere in the block `continue`d past EVERY unticked box in
 * it. So a real "route policies — n/a, this PR adds no routes" silently excused
 * an unticked "Independent security review" three lines below. Both PR #16 and
 * PR #57 passed this check that way, and #19's own body did too.
 *
 * The rule now:
 *
 * - A block with **no checkboxes at all** may still be dismissed wholesale —
 *   `### Frontend change` / `n/a — no UI` is legitimate and stays legitimate.
 * - A block **with** checkboxes is judged line by line. An unticked box must
 *   carry its own `n/a` **and its own reason**, on that line. A neighbour's
 *   `n/a` is worth nothing to it.
 * - The **independent-review** item cannot be dismissed with `n/a` at all. That
 *   is not a new policy: CLAUDE.md's third absolute already forbids downgrading
 *   an unavailable reviewer — "a review recorded at the wrong tier is worse than
 *   no review, because it closes the field that would otherwise stay visibly
 *   open". `n/a` on that item is exactly that closure. It must be ticked, or the
 *   check fails and says why.
 */
/**
 * F2 — PRESENCE, not just state.
 *
 * `checklistProblems` judges the checkboxes it finds. It had nothing to say about the
 * ones it did NOT find, and three probes walked straight through that gap on this very
 * pull request, each exiting 0:
 *
 *   1. delete the line `- [ ] **Independent security review — NOT DONE.**`
 *   2. replace the whole `## Checklists` body with one prose line marking it n/a
 *   3. reword the item so REVIEW_ITEM no longer matches, then n/a it
 *
 * (1) and (3) are quieter than the `n/a` loophole they replace: CI does not diff the
 * body, so nobody sees a removal. This asserts the structure instead of trusting it.
 *
 * `declared` is the list of `###` headings the pull-request template declares under
 * `## Checklists` — the template stays the single definition, exactly as `sections()`
 * already treats it for the H2 list.
 */
/**
 * F9 — what state does a section DECLARE?
 *
 * The original inline test stripped `n/a` and asked whether anything was left, so a bare
 * `n/a` failed while `n/a — no UI change` PASSED: the reason itself kept the section
 * non-empty. The F9 fix replaced that with "does the token `n/a` appear anywhere in the
 * section", which closed the loophole and opened a worse one.
 *
 * **F9 residual — the predicate read a negation as an assertion.** Lane C wrote, honestly:
 *
 *   "I am not marking this n/a — that would misrepresent a real gap"
 *
 * and the checker rejected the section, because the token `n/a` is in it. So the one
 * author who refused to claim the exemption was treated as though they had claimed it,
 * and the way to pass was to stop explaining. A gate that punishes candour teaches
 * authors to be less candid, which is the opposite of what `## Screens opened` is for.
 *
 * **The fix is structural, and deliberately not linguistic.** No sentiment analysis, no
 * negation detection, no attempt to read intent out of prose — every one of those is a
 * new class of false positive wearing a cleverer hat. Instead the section's **declared
 * state** is read from its **first meaningful line**, the way a status field is read:
 *
 *   empty          nothing a human would see (F13's invisibles included)
 *   not-applicable the first line opens with `n/a` / `N/A` / `n / a` / `not applicable`
 *   blocked        the first line opens with `BLOCKED`, plus a substantive explanation
 *   blocked-bare   `BLOCKED` with nothing substantive after it
 *   provided       anything else — the author answered the question
 *
 * Only the first line decides. The token `n/a` appearing later, in explanation, is prose
 * and carries no state — which is exactly the residual finding. `declaredState` is the
 * whole mechanism; the two booleans below are named views of it.
 *
 * **`blocked` is honest, not permissive.** It means the parser accepts the explanation
 * instead of calling it a false `n/a`. It does **not** mean the pull request is ready:
 * every other requirement — the independent-review checkbox, the committed note, the
 * checklists — still applies, and AGENTS.md do-not 18 still asks for the screens you
 * actually opened. A section that says BLOCKED is a section that has told the truth about
 * a gap, and a gap is still a gap.
 */

/** Leading decoration an author may put before the state word: emphasis, bullets, emoji. */
function withoutLeadingDecoration(line) {
  return line.replace(/^[^\p{L}\p{N}]+/u, "");
}

const NOT_APPLICABLE_OPENER = /^(?:n\s*\/\s*a|not\s+applicable)\b/i;
const BLOCKED_OPENER = /^blocked\b/i;
/** Characters of explanation a `BLOCKED` declaration needs before it says anything. */
const BLOCKED_EXPLANATION_MINIMUM = 40;

/**
 * The lines of a section that carry content — comments stripped, template scaffolding and
 * invisible-only lines dropped. Shares its rules with `contentOf` so the two cannot drift.
 *
 * @param {string} markdown
 * @returns {string[]}
 */
export function meaningfulLines(markdown) {
  return stripComments(markdown)
    .split("\n")
    .map((line) => line.replace(INVISIBLE, "").trim())
    .filter(
      (line) =>
        line !== "" &&
        !/^\*\*[^*]+:\*\*$/.test(line) &&
        !/^-{3,}$/.test(line) &&
        !/^#{1,6}\s/.test(line),
    );
}

/**
 * @typedef {object} SectionState
 * @property {"empty"|"not-applicable"|"blocked"|"blocked-bare"|"provided"} state
 * @property {string} first the first meaningful line, verbatim
 * @property {string} explanation for `blocked`, what followed the marker
 */

/**
 * @param {string} text a section's raw markdown
 * @returns {SectionState}
 */
export function declaredState(text) {
  const lines = meaningfulLines(text);
  if (lines.length === 0) {
    return { state: "empty", first: "", explanation: "" };
  }

  const first = lines[0];
  const opener = withoutLeadingDecoration(first);

  if (NOT_APPLICABLE_OPENER.test(opener)) {
    return { state: "not-applicable", first, explanation: "" };
  }

  if (BLOCKED_OPENER.test(opener)) {
    // The explanation may run past the first line, so the whole section counts towards
    // it — a BLOCKED heading followed by three lines of detail is explained.
    const explanation = [opener.replace(BLOCKED_OPENER, ""), ...lines.slice(1)]
      .join(" ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    return {
      state:
        explanation.length >= BLOCKED_EXPLANATION_MINIMUM
          ? "blocked"
          : "blocked-bare",
      first,
      explanation,
    };
  }

  return { state: "provided", first, explanation: "" };
}

/**
 * Is the section standing on an exemption it may not claim?
 *
 * True for `empty`, `not-applicable` and `blocked-bare` — nothing, a claimed exemption,
 * or a marker with no substance behind it. False for `blocked` and `provided`: the author
 * either answered or said plainly that they could not, and neither is an `n/a`.
 *
 * Used for `## Screens opened` when apps/web/** changed, where AGENTS.md do-not 18 asks
 * for the screens you actually opened and no reason substitutes for that.
 */
export function effectivelyNotApplicable(text) {
  const { state } = declaredState(text);
  return (
    state === "empty" || state === "not-applicable" || state === "blocked-bare"
  );
}

export function checklistPresenceProblems(raw, declared) {
  const problems = [];

  const present = new Map();
  let current = null;
  for (const line of raw.split("\n")) {
    const heading = /^###\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      current = { name: heading[1], lines: [] };
      present.set(normaliseHeading(heading[1]), current);
      continue;
    }
    if (current) current.lines.push(line);
  }

  // 1. Every declared block must still be there. Deleting one is not an answer.
  for (const heading of declared) {
    if (!present.has(normaliseHeading(heading))) {
      problems.push(
        `"${heading}" is MISSING. Every checklist heading in ` +
          ".github/pull_request_template.md ships in every pull request — a checklist that " +
          "does not apply is marked n/a with a reason, never deleted. Deleting it removes " +
          "the record that it was considered.",
      );
    }
  }

  // Both rules below check `genuineBoxCount`/`genuineBoxLineTexts`, not a
  // naive comment-strip-then-split — three rounds of adversarial review
  // found, in order: a checkbox truly wrapped in a multi-line comment
  // (invisible on GitHub's own render, but read as present by a per-line
  // strip); a checkbox manufactured by a comment splicing two fragments of
  // real text together (present in a naive comment-stripped scan, but never
  // a real substring of the raw text at all); and the combination of both,
  // which defeats any comparison of just two SCALAR counts. Every genuine
  // check here is a per-match fact — does this specific checkbox trace to
  // one unbroken run of the author's own characters — not an arithmetic
  // condition over totals.

  // 2. At least one block must actually carry checkboxes. Collapsing the whole section
  //    to prose leaves checklistProblems() with nothing to judge, which is probe (2).
  const withBoxes = [...present.entries()].filter(
    ([, block]) => genuineBoxCount(block.lines.join("\n")) > 0,
  );
  if (present.size > 0 && withBoxes.length === 0) {
    problems.push(
      "no checklist block contains a single checkbox. A `## Checklists` section made " +
        "entirely of prose has nothing to tick and nothing to check — paste the real " +
        "checklists from docs/04-engineering/definition-of-done.md.",
    );
  }

  // 3. EXACTLY ONE independent-review checkbox must exist. Zero is probe (1) and probe
  //    (3) — deletion and rewording are indistinguishable from the outside, and both
  //    must fail with the same message the unticked box gets. More than one is
  //    ambiguous about which one closes the gate.
  //
  // Iterated over `genuineBoxLineTexts`, not the naive stripped lines — found
  // adversarially: a checkbox marker split across a comment span
  // (`- [<!--\nfiller\n-->x] Independent security review`) contains no
  // complete marker anywhere in the raw text, but the comment-stripped lines
  // this rule used to scan directly include the fused, fake-ticked result.
  // `genuineBoxLineTexts` only returns a line whose checkbox marker traces to
  // one unbroken run of raw characters, so a manufactured review box is never
  // mistaken for the one genuine item this rule exists to require.
  //
  // Matched against `itemSubject`, not a whole-line fold of the entire item —
  // found adversarially: a genuine, ticked, UNRELATED item whose own trailing
  // commentary happens to mention "security review" in passing (`- [x] pnpm
  // lint clean — see security review notes in issue #12`) matched
  // `REVIEW_ITEM` against the entire line and was counted as the one genuine
  // review checkbox — no comment or splice needed, a sentence plausible
  // enough to write by accident. `itemSubject` restricts the match to what
  // the item's own text claims to BE, not what it goes on to mention.
  const reviewItems = [];
  for (const [, block] of present) {
    for (const line of genuineBoxLineTexts(block.lines.join("\n"))) {
      if (REVIEW_ITEM.test(itemSubject(line)))
        reviewItems.push({ block: block.name, line: line.trim() });
    }
  }

  if (reviewItems.length === 0) {
    problems.push(
      "there is NO independent-review checkbox anywhere in `## Checklists`. The " +
        "mandatory independent security review is a BLOCKER that a completed review at " +
        "the required tier closes (CLAUDE.md, third absolute) — it is not closed by " +
        "deleting the line, and not by rewording it so this check stops recognising it. " +
        "Restore a checkbox whose text names the independent/security review.",
    );
  } else if (reviewItems.length > 1) {
    problems.push(
      `there are ${reviewItems.length} independent-review checkboxes ` +
        `(${reviewItems.map((item) => `"${item.block}"`).join(", ")}). Exactly one must ` +
        "exist, so which one gates the merge is not a matter of interpretation.",
    );
  }

  return problems;
}

export function checklistProblems(raw) {
  const problems = [];
  const blocks = [];
  let current = null;

  for (const line of raw.split("\n")) {
    const heading = /^###\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      current = { name: heading[1], lines: [] };
      blocks.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }

  for (const block of blocks) {
    const body = block.lines.join("\n");

    if (contentOf(body) === "") {
      problems.push(
        `"${block.name}" is blank — paste the checklist from definition-of-done.md and tick it, or mark it n/a with one line saying why.`,
      );
      continue;
    }

    // Strip comments from the WHOLE block first, matching `contentOf`'s own
    // pattern, then re-derive lines from the result. Stripping line-by-line
    // (the previous shape) never sees a comment whose `<!--`/`-->` sit on
    // different lines, so a checkbox truly wrapped in a multi-line comment —
    // invisible on GitHub's own render — still read as present and ticked to
    // this checker. Splitting AFTER stripping is what makes an in-comment
    // line vanish here the same way it vanishes for a human reader, instead
    // of surviving as an untouched raw line that happens to look unstripped.
    const visibleLines = stripComments(body).split("\n");

    const boxes = visibleLines.filter((line) => ANY_BOX.test(line));

    // A checkbox present in the RAW text that vanished once comments were
    // stripped was hidden inside a comment — found adversarially: fixing the
    // fake-ticked-review-box bypass above (by making a hidden box read as
    // ABSENT) silently dropped the one thing that used to make a hidden but
    // genuinely UNTICKED ordinary item still get flagged as unticked, since
    // the old per-line stripping never saw a multi-line comment and left
    // such a line looking untouched. A vanished box is a violation on its
    // own regardless of what state it claimed to be in — every checklist box
    // must be visible to a human reader, not hidden from one while still
    // counted by automation — so this is flagged directly rather than relying
    // on it also happening to be unticked.
    //
    // Checked against `genuineBoxCount`, not against a second scalar count —
    // three rounds of independent review each found a real gap in every
    // count-comparison tried here: a checkbox hidden entirely inside a
    // comment (raw count too high), one MANUFACTURED by a comment splicing
    // two fragments together (visible count too high — `- [<!--\nfiller\n
    // -->x] Independent security review` contains no complete `- [x]`
    // substring anywhere in the raw text, but stripping the comment fuses
    // the fragments into one), and finally — the one no count comparison
    // between just two totals can ever close — BOTH in the same block: hide
    // one real checkbox while splicing a different fake one into existence,
    // so raw and visible land on the identical number and every inequality
    // over those two totals reads "nothing happened." `genuineBoxCount`
    // does not compare totals at all: it asks, per match, whether THIS
    // specific visible checkbox traces to one unbroken run of raw
    // characters. A hidden box was never in the visible text to ask about;
    // a manufactured one fails the question directly. Both conditions below
    // can fire together in the same block, because they are independent
    // per-match facts, not two ends of one arithmetic comparison.
    const rawBoxCount = (body.match(ANY_BOX_ANYWHERE) ?? []).length;
    const visibleBoxCount = (
      visibleLines.join("\n").match(ANY_BOX_ANYWHERE) ?? []
    ).length;
    const genuineCount = genuineBoxCount(body);
    if (rawBoxCount > genuineCount) {
      problems.push(
        `"${block.name}" hides ${rawBoxCount - genuineCount} checkbox(es) inside an HTML comment — a checkbox invisible on GitHub's own render cannot satisfy or excuse anything here, ticked or not. Move it out of the comment, or delete it and state why in visible text.`,
      );
    }
    if (visibleBoxCount > genuineCount) {
      problems.push(
        `"${block.name}" has ${visibleBoxCount - genuineCount} checkbox(es) that only exist because a comment span was spliced across a checkbox marker, manufacturing one that was never in the raw text. Restructure the comment so it does not straddle a \`[ ]\`/\`[x]\`.`,
      );
    }

    // No boxes: prose stands on its own, n/a or not. Unchanged behaviour.
    if (boxes.length === 0) continue;

    // Only GENUINE lines go through the ticked/`REVIEW_ITEM`/n/a-excuse
    // checks below — found adversarially: a genuine, untouched checkbox
    // marker with everything AFTER it spliced in from across a comment
    // (`- [ ] pnpm typecheck green — n/a<!--\nfiller\n-->: a fabricated
    // excuse`) has a marker that is perfectly contiguous, so a marker-only
    // genuineness check (the previous shape) waved the whole line through —
    // and `itemMarkedNotApplicable` then read the SPLICED excuse as a real
    // one, silently closing a genuinely unticked, unresolved item with zero
    // problems reported. A non-genuine line is already accounted for by the
    // "manufactured" count above; re-checking its ticked state or wording
    // here would be trusting exactly the text that was just proven untrustworthy.
    //
    // `REVIEW_ITEM` is matched against `itemSubject`, not the whole line, for
    // the same reason `checklistPresenceProblems`'s rule 3 does: an ordinary,
    // unticked item whose own trailing commentary happens to mention
    // "security review" in passing must not be misclassified as THE
    // independent-review item (a false BLOCKER) any more than a ticked one
    // should be miscounted as satisfying it (found adversarially, in
    // `checklistPresenceProblems`; kept consistent here so the two functions
    // never disagree about which line the review item actually is).
    for (const line of genuineBoxLineTexts(body)) {
      if (!OPEN_BOX.test(line)) continue;

      if (REVIEW_ITEM.test(itemSubject(line))) {
        problems.push(
          `"${block.name}": ${line.trim()}\n      An unticked independent-review item is a BLOCKER, not a note, and it cannot be ` +
            "marked n/a — only a completed review at the required tier closes it (CLAUDE.md, third absolute).",
        );
        continue;
      }

      // Item-level n/a, with its own reason on its own line.
      if (!itemMarkedNotApplicable(line)) {
        problems.push(
          `"${block.name}": ${line.trim()}\n      Tick it, or mark THIS line n/a with a reason. An n/a elsewhere in the section ` +
            "does not carry over.",
        );
      }
    }
  }

  return problems;
}
