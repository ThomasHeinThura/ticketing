/**
 * KB-5 / safety-and-runtime "XSS": an article body is a Tiptap JSON document, never raw HTML.
 * There was no shared server-side sanitiser for Tiptap documents (work items and canned
 * responses store the document as opaque JSON), so the knowledge base carries its own closed
 * allowlist: node types, mark types, per-node attributes and URL schemes. Anything outside it
 * is dropped (a node with children is unwrapped, a leaf is removed). Input is never mutated.
 *
 * Pure: no database, no clock.
 */

export const MAX_BODY_BYTES = 400_000;
export const MAX_BODY_DEPTH = 24;
export const MAX_BODY_NODES = 20_000;
const MAX_TEXT_LENGTH = 50_000;

export class KbBodyError extends Error {}

export type KbNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: KbNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
};

export const EMPTY_BODY: KbNode = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

const CALLOUT_VARIANTS = ["info", "success", "warning", "danger", "internal"];
const CONTAINER_NODES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "callout",
  "codeBlock",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
]);
const LEAF_NODES = new Set(["horizontalRule", "hardBreak", "image"]);
const BLOCKS = new Set([
  "paragraph",
  "heading",
  "listItem",
  "taskItem",
  "codeBlock",
  "horizontalRule",
  "tableCell",
  "tableHeader",
]);

/** `http`, `https`, `mailto`, `tel` and same-site paths. `javascript:`, `data:` and `//host` never pass. */
export function safeUrl(
  value: unknown,
  allowed: readonly string[],
): string | null {
  if (typeof value !== "string") return null;
  const url = value.trim();
  if (url.length === 0 || url.length > 2048) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is refused
  if (/[\u0000-\u001f\u007f\s]/.test(url)) return null;
  if (url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\"))
    return allowed.includes("/") ? url : null;
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url);
  if (!match) return null;
  const scheme = `${(match[1] ?? "").toLowerCase()}:`;
  return allowed.includes(scheme) ? url : null;
}

const LINK_SCHEMES = ["https:", "http:", "mailto:", "tel:", "/"];
const IMAGE_SCHEMES = ["https:"];

function int(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : undefined;
}

function str(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length <= max ? value : undefined;
}

