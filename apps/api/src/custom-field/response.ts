import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import {
  CUSTOM_FIELD_FORMATS,
  type CustomFieldFormat,
  VISIBILITY_OPS,
} from "./logic";
import { optionSchema, visibilityRowSchema } from "./schema";

export const customFieldSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  sectionId: z.string(),
  entityType: z.literal("work_item"),
  key: z.string(),
  name: z.string(),
  format: z.enum(CUSTOM_FIELD_FORMATS),
  options: z.array(optionSchema),
  defaultValue: z.unknown().nullable(),
  helpText: z.string().nullable(),
  customerVisible: z.boolean(),
  visibilityCondition: z
    .object({
      field_key: z.string(),
      op: z.enum(VISIBILITY_OPS),
      value: z.unknown().optional(),
    })
    .nullable(),
  position: z.number().int(),
  deletedAt: nullableResponseTimestamp,
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
  visibility: z.array(visibilityRowSchema),
});

export const customFieldWithUsageSchema = customFieldSchema.extend({
  usageCount: z.number().int().min(0),
});

export const customFieldListSchema = z.object({
  data: z.array(customFieldWithUsageSchema),
  meta: z.object({
    total: z.number().int().min(0),
    /** True once active fields reach the 100-field warning threshold (contract edge case). */
    manyFieldsWarning: z.boolean(),
  }),
});

export const customFieldSectionSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  position: z.number().int(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
});
export const customFieldSectionListSchema = z.object({
  data: z.array(customFieldSectionSchema),
});

export const nonCompliantItemsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      key: z.string(),
      title: z.string(),
      projectId: z.string(),
    }),
  ),
});

export const okSchema = z.object({ ok: z.literal(true) });

/** One field as it applies to a work item, with the item's value (work item detail payload). */
export const workItemCustomFieldSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  format: z.enum(CUSTOM_FIELD_FORMATS),
  sectionId: z.string(),
  sectionName: z.string(),
  options: z.array(optionSchema),
  helpText: z.string().nullable(),
  required: z.boolean(),
  /** False while a conditional field's condition is unmet (CF-6); the client hides it. */
  shown: z.boolean(),
  customerVisible: z.boolean(),
  visibilityCondition: z
    .object({
      field_key: z.string(),
      op: z.enum(VISIBILITY_OPS),
      value: z.unknown().optional(),
    })
    .nullable(),
  value: z.unknown().nullable(),
});

export type CustomFieldFormatValue = CustomFieldFormat;
