import type { JSONContent } from "@tiptap/core";
import { isAllowedUri } from "@tiptap/extension-link";

/**
 * Plain-text clipboard content that should be pasted as Markdown structure.
 *
 * Deliberately strict, because a false positive rewrites what the person copied:
 * - one line is enough for a heading, a task item, a complete code fence, a table
 *   or an inline `[text](url)` link;
 * - list items need at least two in a row with the same marker, and quotes two
 *   quoted lines, so a single "1) Call the customer" or "> 5 users affected"
 *   stays text;
 * - diffs and text with HTML-like tags outside code (`<Input>`) are never parsed,
 *   and neither are a thematic break, emphasis characters, `#hashtags` or a dash
 *   in a sentence on their own.
 */
const HEADING = /^#{1,6}[ \t]+\S/;
const TASK_ITEM = /^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+\S/;
const BULLET_ITEM = /^[ \t]*([-*+])[ \t]+\S/;
const ORDERED_ITEM = /^[ \t]*\d{1,3}([.)])[ \t]+\S/;
// A quote, but not a comparison or prompt such as "> 5 users" or ">= 2".
const QUOTE_LINE = /^[ \t]{0,3}>[ \t]?(?![\d=<>])\S/;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const DIFF_LINE = /^(?:diff --git |@@ |\+\+\+ |--- a\/|index [0-9a-f]{6,}\.\.)/;
const HTML_TAG = /<\/?[A-Za-z][\w-]*(?:\s[^<>\n]*)?\/?>/;
const INLINE_CODE = /`[^`\n]*`/g;

const TABLE_ROW = /^[ \t]*\|?.*\|.*\|?[ \t]*$/;
const TABLE_DELIMITER =
  /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/;
const INLINE_LINK =
  /\[[^\]\n]+\]\((?:https?:\/\/|mailto:|\/|#)[^\s)]+(?:[ \t]+"[^"\n]*")?\)/;

/** How many list items or quote lines in a row make a paste Markdown. */
const MIN_BLOCK_RUN = 2;

/** The kind of repeatable block a line starts, e.g. "bullet:-", or null. */
function blockKind(line: string): string | null {
  const bullet = BULLET_ITEM.exec(line);
  if (bullet) return `bullet:${bullet[1]}`;
  const ordered = ORDERED_ITEM.exec(line);
  if (ordered) return `ordered:${ordered[1]}`;
  if (QUOTE_LINE.test(line)) return "quote";
  return null;
}

export function looksLikeMarkdown(text: string): boolean {
  if (!text.trim()) return false;

  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.some((line) => DIFF_LINE.test(line))) return false;

  let strong = false;
  let fence: string | null = null;
  let runKind: string | null = null;
  let run = 0;

  for (const [index, line] of lines.entries()) {
    const fenceMatch = FENCE.exec(line);
    if (fence !== null) {
      // Inside a code block nothing else counts; its closing fence completes it.
      if (fenceMatch?.[1]?.startsWith(fence)) {
        fence = null;
        strong = true;
      }
      continue;
    }
    if (fenceMatch?.[1]) {
      fence = fenceMatch[1];
      runKind = null;
      run = 0;
      continue;
    }

    const prose = line.replace(INLINE_CODE, "");
    if (HTML_TAG.test(prose)) return false;

    if (HEADING.test(line) || TASK_ITEM.test(line) || INLINE_LINK.test(prose)) {
      strong = true;
    }
    // A table needs a header row followed directly by its delimiter row.
    const next = lines[index + 1];
    if (
      next !== undefined &&
      TABLE_ROW.test(line) &&
      TABLE_DELIMITER.test(next)
    ) {
      strong = true;
    }

    if (!line.trim()) continue; // a blank line keeps a loose list together
    const kind = blockKind(line);
    run = kind !== null && kind === runKind ? run + 1 : kind ? 1 : 0;
    runKind = kind;
    if (run >= MIN_BLOCK_RUN) strong = true;
  }

  return strong;
}

/**
 * Pasted Markdown keeps only links the link dialog would accept (Tiptap's
 * `isAllowedUri`: http(s), mailto, tel and the like, or a relative path).
 * `javascript:`, `data:` and `vbscript:` targets lose the link and keep the
 * text; images with such a source are dropped.
 */
export function withSafeLinks(node: JSONContent): JSONContent {
  const marks = node.marks?.filter((mark) => {
    if (mark.type !== "link") return true;
    const href = mark.attrs?.href;
    return typeof href === "string" && href.trim() !== "" && isSafe(href);
  });
  const content = node.content
    ?.filter((child) => {
      if (child.type !== "image") return true;
      const src = child.attrs?.src;
      return typeof src === "string" && src.trim() !== "" && isSafe(src);
    })
    .map(withSafeLinks);
  return {
    ...node,
    ...(node.marks ? { marks } : {}),
    ...(node.content ? { content } : {}),
  };
}

function isSafe(uri: string) {
  return Boolean(isAllowedUri(uri));
}
