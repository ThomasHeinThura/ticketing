import { nullableResponseTimestamp, responseTimestamp, z } from "../../openapi";

export const workItemTemplateSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    typeId: z.string(),
    name: z.string(),
    title: z.string(),
    description: z.unknown().nullable(),
    labelIds: z.array(z.string()),
    customFieldValues: z.record(z.string(), z.unknown()),
    checklistTemplateId: z.string().nullable(),
    archivedAt: nullableResponseTimestamp,
    version: z.number(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("WorkItemTemplate");

export const workItemTemplateListSchema = z
  .array(workItemTemplateSchema)
  .openapi("WorkItemTemplateList");

/** What a create dialog's template picker reads: live templates only, no stored values. */
export const workItemTemplateOptionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    typeId: z.string(),
    title: z.string(),
    hasChecklist: z.boolean(),
  })
  .openapi("WorkItemTemplateOption");

export const workItemTemplateOptionListSchema = z
  .array(workItemTemplateOptionSchema)
  .openapi("WorkItemTemplateOptionList");

export const checklistTemplateSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    name: z.string(),
    items: z.array(
      z.object({ id: z.string(), position: z.number(), text: z.string() }),
    ),
    archivedAt: nullableResponseTimestamp,
    version: z.number(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("ChecklistTemplate");

export const checklistTemplateListSchema = z
  .array(checklistTemplateSchema)
  .openapi("ChecklistTemplateList");
