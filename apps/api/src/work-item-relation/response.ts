import { responseTimestamp, z } from "../openapi";
import { relationTypes } from "./schema";
export const relationSchema = z
  .object({
    id: z.string(),
    sourceId: z.string(),
    targetId: z.string(),
    type: z.enum(relationTypes),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("WorkItemRelation");
export const relationListSchema = z
  .object({
    data: z.array(
      z.object({
        id: z.string(),
        type: z.enum(relationTypes),
        label: z.enum([
          "relates",
          "blocks",
          "blocked_by",
          "duplicates",
          "duplicated_by",
          "precedes",
          "follows",
          "requires",
          "required_by",
        ]),
        item: z.object({
          id: z.string(),
          key: z.string(),
          title: z.string(),
          projectId: z.string(),
          stateName: z.string(),
          stateCategory: z.string(),
          assigneeName: z.string().nullable(),
        }),
        blockingCycle: z.boolean(),
        canRemove: z.boolean(),
      }),
    ),
    hiddenCount: z.number().int().nonnegative(),
  })
  .openapi("WorkItemRelations");
export const relationDeletionSchema = z.object({
  pendingActionId: z.string(),
  action: z.literal("delete"),
  summary: z.record(z.string(), z.unknown()),
  confirmation: z.literal("click"),
  expiresAt: z.string().datetime(),
  approveUrl: z.string(),
});
export const relationCandidatesSchema = z
  .object({
    data: z.array(
      z.object({
        id: z.string(),
        key: z.string(),
        title: z.string(),
        projectId: z.string(),
        stateName: z.string(),
        stateCategory: z.string(),
        assigneeName: z.string().nullable(),
      }),
    ),
    page: z.object({ hasMore: z.boolean(), nextCursor: z.string().nullable() }),
  })
  .openapi("WorkItemRelationCandidates");
