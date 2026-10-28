import { z } from "../../openapi";

export const submissionSavedViewStates = [
  "new",
  "clarifying",
  "accepted",
  "declined",
  "duplicate",
  "withdrawn",
] as const;

/**
 * Submission views deliberately reuse the staff queue's persisted filter names. These
 * are not the work-item search grammar and must not acquire its fields by accident.
 */
export const submissionSavedViewFilterSchema = z
  .object({
    state: z.enum(submissionSavedViewStates).optional(),
    requestTypeKey: z.string().min(1).max(200).optional(),
    assignee: z.string().min(1).max(200).optional(),
    olderThanDays: z.number().int().min(0).max(3650).optional(),
  })
  .strict();

export const submissionSavedViewQuerySchema = z
  .object({
    entity: z.literal("submission"),
    filter: submissionSavedViewFilterSchema.optional(),
  })
  .strict();

export const queuePairIdParam = z.object({
  id: z.string().min(1).max(128),
});

export const queueWorkspaceQuery = z.object({
  workspaceId: z.string().min(1).max(200),
});

export const queueListQuery = queueWorkspaceQuery;

export const queueSubmissionOverridesSchema = z
  .object({
    state: z.enum(submissionSavedViewStates).optional(),
    requestTypeKey: z.string().min(1).max(200).optional(),
    assignee: z.string().min(1).max(200).optional(),
    olderThanDays: z.coerce.number().int().min(0).max(3650).optional(),
  })
  .strict();

export const queueRunQuery = queueWorkspaceQuery
  .extend({
    submissionCursor: z.string().max(4096).optional(),
    workItemCursor: z.string().max(4096).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    state: z.enum(submissionSavedViewStates).optional(),
    requestTypeKey: z.string().min(1).max(200).optional(),
    assignee: z.string().min(1).max(200).optional(),
    olderThanDays: z.coerce.number().int().min(0).max(3650).optional(),
    workItemFilter: z.string().trim().max(8192).optional(),
    workItemSorts: z.string().max(2048).optional(),
    workItemColumns: z.string().max(8192).optional(),
  })
  .strict();

export const queuePairBody = z
  .object({
    workspaceId: z.string().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    visibility: z.enum(["private", "team"]),
    sharedWithTeamId: z.string().min(1).max(200).optional(),
    submissionQuery: submissionSavedViewQuerySchema,
    workItemQuery: z
      .object({
        entity: z.literal("work_item"),
        filter: z.record(z.string(), z.unknown()).optional(),
        sort: z
          .array(
            z.object({
              field: z.string().min(1).max(100),
              direction: z.enum(["asc", "desc"]),
            }),
          )
          .optional(),
        groupBy: z.string().optional(),
        columns: z.array(z.string().min(1).max(100)).optional(),
        aggregate: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();

export const queuePairPatchBody = z
  .object({
    workspaceId: z.string().min(1).max(200),
    expectedVersions: z
      .object({
        submission: z.number().int().safe().min(1),
        workItem: z.number().int().safe().min(1),
      })
      .strict(),
    name: z.string().trim().min(1).max(200).optional(),
    visibility: z.enum(["private", "team"]).optional(),
    sharedWithTeamId: z.string().min(1).max(200).nullable().optional(),
    submissionQuery: submissionSavedViewQuerySchema.optional(),
    workItemQuery: z
      .object({
        entity: z.literal("work_item"),
        filter: z.record(z.string(), z.unknown()).optional(),
        sort: z
          .array(
            z.object({
              field: z.string().min(1).max(100),
              direction: z.enum(["asc", "desc"]),
            }),
          )
          .optional(),
        groupBy: z.string().optional(),
        columns: z.array(z.string().min(1).max(100)).optional(),
        aggregate: z.record(z.string(), z.unknown()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.visibility !== undefined ||
      value.sharedWithTeamId !== undefined ||
      value.submissionQuery !== undefined ||
      value.workItemQuery !== undefined,
    { message: "At least one queue property must be updated" },
  );
