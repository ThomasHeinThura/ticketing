import { z } from "../openapi";
import {
  workItemCustomFieldColumnSchema,
  workItemListItemSchema,
  workItemPageSchema,
} from "./response";

/** A real workspace state template used as a shared board presentation column. */
export const combinedWorkItemColumnSchema = z
  .object({
    templateId: z.string(),
    name: z.string(),
    group: z.enum([
      "backlog",
      "unstarted",
      "started",
      "completed",
      "cancelled",
    ]),
    /** Minimum configured concrete-state position among visible descendant projects. */
    position: z.number().int(),
  })
  .openapi("CombinedWorkItemColumn");

/** A row on a parent project's combined board, with its actual source project visible. */
export const combinedWorkItemListItemSchema = workItemListItemSchema
  .extend({
    stateTemplateId: z.string(),
    sourceProject: z.object({
      id: z.string(),
      key: z.string(),
      name: z.string(),
    }),
  })
  .openapi("CombinedWorkItemListItem");

export type CombinedWorkItemListResponse = {
  data: Array<z.infer<typeof combinedWorkItemListItemSchema>>;
  columns: Array<z.infer<typeof combinedWorkItemColumnSchema>>;
  page: z.infer<typeof workItemPageSchema>;
  meta: { total: number };
  customFieldColumns?: Array<z.infer<typeof workItemCustomFieldColumnSchema>>;
  customFieldPeople?: Array<{
    projectId: string;
    personId: string;
    name: string | null;
  }>;
};

// Bound the public DTO type so Hono need not recursively expand the entire
// inherited Zod implementation type. The runtime schema remains fully checked.
export const combinedWorkItemListResponseSchema: z.ZodType<CombinedWorkItemListResponse> =
  z
    .object({
      data: z.array(combinedWorkItemListItemSchema),
      columns: z.array(combinedWorkItemColumnSchema),
      page: workItemPageSchema,
      meta: z.object({ total: z.number() }),
      customFieldColumns: z.array(workItemCustomFieldColumnSchema).optional(),
      customFieldPeople: z
        .array(
          z.object({
            projectId: z.string(),
            personId: z.string(),
            name: z.string().nullable(),
          }),
        )
        .optional(),
    })
    .openapi("CombinedWorkItemListResponse");
