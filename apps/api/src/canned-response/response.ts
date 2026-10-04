import { jsonValueSchema, responseTimestamp, z } from "../openapi";

export const cannedResponseSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    name: z.string(),
    body: jsonValueSchema.optional(),
    visibilityDefault: z
      .string()
      .openapi({ description: "One of: public, internal." }),
    createdBy: z.string().nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("CannedResponse");

export const cannedResponseListSchema = z.array(cannedResponseSchema);
