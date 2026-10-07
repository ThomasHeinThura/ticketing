import { z } from "../openapi";

const id = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !value.includes("\u0000"));

export const workspaceQuery = z.object({ workspaceId: id });
export const requestTypeIdParam = z.object({ id });
export const requestTypeKeyParam = z.object({ key: id });
export const submissionRefParam = z.object({
  ref: z.string().regex(/^SUB-[1-9]\d{0,9}$/),
});

const formField = z
  .object({
    key: z.string().min(1).max(100),
    type: z.enum([
      "text",
      "textarea",
      "select",
      "combobox",
      "number",
      "date",
      "checkbox",
      "file",
    ]),
    label: z.string().trim().min(1).max(200),
    required: z.boolean().optional(),
    options: z.array(z.string().min(1).max(200)).max(500).optional(),
    help: z.string().max(1000).optional(),
    multiple: z.boolean().optional(),
    mapsTo: z
      .object({
        field: z.string().min(1).max(100),
        map: z.record(z.string(), z.string()).optional(),
      })
      .strict()
      .optional(),
    showIf: z
      .object({
        field_key: z.string().min(1),
        op: z.enum(["eq", "neq", "in", "is_set"]),
        value: z.unknown().optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

export const formSchema = z
  .object({ fields: z.array(formField).max(100) })
  .strict();

export const createRequestTypeBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).nullable().optional(),
    icon: z.string().max(100).nullable().optional(),
    group: z.string().trim().min(1).max(120),
    workItemTypeId: id,
    defaultProjectId: id.nullable().optional(),
    formSchema,
    slaPolicyId: id.nullable().optional(),
    defaultAssigneeId: id.nullable().optional(),
    autoAccept: z.boolean().default(false),
    customerVisible: z.boolean().default(false),
    forcePrivate: z.boolean().default(false),
    position: z.number().int().min(0).default(0),
  })
  .strict();

export const updateRequestTypeBody = createRequestTypeBody
  .partial()
  .extend({ version: z.number().int().positive() })
  .strict();
export const submissionBody = z
  .object({
    key: id,
    formData: z.record(z.string(), z.unknown()),
    customerVisibility: z.enum(["private", "organisation"]).optional(),
  })
  .strict();
export const messageBody = z
  .object({ body: z.string().trim().min(1).max(20000) })
  .strict();
export const acceptBody = z
  .object({ projectId: id, workItemTypeId: id })
  .strict();
export const declineBody = z
  .object({ reason: z.string().trim().min(1).max(4000) })
  .strict();
export const duplicateBody = z.object({ workItemId: id }).strict();
