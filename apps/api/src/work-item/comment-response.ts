import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

// `data-model.md` §4's `comment` row, narrowed to what a caller needs back. A CA-18
// tombstone includes the persisted deleting actor id so the client can resolve its display
// name using the same workspace member directory as other activity actors.
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
    deletedBy: z.string().nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("Comment");
