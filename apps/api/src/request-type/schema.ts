import { z } from "../openapi";

const identifier = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !value.includes("\u0000"));

const showIf = z
  .object({
    field_key: z.string().min(1).max(80),
    op: z.enum(["eq", "neq", "in", "is_set"]),
    value: z.json().optional(),
  })
  .strict();

const formField = z
  .object({
    key: z.string().min(1).max(80),
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
    label: z.string().max(160),
    required: z.boolean().optional(),
    options: z.array(z.string().max(160)).max(200).optional(),
    help: z.string().max(500).optional(),
    multiple: z.boolean().optional(),
    mapsTo: z
      .object({
        field: z.string().min(1).max(128),
        map: z.record(z.string(), z.string().max(160)).optional(),
      })
      .strict()
      .optional(),
    showIf: showIf.nullable().optional(),
  })
  .strict();

export const formSchema = z
  .object({ fields: z.array(formField).max(100) })
  .strict();

const requestTypeFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2_000).nullable(),
  icon: z.string().max(80).nullable(),
  group: z.string().trim().min(1).max(120),
  workItemTypeId: identifier,
  defaultProjectId: identifier.nullable(),
  formSchema,
  slaPolicyId: identifier.nullable(),
  defaultAssigneeId: identifier.nullable(),
  autoAccept: z.boolean(),
  customerVisible: z.boolean(),
  forcePrivate: z.boolean(),
  position: z.number().int().min(0),
};

export const workspaceRequestTypeQuery = z.object({
  workspaceId: identifier,
});

export const createRequestTypeBody = z
  .object({
    ...requestTypeFields,
    workspaceId: identifier,
    description: requestTypeFields.description.optional(),
    icon: requestTypeFields.icon.optional(),
    slaPolicyId: requestTypeFields.slaPolicyId.optional(),
    defaultProjectId: requestTypeFields.defaultProjectId.optional(),
    defaultAssigneeId: requestTypeFields.defaultAssigneeId.optional(),
    autoAccept: requestTypeFields.autoAccept.default(false),
    customerVisible: requestTypeFields.customerVisible.default(false),
    forcePrivate: requestTypeFields.forcePrivate.default(false),
    position: requestTypeFields.position.default(0),
  })
  .strict();

export const updateRequestTypeBody = z
  .object({
    name: requestTypeFields.name.optional(),
    description: requestTypeFields.description.optional(),
    icon: requestTypeFields.icon.optional(),
    group: requestTypeFields.group.optional(),
    workItemTypeId: identifier.optional(),
    defaultProjectId: requestTypeFields.defaultProjectId.optional(),
    formSchema: formSchema.optional(),
    slaPolicyId: requestTypeFields.slaPolicyId.optional(),
    defaultAssigneeId: requestTypeFields.defaultAssigneeId.optional(),
    autoAccept: z.boolean().optional(),
    customerVisible: z.boolean().optional(),
    forcePrivate: z.boolean().optional(),
    position: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export const requestTypeIdParam = z.object({ id: identifier });
export const requestTypeKeyParam = z.object({ key: identifier });

export const submissionListQuery = z.object({
  workspaceId: identifier,
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z
    .string()
    .regex(/^SUB-[1-9]\d*$/)
    .optional(),
  state: z
    .enum([
      "new",
      "clarifying",
      "accepted",
      "declined",
      "duplicate",
      "withdrawn",
    ])
    .optional(),
});

export const submissionRefParam = z.object({
  ref: z.string().regex(/^SUB-[1-9]\d*$/),
});

export const acceptSubmissionBody = z
  .object({
    projectId: identifier,
    typeId: identifier,
  })
  .strict();

export const declineSubmissionBody = z
  .object({ reason: z.string().trim().min(1).max(2_000) })
  .strict();

export const submissionMessageBody = z
  .object({ body: z.string().trim().min(1).max(20_000) })
  .strict();

export const duplicateSubmissionBody = z
  .object({ workItemKey: identifier })
  .strict();

export const submitRequestBody = z
  .object({
    requestTypeKey: identifier,
    formData: z.record(z.string(), z.json()),
  })
  .strict();

export const createSubmissionDraftBody = submitRequestBody;
export const finalizeSubmissionDraftBody = z
  .object({
    formData: z.record(z.string(), z.json()),
  })
  .strict();
