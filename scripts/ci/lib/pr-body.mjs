import fs from "node:fs/promises";

/** Remove HTML comments — the template's instructions are not content. */
export function stripComments(markdown) {
  return markdown.replace(/<!--[\s\S]*?-->/g, "");
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
