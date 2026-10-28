export type CommentDeletionSummary = {
  commentId: string;
  key: string;
  title: string;
  visibility: "public" | "internal";
  preview: string;
  alreadyDeleted: boolean;
};

/** Bounded plain-text preview; never render arbitrary rich-document attributes or HTML. */
function commentPreview(body: unknown) {
  if (typeof body === "string") return body.slice(0, 4000);
  const pending: unknown[] = [body];
  const text: string[] = [];
  let visited = 0;
  let length = 0;
  while (pending.length && visited++ < 4096 && length < 4000) {
    const value = pending.pop();
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const node = value as Record<string, unknown>;
    if (typeof node.text === "string") {
      const part = node.text.slice(0, 4000 - length);
      text.push(part);
      length += part.length;
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content
        .slice(0, 4096 - pending.length)
        .reverse())
        pending.push(child);
    }
  }
  return text.join(" ").slice(0, 4000);
}

export function parseCommentDeletionSummary(
  value: unknown,
): CommentDeletionSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    row.redacted === true ||
    typeof row.commentId !== "string" ||
    !/^[A-Za-z0-9_-]{1,256}$/u.test(row.commentId) ||
    typeof row.key !== "string" ||
    !/^[A-Z][A-Z0-9]*-[1-9]\d*$/u.test(row.key) ||
    typeof row.title !== "string" ||
    !row.title.trim() ||
    row.title.length > 500 ||
    (row.visibility !== "public" && row.visibility !== "internal") ||
    !Object.hasOwn(row, "commentBody")
  )
    return null;
  return {
    commentId: row.commentId,
    key: row.key,
    title: row.title,
    visibility: row.visibility,
    preview: commentPreview(row.commentBody),
    alreadyDeleted: row.alreadyDeleted === true,
  };
}
