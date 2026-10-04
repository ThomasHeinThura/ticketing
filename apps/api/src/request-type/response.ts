import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import { formSchema } from "./schema";

export const requestTypeSchema = z.object({
  id: z.string(),
  key: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  group: z.string(),
  workItemTypeId: z.string(),
  defaultProjectId: z.string().nullable(),
  formSchema,
  slaPolicyId: z.string().nullable(),
  defaultAssigneeId: z.string().nullable(),
  autoAccept: z.boolean(),
  customerVisible: z.boolean(),
  forcePrivate: z.boolean(),
  published: z.boolean(),
  position: z.number().int(),
  version: z.number().int(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
});

export const requestTypeListSchema = z.object({
  items: z.array(requestTypeSchema),
});

export const portalCatalogueItemSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  group: z.string(),
  position: z.number().int(),
});

export const portalRequestTypeSchema = portalCatalogueItemSchema.extend({
  version: z.number().int(),
  autoAccept: z.boolean(),
  formSchema,
});

export const portalCatalogueSchema = z.object({
  items: z.array(portalCatalogueItemSchema),
});

export const submissionReceiptSchema = z.object({
  ref: z.string(),
  state: z.enum([
    "draft",
    "new",
    "clarifying",
    "accepted",
    "declined",
    "duplicate",
    "withdrawn",
  ]),
  workItemKey: z.string().nullable(),
  createdAt: responseTimestamp,
});

export const submissionAttachmentSchema = z.object({
  id: z.string(),
  fieldKey: z.string().nullable(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  uploadedBy: z.string().nullable(),
  createdAt: responseTimestamp,
});

export const submissionListItemSchema = submissionReceiptSchema.extend({
  id: z.string(),
  organisationId: z.string(),
  requesterId: z.string(),
  requestTypeId: z.string(),
  requestTypeVersionId: z.string(),
  formData: z.record(z.string(), z.json()),
  claimedBy: z.string().nullable(),
  claimedAt: nullableResponseTimestamp,
  version: z.number().int(),
});
