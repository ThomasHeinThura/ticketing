import { z } from "../openapi";

export const bulkDeletionResultSchema = z.object({
  succeeded: z.array(z.string()),
  failed: z.array(z.object({ id: z.string(), reason: z.string() })),
});
const pendingActionSummarySchema = z.record(z.string(), z.unknown());
// Durable 0109 `user_deactivation` values remain database-only compatibility. Public
// DTOs project a resolvable legacy row onto the canonical delete/user vocabulary.
const pendingActionReadKindSchema = z.enum([
  "delete",
  "bulk_delete",
  "purge",
  "mcp_destructive",
]);

export const pendingActionReadSchema = z
  .object({
    id: z.string(),
    action: pendingActionReadKindSchema,
    origin: z.enum(["web", "api", "mcp"]),
    targetType: z.string(),
    targetIds: z.array(z.string()),
    targetWorkspaceId: z.string().nullable(),
    summary: pendingActionSummarySchema,
    confirmation: z.enum([
      "click",
      "typed_name",
      "typed_count",
      "typed_name_step_up",
      "typed_count_step_up",
    ]),
    approvalSupported: z.boolean(),
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
    action: pendingActionReadKindSchema,
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
    approvalSupported: z.boolean(),
    state: z.enum(["denied", "cancelled", "expired"]),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .openapi("PendingActionDecision");

export const pendingActionApprovalSchema = z
  .object({
    id: z.string(),
    state: z.enum(["executed", "expired"]),
    result: bulkDeletionResultSchema.optional(),
  })
  .openapi("PendingActionApproval");

export const pendingDeletionRequestSchema = z.object({
  pendingActionId: z.string(),
  action: z.literal("delete"),
  summary: z.record(z.string(), z.unknown()),
  confirmation: z.literal("click"),
  expiresAt: z.string().datetime(),
  approveUrl: z.string(),
});

export const pendingBulkDeletionRequestSchema = z.object({
  pendingActionId: z.string(),
  action: z.literal("bulk_delete"),
  summary: z.record(z.string(), z.unknown()),
  confirmation: z.enum(["typed_count", "typed_count_step_up"]),
  expiresAt: z.string().datetime(),
  approveUrl: z.string(),
});
