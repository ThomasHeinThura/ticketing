import { jsonValueSchema, z } from "../openapi";

const pendingActionSummarySchema = z.record(z.string(), jsonValueSchema);

export const pendingActionReadSchema = z
  .object({
    id: z.string(),
    action: z.enum(["delete", "bulk_delete", "purge", "mcp_destructive"]),
    origin: z.enum(["web", "api", "mcp"]),
    targetType: z.string(),
    targetIds: z.array(z.string()),
    summary: pendingActionSummarySchema,
    confirmation: z.enum([
      "click",
      "typed_name",
      "typed_count",
      "typed_name_step_up",
      "typed_count_step_up",
    ]),
    state: z.enum([
      "pending",
      "approved",
      "denied",
      "cancelled",
      "expired",
      "invalidated",
      "executed",
      "failed",
    ]),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    invalidationReason: z
      .enum([
        "credential_revoked",
        "requester_deactivated",
        "reach_lost",
        "capability_removed",
        "version_changed",
        "scope_changed",
      ])
      .nullable(),
    decidedAt: z.string().datetime().nullable(),
    executedAt: z.string().datetime().nullable(),
    requestingKeyName: z.string().nullable(),
  })
  .openapi("PendingActionRead");

export const pendingActionPageSchema = z
  .object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  })
  .openapi("PendingActionPage");

export const pendingActionListResponseSchema = z
  .object({
    data: z.array(pendingActionReadSchema),
    page: pendingActionPageSchema,
    meta: z.object({ total: z.number().int().nonnegative() }),
  })
  .openapi("PendingActionListResponse");

export const pendingActionDecisionSchema = z
  .object({
    id: z.string(),
    action: z.enum(["delete", "bulk_delete", "purge", "mcp_destructive"]),
    origin: z.enum(["web", "api", "mcp"]),
    targetType: z.string(),
    targetIds: z.array(z.string()),
    summary: pendingActionSummarySchema,
    confirmation: z.enum([
      "click",
      "typed_name",
      "typed_count",
      "typed_name_step_up",
      "typed_count_step_up",
    ]),
    state: z.enum(["denied", "cancelled", "expired"]),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .openapi("PendingActionDecision");
