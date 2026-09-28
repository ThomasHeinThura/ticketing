import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

// `data-model.md` §4's `comment` row, narrowed to what a caller needs back. `deletedBy` is
// omitted from the response on purpose: the tombstone text (CA-18: "Comment deleted by
// Jane, 2 March") is rendered client-side from `authorId`'s own display name plus
// `deletedAt`, the same way every other actor-attributed row in this codebase resolves a
// display name from an id rather than shipping a second denormalised name field for it.
export const commentSchema = z
  .object({
    id: z.string(),
    workItemId: z.string(),
    workspaceId: z.string(),
    authorId: z.string().nullable(),
    actorType: z.string().openapi({
      description: "One of: person, automation, system, api_key.",
    }),
    body: z.unknown().nullable().openapi({
      description: "Tiptap document. Null once the comment is deleted (CA-18).",
    }),
    visibility: z
      .string()
      .openapi({ description: "One of: public, internal." }),
    activityId: z.string().nullable(),
    editedAt: nullableResponseTimestamp,
    deletedAt: nullableResponseTimestamp,
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("Comment");
