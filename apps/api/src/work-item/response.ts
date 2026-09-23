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
