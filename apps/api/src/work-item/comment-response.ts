import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

// `data-model.md` §4's `comment` row, narrowed to what a caller needs back. A CA-18
// tombstone includes the persisted deleting actor id so the client can name the
// deleter (who can differ from the author) through the same reach-filtered directory it
// uses for every other actor.
export const commentSchema = z
  .object({
    id: z.string(),
    workItemId: z.string(),
    workspaceId: z.string(),
    authorId: z.string().nullable().openapi({
      description:
        "Canonical person ID for new comments. Historical user-ID authors are retained and resolved without rewriting history.",
    }),
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
    origin: z.string().nullable().optional().openapi({
      description:
        "`imported` for a comment an import wrote (createdAt is then the source time); null for a native comment.",
    }),
    importedAt: nullableResponseTimestamp.optional(),
  })
  .openapi("Comment");
