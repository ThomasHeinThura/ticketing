import { z } from "../openapi";

// Same rule `work-item/schema.ts`'s own `containsNulByte` enforces for `work_item.title`/
// `.description` (S4, independent Opus security review of PR #271): Postgres `text`/
// `jsonb` both reject a NUL byte outright, which would otherwise reach the database
// unvalidated and 500 instead of this route's normal 400. Not re-exported from that file
// (unexported there) -- kept local, same shape, so this module stays independently
// reviewable per file, matching this codebase's own "partition by file" convention.
function containsNulByte(value: unknown): boolean {
  if (typeof value === "string") return value.includes("\u0000");
  if (Array.isArray(value)) return value.some(containsNulByte);
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, entry]) => key.includes("\u0000") || containsNulByte(entry),
    );
  }
  return false;
}

const NO_NUL_BYTE_MESSAGE =
  "must not contain a NUL (\\u0000) byte -- Postgres text/jsonb columns reject it";

// `CA-11`: "The serialized `body jsonb` document is capped at 256 KiB and 10,000 nodes."
export const COMMENT_BODY_MAX_BYTES = 256 * 1024;
export const COMMENT_BODY_MAX_NODES = 10_000;

/** Byte length of the document as it will actually be stored -- `TextEncoder`, not
 * `.length`, so a multi-byte character is counted the same way Postgres's own storage
 * (and CA-11's "256 KiB") counts it. */
function serializedByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** Counts every Tiptap/ProseMirror content node (an object carrying its own `type`),
 * recursing into `content` arrays only -- `marks` (bold/italic/etc.) decorate a node, they
 * are not nodes of their own in this document model, so they are not counted. */
function countNodes(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((sum: number, entry) => sum + countNodes(entry), 0);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const self = typeof record.type === "string" ? 1 : 0;
    return self + countNodes(record.content);
  }
  return 0;
}

/** Links are stored as caller-supplied Tiptap JSON, so paste-time URL validation is not
 * enough. Accept same-origin absolute paths and absolute HTTP(S) URLs only. A single
 * leading slash is app-relative; `//host`, backslash-normalised paths, control characters,
 * other schemes, and credential-bearing URLs are rejected. */
function containsUnsafeUrlCharacters(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x5c || code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function isSafeCommentLinkUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    containsUnsafeUrlCharacters(value)
  ) {
    return false;
  }

  if (value.startsWith("/")) {
    return value === "/" || (value.length > 1 && value[1] !== "/");
  }

  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

/** Inspect both content nodes and marks without recursive calls. The document is size
 * bounded above, and this iterative walk also avoids stack growth on hostile nested JSON. */
function containsUnsafeCommentLink(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (current === null || typeof current !== "object") continue;

    const record = current as Record<string, unknown>;
    const attrs =
      record.attrs !== null && typeof record.attrs === "object"
        ? (record.attrs as Record<string, unknown>)
        : undefined;

    if (record.type === "link" && !isSafeCommentLinkUrl(attrs?.href)) {
      return true;
    }
    if (
      record.type === "taskdeskIssueLink" &&
      attrs?.url !== undefined &&
      attrs.url !== "" &&
      !isSafeCommentLinkUrl(attrs.url)
    ) {
      return true;
    }
    if (record.type === "image" && attrs?.src !== undefined) {
      if (!isSafeCommentLinkUrl(attrs.src)) return true;
    }

    pending.push(...Object.values(record));
  }
  return false;
}

// `CA-11`: rich-text body, opaque Tiptap JSON (this route does not validate document
// shape beyond the size/node caps) -- same "accept as opaque JSON" treatment
// `work-item/schema.ts`'s `workItemDescription` gives `work_item.description`.
export const commentBody = z
  .unknown()
  .refine((value) => !containsNulByte(value), NO_NUL_BYTE_MESSAGE)
  .refine(
    (value) => serializedByteLength(value) <= COMMENT_BODY_MAX_BYTES,
    `body must not exceed ${COMMENT_BODY_MAX_BYTES} bytes (256 KiB)`,
  )
  .refine(
    (value) => countNodes(value) <= COMMENT_BODY_MAX_NODES,
    `body must not exceed ${COMMENT_BODY_MAX_NODES} nodes`,
  )
  .refine(
    (value) => !containsUnsafeCommentLink(value),
    "body contains a link with an unsafe URL",
  );

// `CA-1`: "Visibility is chosen explicitly at composition" -- required, no default.
export const commentVisibility = z.enum(["public", "internal"]);

const commentIdField = z
  .string()
  .min(1)
  .refine((value) => !containsNulByte(value), NO_NUL_BYTE_MESSAGE);

export const createCommentBody = z.object({
  body: commentBody,
  visibility: commentVisibility,
});

export const updateCommentBody = z.object({
  body: commentBody,
});

export const commentIdParam = z.object({
  id: commentIdField,
});
