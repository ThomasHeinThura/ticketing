/**
 * Plain-text clipboard content that should be pasted as Markdown structure.
 *
 * Deliberately strict: only block syntax at the start of a line, or an inline
 * `[text](url)` link, counts. Emphasis characters, `#hashtags`, a dash in a
 * sentence or numbered prose such as "2024. A good year" stay plain text.
 */
const MARKDOWN_LINE_PATTERNS: readonly RegExp[] = [
  // ATX heading: "# Title" … "###### Title"
  /^#{1,6}[ \t]+\S/,
  // Bullet or task list item: "- item", "* item", "+ item", "- [ ] item"
  /^[ \t]*[-*+][ \t]+\S/,
  // Ordered list item with a short number: "1. item", "2) item"
  /^[ \t]*\d{1,3}[.)][ \t]+\S/,
  // Block quote: "> quoted"
  /^[ \t]{0,3}>[ \t]?\S/,
  // Fenced code block: "```" or "~~~", optionally with a language
  /^[ \t]{0,3}(?:```|~~~)/,
  // Thematic break on its own line: "---", "***", "___"
  /^[ \t]{0,3}(?:-[ \t]*){3,}$|^[ \t]{0,3}(?:\*[ \t]*){3,}$|^[ \t]{0,3}(?:_[ \t]*){3,}$/,
];

const MARKDOWN_TABLE_ROW = /^[ \t]*\|?.*\|.*\|?[ \t]*$/;
const MARKDOWN_TABLE_DELIMITER =
  /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/;
const MARKDOWN_INLINE_LINK =
  /\[[^\]\n]+\]\((?:https?:\/\/|mailto:|\/|#)[^\s)]+(?:[ \t]+"[^"\n]*")?\)/;

export function looksLikeMarkdown(text: string): boolean {
  if (!text.trim()) return false;

  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  for (const [index, line] of lines.entries()) {
    if (MARKDOWN_LINE_PATTERNS.some((pattern) => pattern.test(line))) {
      return true;
    }

    // A table needs a header row followed directly by its delimiter row.
    const next = lines[index + 1];
    if (
      next !== undefined &&
      MARKDOWN_TABLE_ROW.test(line) &&
      MARKDOWN_TABLE_DELIMITER.test(next)
    ) {
      return true;
    }
  }

  return MARKDOWN_INLINE_LINK.test(text);
}
