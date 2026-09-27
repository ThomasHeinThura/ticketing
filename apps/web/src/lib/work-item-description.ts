/**
 * Builds the `description` value `POST /api/projects/{projectId}/work-items` accepts from
 * the create dialog's plain-text textarea.
 *
 * `work_item.description` is opaque `jsonb`, and the shape the rest of the app writes and
 * reads is a Tiptap document (`task-description.tsx`'s editor). The dialog takes plain
 * text for now (no rich-text editor in this slice), so this wraps each non-empty line in a
 * paragraph node of that same document shape — blank lines are dropped, and everything
 * else survives verbatim. Returns `undefined` for empty input so the field is omitted
 * from the request rather than sent as an empty document (`WI-3`: everything besides the
 * title is optional).
 */
export function descriptionFromPlainText(text: string): unknown | undefined {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return undefined;

  return {
    type: "doc",
    content: lines.map((line) => ({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    })),
  };
}
