import { z } from "../../openapi";

function containsNulByte(value: unknown): boolean {
  if (typeof value === "string") return value.includes("\u0000");
  if (Array.isArray(value)) return value.some(containsNulByte);
  if (value !== null && typeof value === "object")
    return Object.entries(value as Record<string, unknown>).some(
      ([key, entry]) => key.includes("\u0000") || containsNulByte(entry),
    );
  return false;
}

const NO_NUL = "must not contain a NUL (\\u0000) byte";
const noNul = (value: unknown) => !containsNulByte(value);

const idField = z.string().min(1).max(200).refine(noNul, NO_NUL);
const nameField = z.string().trim().min(1).max(200).refine(noNul, NO_NUL);

export const templateParams = z.object({ workspaceId: idField, id: idField });

export const templateListQuery = z.object({
  includeArchived: z.enum(["true", "false"]).optional(),
});

const checklistItemText = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(noNul, NO_NUL);
export const MAX_CHECKLIST_ITEMS = 100;

const templateFields = {
  name: nameField,
  typeId: idField,
  title: z.string().min(1).max(500).refine(noNul, NO_NUL),
  description: z.unknown().refine(noNul, NO_NUL),
  labelIds: z
    .array(idField)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, "Duplicate labels"),
  customFieldValues: z.record(z.string(), z.unknown()).refine(noNul, NO_NUL),
  checklistTemplateId: idField.nullable(),
};

export const createWorkItemTemplateBody = z.object({
  name: templateFields.name,
  typeId: templateFields.typeId,
  title: templateFields.title,
  description: templateFields.description.optional(),
  labelIds: templateFields.labelIds.optional(),
  customFieldValues: templateFields.customFieldValues.optional(),
  checklistTemplateId: templateFields.checklistTemplateId.optional(),
});

export const updateWorkItemTemplateBody = z
  .object({
    name: templateFields.name.optional(),
    typeId: templateFields.typeId.optional(),
    title: templateFields.title.optional(),
    description: templateFields.description.nullable().optional(),
    labelIds: templateFields.labelIds.optional(),
    customFieldValues: templateFields.customFieldValues.optional(),
    checklistTemplateId: templateFields.checklistTemplateId.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field must be supplied",
  });

export const createChecklistTemplateBody = z.object({
  name: nameField,
  items: z.array(checklistItemText).max(MAX_CHECKLIST_ITEMS),
});

export const updateChecklistTemplateBody = z
  .object({
    name: nameField.optional(),
    items: z.array(checklistItemText).max(MAX_CHECKLIST_ITEMS).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field must be supplied",
  });

export type CreateWorkItemTemplateInput = z.infer<
  typeof createWorkItemTemplateBody
>;
export type UpdateWorkItemTemplateInput = z.infer<
  typeof updateWorkItemTemplateBody
>;