function pick(
  attrs: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const entries = Object.entries(attrs).filter(
    ([, value]) => value !== undefined,
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function nodeAttrs(
  type: string,
  raw: Record<string, unknown>,
): Record<string, unknown> | undefined {
  switch (type) {
    case "heading":
      return { level: int(raw.level, 1, 6) ?? 2 };
    case "orderedList":
      return pick({ start: int(raw.start, 0, 100_000) });
    case "taskItem":
      return { checked: raw.checked === true };
    case "codeBlock": {
      const language = str(raw.language, 32);
      return pick({
        language:
          language && /^[A-Za-z0-9_+#.-]+$/.test(language)
            ? language
            : undefined,
      });
    }
    case "callout": {
      const variant = str(raw.variant, 16);
      return {
        variant:
          variant && CALLOUT_VARIANTS.includes(variant) ? variant : "info",
      };
    }
    case "tableCell":
    case "tableHeader": {
      const widths = Array.isArray(raw.colwidth)
        ? raw.colwidth.map((w) => int(w, 0, 5000))
        : null;
      return pick({
        colspan: int(raw.colspan, 1, 50),
        rowspan: int(raw.rowspan, 1, 50),
        colwidth: widths?.every((w) => w !== undefined) ? widths : undefined,
      });
    }
    case "image": {
      const src = safeUrl(raw.src, IMAGE_SCHEMES);
      return src
        ? pick({ src, alt: str(raw.alt, 500), title: str(raw.title, 500) })
        : undefined;
    }
    case "taskdeskIssueLink": {
      const issueKey = str(raw.issueKey, 64);
      const taskId = str(raw.taskId, 64);
      return pick({
        issueKey:
          issueKey && /^[A-Za-z0-9_-]+$/.test(issueKey) ? issueKey : undefined,
        taskId: taskId && /^[A-Za-z0-9_-]+$/.test(taskId) ? taskId : undefined,
        url: safeUrl(raw.url, ["/", "https:", "http:"]) ?? undefined,
      });
    }
    default:
      return undefined;
  }
}

function sanitiseMarks(raw: unknown): KbNode["marks"] {
  if (!Array.isArray(raw)) return undefined;
  const marks: NonNullable<KbNode["marks"]> = [];
  for (const mark of raw) {
    if (!mark || typeof mark !== "object") continue;
    const type = (mark as { type?: unknown }).type;
    if (
      type === "bold" ||
      type === "italic" ||
      type === "underline" ||
      type === "strike" ||
      type === "code"
    ) {
      if (!marks.some((m) => m.type === type)) marks.push({ type });
    } else if (type === "link") {
      const attrs = (mark as { attrs?: Record<string, unknown> }).attrs ?? {};
      const href = safeUrl(attrs.href, LINK_SCHEMES);
      if (href && !marks.some((m) => m.type === "link"))
        marks.push({
          type: "link",
          attrs: {
            href,
            target: "_blank",
            rel: "noopener noreferrer nofollow",
          },
        });
    }
  }
  return marks.length > 0 ? marks : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Plain text of a document: every text node, a space between blocks. */
export function extractText(node: KbNode): string {
  const parts: string[] = [];
  const visit = (current: KbNode) => {
    if (current.type === "text" && current.text) parts.push(current.text);
    else if (current.type === "hardBreak") parts.push(" ");
    if (current.content) {
      for (const child of current.content) visit(child);
      if (BLOCKS.has(current.type)) parts.push(" ");
    }
  };
  visit(node);
  return parts.join("").replace(/\s+/g, " ").trim();
}

/**
 * Validate and normalise a document. Throws `KbBodyError` for a structurally unusable input
 * (not a `doc`, NUL byte, too large, too deep, too many nodes); everything else is cleaned.
 */
export function sanitiseKbBody(input: unknown): { doc: KbNode; text: string } {
  if (!isRecord(input) || input.type !== "doc")
    throw new KbBodyError("The article body must be a document");
  const serialised = JSON.stringify(input);
  if (Buffer.byteLength(serialised, "utf8") > MAX_BODY_BYTES)
    throw new KbBodyError("The article body is too large");
  if (/(?<!\\)(?:\\\\)*\\u0000/.test(serialised))
    throw new KbBodyError("The article body contains a NUL character");

  let nodes = 0;
  function clean(raw: unknown, depth: number): KbNode[] {
    if (!isRecord(raw)) return [];
    if (depth > MAX_BODY_DEPTH)
      throw new KbBodyError("The article body is nested too deeply");
    nodes += 1;
    if (nodes > MAX_BODY_NODES)
      throw new KbBodyError("The article body has too many nodes");
    const type = raw.type;
    if (typeof type !== "string") return [];
    if (type === "text") {
      const text = typeof raw.text === "string" ? raw.text : "";
      if (text.length === 0) return [];
      if (text.length > MAX_TEXT_LENGTH)
        throw new KbBodyError("A text run in the article body is too long");
      const marks = sanitiseMarks(raw.marks);
      return [marks ? { type: "text", text, marks } : { type: "text", text }];
    }
    const children = Array.isArray(raw.content)
      ? raw.content.flatMap((child) => clean(child, depth + 1))
      : [];
    if (type === "taskdeskIssueLink") {
      const attrs = nodeAttrs(type, isRecord(raw.attrs) ? raw.attrs : {});
      return attrs?.issueKey ? [{ type, attrs }] : [];
    }
    if (LEAF_NODES.has(type)) {
      const attrs = nodeAttrs(type, isRecord(raw.attrs) ? raw.attrs : {});
      if (type === "image" && !attrs) return [];
      return [attrs ? { type, attrs } : { type }];
    }
    if (CONTAINER_NODES.has(type)) {
      const attrs = nodeAttrs(type, isRecord(raw.attrs) ? raw.attrs : {});
      const node: KbNode = { type };
      if (attrs) node.attrs = attrs;
      if (children.length > 0) node.content = children;
      return [node];
    }
    // The shiki code block extension and any other unknown wrapper: keep what it holds.
    if (type === "shikiCodeBlock") {
      return [{ type: "codeBlock", content: children }];
    }
    return children;
  }

  const content = Array.isArray(input.content)
    ? input.content.flatMap((child) => clean(child, 1))
    : [];
  const doc: KbNode = {
    type: "doc",
    content: content.length > 0 ? content : [{ type: "paragraph" }],
  };
  return { doc, text: extractText(doc) };
}

/**
 * The customer's view of a document: internal callouts and work-item references are removed,
 * because node attributes can carry internal keys and titles (KB editor "customer preview").
 */
export function toCustomerBody(doc: KbNode): KbNode {
  function strip(node: KbNode): KbNode[] {
    if (node.type === "taskdeskIssueLink") return [];
    if (node.type === "callout" && node.attrs?.variant === "internal")
      return [];
    if (!node.content) return [node];
    const content = node.content.flatMap(strip);
    return [{ ...node, content }];
  }
  const [stripped] = strip(doc);
  const out = stripped ?? EMPTY_BODY;
  return out.content && out.content.length > 0
    ? out
    : { type: "doc", content: [{ type: "paragraph" }] };
}

/** Headings of a document for the generated table of contents. */
export function headingsOf(doc: KbNode): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  const visit = (node: KbNode) => {
    if (node.type === "heading") {
      const text = extractText(node);
      if (text) out.push({ level: Number(node.attrs?.level ?? 2), text });
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  return out;
}
