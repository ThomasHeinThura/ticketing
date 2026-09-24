import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

export const workItemSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    workspaceId: z.string(),
    typeId: z.string(),
    number: z.number().openapi({
      description:
        "Per-project sequence number. The key is `{project.slug}-{number}`.",
    }),
    key: z.string().openapi({ description: "e.g. PROJ-123. Permanent." }),
    title: z.string(),
    description: z.unknown().nullable(),
    stateId: z.string(),
    priority: z
      .string()
      .nullable()
      .openapi({ description: "One of: low, medium, high, urgent." }),
    assigneeId: z.string().nullable(),
    requesterId: z.string().nullable(),
    parentId: z.string().nullable(),
    position: z
      .string()
      .openapi({ description: "numeric(20,10) fractional rank, as a string." }),
    customerVisibility: z
      .string()
      .openapi({ description: "One of: private, organisation." }),
    startDate: nullableResponseTimestamp,
    dueDate: nullableResponseTimestamp,
    archivedAt: nullableResponseTimestamp,
    deletedAt: nullableResponseTimestamp,
    version: z.number(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("WorkItem");

export const workItemListSchema = z.array(workItemSchema);

// `WI-7`: a version mismatch on `PATCH /api/work-items/{key}` returns 409 with BOTH
// versions ("the caller's asserted version and the current server version") so the UI can
// offer a resolution -- structured JSON, not the plain-text `errorResponse()` shape every
// other error in this codebase uses, because there is genuinely structured data here for
// the client to act on, not just a message to display.
export const workItemVersionConflictSchema = z
  .object({
    message: z.string(),
    assertedVersion: z
      .number()
      .openapi({ description: "The version sent in If-Match." }),
    currentVersion: z
      .number()
      .openapi({ description: "The work item's actual current version." }),
  })
  .openapi("WorkItemVersionConflict");

// `assignment.md`: the assignment as applied. Narrow on purpose -- the caller needs to know
// who holds the item now, who held it before (so an undo/notification can name them) and the
// new version (an `If-Match` read either side of an assignment must not be stale).
export const assignWorkItemResponseSchema = z
  .object({
    key: z.string(),
    assigneeId: z.string(),
    previousAssigneeId: z.string().nullable(),
    version: z.number(),
  })
  .openapi("WorkItemAssignment");

// The spec's conditional-write conflict: zero rows updated because someone else changed the
// assignee first. Structured like `workItemVersionConflictSchema` -- there is real data for
// the client to act on (AS-3's confirmation flow shows who actually holds it now).
export const workItemAssigneeConflictSchema = z
  .object({
    message: z.string(),
    key: z.string(),
    currentAssigneeId: z.string().nullable().openapi({
      description:
        "Who actually holds the item now; null when it is unassigned.",
    }),
  })
  .openapi("WorkItemAssigneeConflict");

// `assignment.md` § API: `DELETE /api/work-items/{key}/assign`. The assignment as
// cleared. `assigneeId` is null BY TYPE -- a client cannot mistake "cleared" for "field
// missing" -- and `previousAssigneeId` still names who to notify (`AS-17`) or to show in
// an activity feed.
export const unassignWorkItemResponseSchema = z
  .object({
    key: z.string(),
    assigneeId: z.null(),
    previousAssigneeId: z.string().nullable(),
    version: z.number(),
  })
  .openapi("WorkItemUnassignment");
