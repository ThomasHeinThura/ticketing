import type { JsonValue } from "@taskdesk/domain";

/**
 * `WF-12`: a transition note is stored as a comment, so its `body` has the same Tiptap document
 * shape every other comment writer stores (one paragraph per line). A bare string would not
 * render in the portal timeline or the agent comment list.
 */
export function plainTextNoteDocument(text: string): JsonValue {
  return {
    type: "doc",
    content: text
      .replace(/\r\n?/gu, "\n")
      .split("\n")
      .map(
        (line): JsonValue =>
          line.length > 0
            ? { type: "paragraph", content: [{ type: "text", text: line }] }
            : { type: "paragraph" },
      ),
  };
}

/** Plain text of a stored comment body, tolerating a legacy bare-string body (read-side fallback). */
export function commentBodyText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const node = value as { text?: unknown; content?: unknown[] };
  if (typeof node.text === "string") return node.text;
  return Array.isArray(node.content)
    ? node.content.map(commentBodyText).filter(Boolean).join("\n")
    : "";
}
