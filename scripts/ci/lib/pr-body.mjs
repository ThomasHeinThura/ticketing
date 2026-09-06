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
