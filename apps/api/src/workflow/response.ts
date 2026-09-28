import { responseTimestamp, z } from "../openapi";
import { effectSchema, guardSchema } from "./schema";

export const workflowTransitionSchema = z
  .object({
    id: z.string(),
    versionId: z.string(),
    fromStateTemplateId: z.string().nullable(),
    toStateTemplateId: z.string(),
    roleId: z.string().nullable(),
    notePolicy: z.enum(["none", "optional", "required"]),
    noteVisibility: z.enum(["public", "internal"]),
    requiresApproval: z.boolean(),
    approvalPolicy: z.enum(["any", "all"]).nullable(),
    requiresCab: z.boolean(),
    isReopen: z.boolean(),
    guards: z.array(guardSchema),
    effects: z.array(effectSchema),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("WorkflowTransition");

export const workflowVersionSchema = z
  .object({
    id: z.string(),
    workflowId: z.string(),
    number: z.number(),
    publishedAt: responseTimestamp.nullable(),
    publishedBy: z.string().nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    transitions: z.array(workflowTransitionSchema),
  })
  .openapi("WorkflowVersion");

export const workflowSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    key: z.string(),
    name: z.string(),
    activeVersionId: z.string().nullable(),
    version: z.number(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("Workflow");

export const workflowListSchema = z.array(workflowSchema);

export const workflowWithVersionsSchema = workflowSchema.extend({
  versions: z.array(workflowVersionSchema),
});
