import { z } from "../openapi";
import { CUSTOM_FIELD_FORMATS, VISIBILITY_OPS } from "./logic";

export const workspaceIdQuery = z.object({
  workspaceId: z.string().min(1),
  includeDeleted: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});
export const workspaceIdBody = z.object({ workspaceId: z.string().min(1) });
export const idParam = z.object({ id: z.string().min(1) });

export const optionSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().trim().min(1).max(120),
});

export const visibilityConditionSchema = z.object({
  field_key: z.string().min(1).max(64),
  op: z.enum(VISIBILITY_OPS),
  value: z.unknown().optional(),
});

export const visibilityRowSchema = z.object({
  workItemTypeId: z.string().min(1),
  visible: z.boolean(),
  required: z.boolean(),
});

export const createFieldBody = z.object({
  workspaceId: z.string().min(1),
  sectionId: z.string().min(1),
  key: z
    .string()
    .regex(
      /^[a-z][a-z0-9_]{0,63}$/,
      "Key must be lowercase letters, digits and underscores, starting with a letter",
    ),
  name: z.string().trim().min(1).max(120),
  format: z.enum(CUSTOM_FIELD_FORMATS),
  options: z.array(optionSchema).max(200).default([]),
  defaultValue: z.unknown().optional(),
  helpText: z.string().trim().max(500).nullable().optional(),
  customerVisible: z.boolean().optional(),
  visibilityCondition: visibilityConditionSchema.nullable().optional(),
  visibility: z.array(visibilityRowSchema).max(200).optional(),
});

export const updateFieldBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    // Present only so a format change is refused with the contract's CF-9 message.
    format: z.enum(CUSTOM_FIELD_FORMATS).optional(),
    sectionId: z.string().min(1).optional(),
    options: z.array(optionSchema).max(200).optional(),
    defaultValue: z.unknown().optional(),
    helpText: z.string().trim().max(500).nullable().optional(),
    customerVisible: z.boolean().optional(),
    visibilityCondition: visibilityConditionSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to change",
  });

export const setVisibilityBody = z.object({
  visibility: z.array(visibilityRowSchema).max(200),
});

export const reorderFieldsBody = z.object({
  workspaceId: z.string().min(1),
  sections: z
    .array(
      z.object({
        sectionId: z.string().min(1),
        fieldIds: z.array(z.string().min(1)),
      }),
    )
    .max(200),
});

export const nonCompliantQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const createSectionBody = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
});
export const updateSectionBody = z.object({
  name: z.string().trim().min(1).max(120),
});
export const reorderSectionsBody = z.object({
  workspaceId: z.string().min(1),
  sectionIds: z.array(z.string().min(1)).max(200),
});

/** The `customFields` map a work item create or update body may carry (key -> value). */
export const workItemCustomFieldsInput = z
  .record(z.string(), z.unknown())
  .optional()
  .openapi({
    description:
      "Custom field values keyed by field key. A null or empty value clears the field.",
  });
