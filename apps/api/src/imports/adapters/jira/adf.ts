/**
 * Atlassian Document Format (Jira Cloud REST v3) to plain text.
 *
 * The record contract carries `description` as plain text (the writer turns it into the editor
 * document). Readable structure (paragraphs, lists, headings, code, quotes, links, mentions)
 * survives as text. Constructs that cannot be represented as text (tables, media, extensions,
 * unknown nodes) degrade and set `lossy`, which the adapter reports as `rich_text_lossy`.
 */
export type TextConversion = { text: string; lossy: boolean };

const MAX_DEPTH = 40;
const LOSSY_NODES = new Set([
  "table",
  "media",
  "mediaSingle",
  "mediaGroup",
  "mediaInline",
  "extension",
  "bodiedExtension",
  "inlineExtension",
  "expand",
  "nestedExpand",
  "status",
  "decisionList",
  "taskList",
]);

type Node = {
  type?: unknown;
  text?: unknown;
  content?: unknown;
  attrs?: Record<string, unknown>;
  marks?: unknown;
};

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function children(node: Node): Node[] {
  return Array.isArray(node.content) ? node.content.filter(isNode) : [];
}

function linkMark(node: Node): string | null {
  if (!Array.isArray(node.marks)) return null;
  for (const mark of node.marks) {
    if (isNode(mark) && mark.type === "link") {
      const href = mark.attrs?.href;
      if (typeof href === "string" && /^https?:\/\//iu.test(href)) return href;
    }
  }
  return null;
}

export function adfToText(root: unknown): TextConversion {
  let lossy = false;

  const inline = (node: Node, depth: number): string => {
    if (depth > MAX_DEPTH) {
      lossy = true;
      return "";
    }
    switch (node.type) {
      case "text": {
        const text = typeof node.text === "string" ? node.text : "";
        const href = linkMark(node);
        return href && !text.includes(href) ? `${text} (${href})` : text;
      }
      case "hardBreak":
        return "\n";
      case "mention": {
        const label = node.attrs?.text;
        return typeof label === "string"
          ? label.startsWith("@")
            ? label
            : `@${label}`
          : "@user";
      }
      case "emoji": {
        const text = node.attrs?.text ?? node.attrs?.shortName;
        return typeof text === "string" ? text : "";
      }
      case "inlineCard": {
        const url = node.attrs?.url;
        return typeof url === "string" ? url : "";
      }
      case "date": {
        const stamp = Number(node.attrs?.timestamp);
        return Number.isFinite(stamp)
          ? new Date(stamp).toISOString().slice(0, 10)
          : "";
      }
      default:
        return block(node, depth + 1, "");
    }
  };

  const inlineChildren = (node: Node, depth: number) =>
    children(node)
      .map((child) => inline(child, depth + 1))
      .join("");

  const list = (node: Node, depth: number, indent: string): string => {
    const ordered = node.type === "orderedList";
    const start = Number(node.attrs?.order) || 1;
    return children(node)
      .map((item, index) => {
        const marker = ordered ? `${start + index}. ` : "- ";
        const parts = children(item).map((part) =>
          part.type === "bulletList" || part.type === "orderedList"
            ? `\n${list(part, depth + 1, `${indent}  `)}`
            : block(part, depth + 1, `${indent}  `),
        );
        return `${indent}${marker}${parts.join("\n").replace(/^\s+/u, "")}`;
      })
      .join("\n");
  };

  const block = (node: Node, depth: number, indent: string): string => {
    if (depth > MAX_DEPTH) {
      lossy = true;
      return "";
    }
    const type = typeof node.type === "string" ? node.type : "";
    if (LOSSY_NODES.has(type)) lossy = true;
    switch (type) {
      case "paragraph":
        return inlineChildren(node, depth);
      case "heading":
        return inlineChildren(node, depth);
      case "codeBlock":
        return `\`\`\`\n${inlineChildren(node, depth)}\n\`\`\``;
      case "blockquote":
        return children(node)
          .map((child) => `> ${block(child, depth + 1, indent)}`)
          .join("\n");
      case "bulletList":
      case "orderedList":
        return list(node, depth, indent);
      case "rule":
        return "---";
      case "table":
        return children(node)
          .map((row) =>
            children(row)
              .map((cell) =>
                children(cell)
                  .map((part) => block(part, depth + 3, ""))
                  .join(" ")
                  .trim(),
              )
              .join(" | "),
          )
          .join("\n");
      case "media":
      case "mediaSingle":
      case "mediaGroup":
      case "mediaInline":
        return "[attachment]";
      case "text":
      case "hardBreak":
      case "mention":
      case "emoji":
      case "inlineCard":
      case "date":
        return inline(node, depth);
      case "status": {
        const text = node.attrs?.text;
        return typeof text === "string" ? `[${text}]` : "";
      }
      case "doc":
      case "panel":
      case "expand":
      case "nestedExpand":
      case "layoutSection":
      case "layoutColumn":
      case "listItem":
      case "tableRow":
      case "tableCell":
      case "tableHeader":
      case "taskList":
      case "decisionList":
      case "taskItem":
      case "decisionItem":
      case "bodiedExtension":
        return children(node)
          .map((child) => block(child, depth + 1, indent))
          .filter((part) => part.length > 0)
          .join("\n\n");
      default:
        // Unknown node: keep any text it holds, flag the degradation.
        lossy = true;
        return children(node)
          .map((child) => block(child, depth + 1, indent))
          .join("\n");
    }
  };

  if (!isNode(root)) return { text: "", lossy: false };
  const text = block(root, 0, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return { text, lossy };
}

const WIKI_MARKUP =
  /\{(?:code|noformat|panel|quote|color)[^}]*\}|^h[1-6]\.\s|\|\|[^|]+\||\[~[^\]]+\]|![^\s!]+!/mu;

/** Jira description as plain text: ADF (v3) is converted, a wiki-markup / plain string (v2, exports) is kept. */
export function descriptionToText(value: unknown): TextConversion {
  if (typeof value === "string")
    return { text: value.trim(), lossy: WIKI_MARKUP.test(value) };
  if (isNode(value)) return adfToText(value);
  return { text: "", lossy: false };
}
