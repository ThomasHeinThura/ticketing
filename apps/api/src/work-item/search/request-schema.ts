import { z } from "../../openapi";

/** Shared wire shape; semantic validation remains in validateWorkItemSearchQuery. */
export const workItemSearchRequestSchema = z
  .object({
    workspaceId: z.string().min(1),
    query: z
      .object({
        entity: z.string(),
        filter: z.unknown().optional(),
        sort: z
          .array(z.object({ field: z.string(), order: z.string() }).strict())
          .max(5)
          .optional(),
        columns: z.array(z.string()).optional(),
        groupBy: z.unknown().optional(),
        aggregate: z.unknown().optional(),
      })
      .strict(),
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().max(2048).nullable().optional(),
  })
  .strict();
