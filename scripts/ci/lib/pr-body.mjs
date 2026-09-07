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
export function contentOf(markdown) {
  return stripComments(markdown)
    .split("\n")
    .filter((line) => !/^\s*\*\*[^*]+:\*\*\s*$/.test(line))
    .filter((line) => !/^\s*-{3,}\s*$/.test(line))
    .join("\n")
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
