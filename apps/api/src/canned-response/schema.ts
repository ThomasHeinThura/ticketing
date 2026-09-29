import { z } from "../openapi";

// Same NUL-byte discipline as `work-item/schema.ts`'s `containsNulByte` (S4, independent
// Opus security review of PR #271) -- kept local, same shape, per this codebase's
// partition-by-file convention.
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

const idField = z
  .string()
  .min(1)
  .refine((value) => !containsNulByte(value), NO_NUL_BYTE_MESSAGE);

export const workspaceIdQuery = z.object({ workspaceId: idField });

export const cannedResponseIdParam = z.object({ id: idField });

const cannedResponseName = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !containsNulByte(value), NO_NUL_BYTE_MESSAGE);

// `CA-19`: "reusable snippets with placeholders for requester name, work item key and due
// date" -- the placeholder syntax itself is a composer/render-time concern (out of this
// PR's scope, same as every other Tiptap-body field in this codebase); `body` is accepted
// as opaque Tiptap JSON here, matching `work-item/comment-schema.ts`'s own treatment.
const cannedResponseBody = z
  .unknown()
  .refine((value) => !containsNulByte(value), NO_NUL_BYTE_MESSAGE);

export const createCannedResponseBody = z.object({
  workspaceId: idField,
  name: cannedResponseName,
  body: cannedResponseBody,
  visibilityDefault: z.enum(["public", "internal"]).optional(),
});

export const updateCannedResponseBody = z
  .object({
    name: cannedResponseName.optional(),
    body: cannedResponseBody.optional(),
    visibilityDefault: z.enum(["public", "internal"]).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field must be supplied",
  });
