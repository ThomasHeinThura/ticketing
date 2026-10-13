/**
 * Staff-side intake response contracts. No stored row reaches the wire: every route maps
 * explicitly to one of these schemas, carrying only what the triage and request-type
 * screens consume plus what the intake spec requires.
 */
import { z } from "../openapi";

export const submissionMessageSchema = z.object({
  id: z.string(),
  authorId: z.string(),
  actorType: z.string(),
  body: z.string(),
  createdAt: z.string().datetime(),
});

export const staffSubmissionSchema = z.object({
  id: z.string(),
  number: z.number(),
  state: z.string(),
  formData: z.record(z.string(), z.unknown()),
  customerVisibility: z.string(),
  claimedBy: z.string().nullable(),
  claimedAt: z.string().datetime().nullable(),
  workItemId: z.string().nullable(),
  version: z.number(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const staffRequestTypeRefSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
});

export const requestTypeVersionSchema = z.object({
  id: z.string(),
  number: z.number(),
  formSchema: z.unknown(),
  workItemTypeId: z.string(),
  defaultProjectId: z.string().nullable(),
  slaPolicyId: z.string().nullable(),
  defaultAssigneeId: z.string().nullable(),
  autoAccept: z.boolean(),
  createdAt: z.string().datetime(),
});

export const submissionWorkItemSchema = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  projectId: z.string(),
  typeId: z.string(),
});

export const staffQueueRowSchema = z.object({
  ref: z.string(),
  summary: z.string(),
  submission: staffSubmissionSchema.pick({
    id: true,
    number: true,
    state: true,
    customerVisibility: true,
    claimedBy: true,
    claimedAt: true,
    createdAt: true,
  }),
  requestType: staffRequestTypeRefSchema,
  requester: z.object({ id: z.string(), displayName: z.string().nullable() }),
  organisation: z.object({ id: z.string(), name: z.string() }),
});

type Instant = Date | string;
const iso = (value: Instant) =>
  value instanceof Date ? value.toISOString() : value;

export function toSubmissionMessage(row: {
  id: string;
  authorId: string;
  actorType: string;
  body: string;
  createdAt: Instant;
}): z.infer<typeof submissionMessageSchema> {
  return {
    id: row.id,
    authorId: row.authorId,
    actorType: row.actorType,
    body: row.body,
    createdAt: iso(row.createdAt),
  };
}

export function toStaffSubmission(row: {
  id: string;
  number: number;
  state: string;
  formData: unknown;
  customerVisibility: string;
  claimedBy: string | null;
  claimedAt: Date | null;
  workItemId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}): z.infer<typeof staffSubmissionSchema> {
  return {
    id: row.id,
    number: row.number,
    state: row.state,
    formData: row.formData as Record<string, unknown>,
    customerVisibility: row.customerVisibility,
    claimedBy: row.claimedBy,
    claimedAt: row.claimedAt ? row.claimedAt.toISOString() : null,
    workItemId: row.workItemId,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toStaffRequestTypeRef(row: {
  id: string;
  key: string;
  name: string;
}): z.infer<typeof staffRequestTypeRefSchema> {
  return { id: row.id, key: row.key, name: row.name };
}

export function toRequestTypeVersion(row: {
  id: string;
  number: number;
  formSchema: unknown;
  workItemTypeId: string;
  defaultProjectId: string | null;
  slaPolicyId: string | null;
  defaultAssigneeId: string | null;
  autoAccept: boolean;
  createdAt: Date;
}): z.infer<typeof requestTypeVersionSchema> {
  return {
    id: row.id,
    number: row.number,
    formSchema: row.formSchema,
    workItemTypeId: row.workItemTypeId,
    defaultProjectId: row.defaultProjectId,
    slaPolicyId: row.slaPolicyId,
    defaultAssigneeId: row.defaultAssigneeId,
    autoAccept: row.autoAccept,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toSubmissionWorkItem(row: {
  id: string;
  key: string;
  title: string;
  projectId: string;
  typeId: string;
}): z.infer<typeof submissionWorkItemSchema> {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    projectId: row.projectId,
    typeId: row.typeId,
  };
}
