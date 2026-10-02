import type { JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskList from "@tiptap/extension-task-list";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useTranslation } from "react-i18next";
import { TaskItemWithCheckbox } from "@/components/task/extensions/task-item-with-checkbox";
import { TaskDeskIssueLink } from "@/components/task/extensions/taskdesk-issue-link";
import { TaskDeskMention } from "@/components/task/extensions/taskdesk-mention";
import { isSafeLinkUrl } from "@/components/task/extensions/url-safety";
import { getApiUrl } from "@/fetchers/get-api-url";

const COMMENT_NODE_TYPES = new Set([
  "doc",
  "paragraph",
  "text",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
  "image",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "taskdeskIssueLink",
  "taskdeskMention",
  "attachmentCard",
  "embedBlock",
]);
const COMMENT_MARK_TYPES = new Set([
  "bold",
  "italic",
  "strike",
  "code",
  "link",
  "underline",
  "highlight",
]);

/** Read-only Tiptap renderer for the JSON document stored on a comment. */
export default function WorkItemActivityComment({ body }: { body: unknown }) {
  const { t } = useTranslation();
  const document = isTiptapDocument(body)
    ? (sanitizeCommentDocument(body, t) as JSONContent)
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
function sanitizeCommentDocument(
  value: unknown,
  t: ReturnType<typeof useTranslation>["t"],
): unknown {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const sanitized = sanitizeCommentDocument(entry, t);
      return sanitized === null
        ? []
        : Array.isArray(sanitized)
          ? sanitized
          : [sanitized];
    });
  }
  if (value === null || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  if (typeof record.type === "string") {
    if (COMMENT_MARK_TYPES.has(record.type)) {
      // Recognized below, where link marks receive URL validation.
    } else if (!COMMENT_NODE_TYPES.has(record.type)) {
      return null;
    }
  }
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
      sanitizeCommentDocument(entry, t),
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
  if (record.type === "attachmentCard") {
    const filename =
      typeof attrs?.filename === "string" && attrs.filename.trim()
        ? attrs.filename
        : t("tasks:detail.editor.attachFile");
    const resolvedUrl = resolveAppAttachmentUrl(attrs?.url);
    return {
      type: "text",
      text: filename,
      ...(resolvedUrl
        ? { marks: [{ type: "link", attrs: { href: resolvedUrl } }] }
        : {}),
    };
  }
  if (record.type === "embedBlock") {
    // Stored embed URLs are untrusted. Show an inert explanation instead of
    // creating an iframe or outbound link in the comment reader.
    return {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: t("tasks:detail.editor.embed.onlyYoutubeInline"),
        },
      ],
    };
  }
  if (
    record.type === "codeBlock" &&
    (attrs?.language === "mermaid" || attrs?.language === "Mermaid")
  ) {
    // The editable Mermaid extension schedules renders through editor plugins.
    // Keep the submitted source visible without running those plugins here.
    return [
      {
        type: "paragraph",
        content: [
          { type: "text", text: t("tasks:detail.editor.mermaid.renderFailed") },
        ],
      },
      sanitized,
    ];
  }
  return sanitized;
}
