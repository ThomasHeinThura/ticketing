import { Table, TableBody, TableCell, TableHead, TableRow } from "@taskdesk/ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import "@/components/task/editor-styles.css";

/**
 * Read-only render of an article's Tiptap JSON document (KB-5). The server has already
 * sanitised the document against its allowlist; this renders by an allowlist of its own and
 * never injects markup, so unknown nodes render their children and nothing else. It does not
 * import the editor, so the portal bundle can use it. Styling reuses the editor's prose class
 * so an article reads exactly as it does in Kaneo's description editor.
 */
export type KbNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: KbNode[];
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
  text?: string;
};

export type KbHeading = { id: string; level: number; text: string };

function plain(node: KbNode): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(plain).join("");
}

function slug(text: string) {
  return (
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

/** Headings of a document with stable, unique anchor ids (the long-article table of contents). */
export function documentHeadings(body: unknown): KbHeading[] {
  const headings: KbHeading[] = [];
  const used = new Map<string, number>();
  const visit = (node: KbNode) => {
    if (node.type === "heading") {
      const text = plain(node).trim();
      if (text) {
        const base = slug(text);
        const seen = used.get(base) ?? 0;
        used.set(base, seen + 1);
        headings.push({
          id: seen === 0 ? base : `${base}-${seen + 1}`,
          level: Number(node.attrs?.level ?? 2),
          text,
        });
      }
    }
    for (const child of node.content ?? []) visit(child);
  };
  if (body && typeof body === "object") visit(body as KbNode);
  return headings;
}

const SAFE_HREF = /^(https?:|mailto:|tel:|\/(?!\/))/i;
const SAFE_IMAGE = /^https:/i;

function safeHref(value: unknown) {
  return typeof value === "string" && SAFE_HREF.test(value.trim())
    ? value.trim()
    : undefined;
}

type Renderers = {
  /** Agent-only: a work item reference (KB-6). Customers never receive these nodes. */
  issueLink?: (attrs: { issueKey: string }) => ReactNode;
};

function renderText(node: KbNode, key: string): ReactNode {
  let out: ReactNode = node.text ?? "";
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") out = <strong>{out}</strong>;
    else if (mark.type === "italic") out = <em>{out}</em>;
    else if (mark.type === "underline") out = <u>{out}</u>;
    else if (mark.type === "strike") out = <s>{out}</s>;
    else if (mark.type === "code") out = <code>{out}</code>;
    else if (mark.type === "link") {
      const href = safeHref(mark.attrs?.href);
      if (href)
        out = (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow">
            {out}
          </a>
        );
    }
  }
  return <span key={key}>{out}</span>;
}

function renderNodes(
  nodes: KbNode[] | undefined,
  path: string,
  headings: { next: () => string },
  renderers: Renderers,
): ReactNode[] {
  return (nodes ?? []).map((node, index) =>
    renderNode(node, `${path}.${index}`, headings, renderers),
  );
}

function renderNode(
  node: KbNode,
  key: string,
  headings: { next: () => string },
  renderers: Renderers,
): ReactNode {
  const children = () => renderNodes(node.content, key, headings, renderers);
  switch (node.type) {
    case "text":
      return renderText(node, key);
    case "paragraph":
      return <p key={key}>{children()}</p>;
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 2), 1), 6);
      const Tag = `h${level}` as "h1";
      return (
        <Tag key={key} id={headings.next()}>
          {children()}
        </Tag>
      );
    }
    case "bulletList":
      return <ul key={key}>{children()}</ul>;
    case "orderedList":
      return <ol key={key}>{children()}</ol>;
    case "listItem":
      return <li key={key}>{children()}</li>;
    case "taskList":
      return (
        <ul key={key} data-type="taskList">
          {children()}
        </ul>
      );
    case "taskItem": {
      const checked = node.attrs?.checked === true;
      return (
        <li key={key} data-type="taskItem" data-checked={checked}>
          <span aria-hidden="true">{checked ? "☑" : "☐"}</span>
          <div>{children()}</div>
        </li>
      );
    }
    case "blockquote":
      return <blockquote key={key}>{children()}</blockquote>;
    case "callout":
      return (
        <aside
          key={key}
          data-variant={String(node.attrs?.variant ?? "info")}
          className="my-3 rounded-md border border-border bg-muted/40 px-4 py-2"
        >
          {children()}
        </aside>
      );
    case "codeBlock":
      return (
        <pre key={key}>
          <code>{plain(node)}</code>
        </pre>
      );
    case "horizontalRule":
      return <hr key={key} />;
    case "hardBreak":
      return <br key={key} />;
    case "image": {
      const src = node.attrs?.src;
      if (typeof src !== "string" || !SAFE_IMAGE.test(src)) return null;
      return (
        <img
          key={key}
          src={src}
          alt={typeof node.attrs?.alt === "string" ? node.attrs.alt : ""}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="taskdesk-editor-image"
        />
      );
    }
    case "table":
      return (
        <Table key={key}>
          <TableBody>{children()}</TableBody>
        </Table>
      );
    case "tableRow":
      return <TableRow key={key}>{children()}</TableRow>;
    case "tableHeader":
      return <TableHead key={key}>{children()}</TableHead>;
    case "tableCell":
      return <TableCell key={key}>{children()}</TableCell>;
    case "taskdeskIssueLink": {
      const issueKey = node.attrs?.issueKey;
      if (!renderers.issueLink || typeof issueKey !== "string") return null;
      return <span key={key}>{renderers.issueLink({ issueKey })}</span>;
    }
    default:
      return <span key={key}>{children()}</span>;
  }
}

