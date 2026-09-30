import type { JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskList from "@tiptap/extension-task-list";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItemWithCheckbox } from "@/components/task/extensions/task-item-with-checkbox";
import { TaskDeskIssueLink } from "@/components/task/extensions/taskdesk-issue-link";
import { TaskDeskMention } from "@/components/task/extensions/taskdesk-mention";
import { isSafeLinkUrl } from "@/components/task/extensions/url-safety";
import { getApiUrl } from "@/fetchers/get-api-url";

/** Read-only Tiptap renderer for the JSON document stored on a comment. */
export default function WorkItemActivityComment({ body }: { body: unknown }) {
  const document = isTiptapDocument(body)
    ? (sanitizeCommentDocument(body) as JSONContent)
    : null;
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    content: document as JSONContent | undefined,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        trailingNode: false,
      }),
      TaskList,
      TaskItemWithCheckbox.configure({ nested: true }),
      Image.configure({
        HTMLAttributes: { class: "taskdesk-editor-image", loading: "lazy" },
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      TaskDeskIssueLink,
      TaskDeskMention,
    ],
    editorProps: {
      attributes: {
        class:
          "taskdesk-comment-editor-prose taskdesk-comment-editor-prose-readonly",
      },
    },
  });

  if (typeof body === "string") {
    return <p className="whitespace-pre-wrap">{body}</p>;
  }
  if (!document) return null;

  return <EditorContent editor={editor} />;
}

function isTiptapDocument(value: unknown): value is JSONContent {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function resolveAppAttachmentUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^\/api\/asset\/([A-Za-z0-9_-]+)$/.exec(value);
  if (!match) return null;
  return getApiUrl(`asset/${encodeURIComponent(match[1])}`);
}

/** Stored JSON can bypass Tiptap's paste/HTML URI checks. Drop unsafe link marks while
 * preserving their text, and make unsafe issue-link/image nodes inert on render. */
function sanitizeCommentDocument(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeCommentDocument).filter((entry) => entry !== null);
  }
  if (value === null || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const attrs =
    record.attrs !== null && typeof record.attrs === "object"
      ? (record.attrs as Record<string, unknown>)
      : undefined;
  if (record.type === "link" && !isSafeLinkUrl(String(attrs?.href ?? ""))) {
    return null;
  }

  const sanitized = Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      sanitizeCommentDocument(entry),
    ]),
  );
  const sanitizedAttrs =
    sanitized.attrs !== null && typeof sanitized.attrs === "object"
      ? (sanitized.attrs as Record<string, unknown>)
      : undefined;
  if (
    record.type === "taskdeskIssueLink" &&
    typeof sanitizedAttrs?.url === "string" &&
    sanitizedAttrs.url !== "" &&
    !isSafeLinkUrl(sanitizedAttrs.url)
  ) {
    sanitized.attrs = { ...sanitizedAttrs, url: "" };
  }
  if (record.type === "image") {
    const resolvedSrc = resolveAppAttachmentUrl(attrs?.src);
    if (!resolvedSrc || !sanitizedAttrs) return null;
    sanitized.attrs = { ...sanitizedAttrs, src: resolvedSrc };
  }
  return sanitized;
}
