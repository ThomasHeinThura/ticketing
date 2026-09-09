import fs from "node:fs/promises";

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

  while (i < markdown.length) {
    out.push(markdown[i]);
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
      const close = markdown.indexOf("-->", i);
      i = close === -1 ? markdown.length : close + 3;
    }
  }

  return out.join("");
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
    return event?.pull_request === undefined ? null : null;
  }
  return sha;
}

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

/** A checkbox line, ticked or not. */
const ANY_BOX = /^\s*-\s*\[[ xX]\]/;
/** An UNticked checkbox line. */
const OPEN_BOX = /^\s*-\s*\[\s\]/;

/**
 * Strips the decoration an author could hide behind: HTML comments, emphasis
 * markers, backticks and the box itself. Linear — one pass of single-character
 * classes, no nested quantifier, so this cannot reintroduce the polynomial
 * backtracking CodeQL flagged in the original one-regex sanitiser.
 */
function normaliseItem(line) {
  return stripComments(line)
    .replace(OPEN_BOX, "")
    .replace(ANY_BOX, "")
    .replace(/[*_`~]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
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
 * Linear: one `n/a`, one optional separator, then a run of non-space. No nested
 * quantifier over the same input.
 */
function itemMarkedNotApplicable(line) {
  return /\bn\/a\b\s*[\u2014\u2013:,;.-]?\s*\S[^\n]{5,}/i.test(
    stripComments(line),
  );
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

  // 2. At least one block must actually carry checkboxes. Collapsing the whole section
  //    to prose leaves checklistProblems() with nothing to judge, which is probe (2).
  const withBoxes = [...present.values()].filter((block) =>
    block.lines.some((line) => ANY_BOX.test(stripComments(line))),
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
  const reviewItems = [];
  for (const block of present.values()) {
    for (const line of block.lines) {
      const visible = stripComments(line);
      if (!ANY_BOX.test(visible)) continue;
      if (REVIEW_ITEM.test(normaliseItem(line)))
        reviewItems.push({ block: block.name, line: visible.trim() });
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

    const boxes = block.lines.filter((line) =>
      ANY_BOX.test(stripComments(line)),
    );

    // No boxes: prose stands on its own, n/a or not. Unchanged behaviour.
    if (boxes.length === 0) continue;

    for (const line of block.lines) {
      const visible = stripComments(line);
      if (!OPEN_BOX.test(visible)) continue;

      if (REVIEW_ITEM.test(normaliseItem(line))) {
        problems.push(
          `"${block.name}": ${visible.trim()}\n      An unticked independent-review item is a BLOCKER, not a note, and it cannot be ` +
            "marked n/a — only a completed review at the required tier closes it (CLAUDE.md, third absolute).",
        );
        continue;
      }

      // Item-level n/a, with its own reason on its own line.
      if (!itemMarkedNotApplicable(visible)) {
        problems.push(
          `"${block.name}": ${visible.trim()}\n      Tick it, or mark THIS line n/a with a reason. An n/a elsewhere in the section ` +
            "does not carry over.",
        );
      }
    }
  }

  return problems;
}
