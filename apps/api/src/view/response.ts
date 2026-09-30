import { responseTimestamp, z } from "../openapi";

export const savedViewSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    createdBy: z.string(),
    name: z.string(),
    // `string`, not `z.enum`, matching this codebase's own convention for a column whose
    // vocabulary is enforced by a Postgres `CHECK` rather than Drizzle's type system
    // (`work-item/response.ts`'s `category` field is the same shape) -- the DB row Drizzle
    // returns types these columns as plain `string`.
    scope: z.string(),
    scopeId: z.string(),
    visibility: z.string(),
    sharedWithTeamId: z.string().nullable(),
    layout: z.string(),
    query: z.unknown(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("SavedView");

export const reachableSavedViewSchema = savedViewSchema
  .extend({ isPinned: z.boolean() })
  .openapi("ReachableSavedView");

export const reachableSavedViewListSchema = z.array(reachableSavedViewSchema);

export const pinnedViewIdsSchema = z
  .object({ pinnedViewIds: z.array(z.string()) })
  .openapi("PinnedViewIds");