export function KbArticleContent({
  body,
  className,
  renderers = {},
}: {
  body: unknown;
  className?: string;
  renderers?: Renderers;
}) {
  const root = (body && typeof body === "object" ? body : {}) as KbNode;
  const anchors = documentHeadings(root).map((heading) => heading.id);
  let cursor = 0;
  const headings = {
    next: () => anchors[cursor++] ?? `section-${cursor}`,
  };
  return (
    <div
      className={cn(
        "taskdesk-comment-editor-prose taskdesk-comment-editor-prose-readonly text-[0.965rem] leading-[1.72]",
        className,
      )}
    >
      {renderNodes(root.content, "n", headings, renderers)}
    </div>
  );
}

/** A table of contents for a long article: only shown from three headings up. */
export function KbTableOfContents({
  body,
  label,
}: {
  body: unknown;
  label: string;
}) {
  const headings = documentHeadings(body);
  if (headings.length < 3) return null;
  return (
    <nav aria-label={label} className="rounded-md border border-border p-3">
      <p className="mb-2 font-medium text-sm">{label}</p>
      <ul className="flex flex-col gap-1 text-sm">
        {headings.map((heading) => (
          <li
            key={heading.id}
            style={{ paddingInlineStart: `${(heading.level - 1) * 12}px` }}
          >
            <a
              className="text-muted-foreground hover:underline"
              href={`#${heading.id}`}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * What a customer will see: internal callouts and work item references are removed. This
 * mirrors the server's `toCustomerBody`, which is the real guard; the editor uses it only
 * to show the author a live customer preview.
 */
export function customerView(body: unknown): KbNode {
  const strip = (node: KbNode): KbNode[] => {
    if (node.type === "taskdeskIssueLink") return [];
    if (node.type === "callout" && node.attrs?.variant === "internal")
      return [];
    if (!node.content) return [node];
    return [{ ...node, content: node.content.flatMap(strip) }];
  };
  const root = (body && typeof body === "object" ? body : {}) as KbNode;
  return strip(root)[0] ?? { type: "doc", content: [] };
}

/** Node types a document uses, so the editor can say what the server dropped on save (KB-5). */
export function nodeTypesOf(body: unknown): Set<string> {
  const types = new Set<string>();
  const visit = (node: KbNode) => {
    if (node.type) types.add(node.type);
    for (const child of node.content ?? []) visit(child);
  };
  if (body && typeof body === "object") visit(body as KbNode);
  return types;
}

/** Node types that were sent but did not come back: the server's allowlist removed them. */
export function removedNodeTypes(sent: unknown, saved: unknown): string[] {
  const kept = nodeTypesOf(saved);
  // The shiki extension saves as a plain code block.
  if (kept.has("codeBlock")) kept.add("shikiCodeBlock");
  return [...nodeTypesOf(sent)].filter((type) => !kept.has(type)).sort();
}

/** Does the document hold anything a customer will not see? */
export function hasInternalContent(body: unknown): boolean {
  return JSON.stringify(customerView(body)) !== JSON.stringify(body ?? null);
}
