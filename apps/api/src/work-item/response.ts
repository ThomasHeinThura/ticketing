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
    archivedAt: nullableResponseTimestamp,
    deletedAt: nullableResponseTimestamp,
    version: z.number(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("WorkItem");

export const workItemListSchema = z.array(workItemSchema);
