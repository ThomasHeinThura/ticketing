import { z } from "../openapi";

export const approvalIdParam = z.object({ id: z.string().min(1) });
export const workItemKeyParam = z.object({ key: z.string().min(1) });

export const createApprovalBody = z
  .object({
    transitionId: z.string().min(1),
    kind: z.enum(["customer", "cab"]),
    approverId: z.string().min(1),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const decideApprovalBody = z
  .object({
    action: z.enum(["approve", "reject"]),
    note: z.string().max(4000).nullable().optional(),
  })
  .strict();

export const approvalResponseSchema = z.object({
  id: z.string(),
  workItemId: z.string(),
  workItemKey: z.string(),
  workItemTitle: z.string(),
  transitionId: z.string(),
  kind: z.enum(["customer", "cab"]),
  state: z.enum(["pending", "approved", "rejected", "expired", "withdrawn"]),
  requester: z.object({ id: z.string(), displayName: z.string().nullable() }),
  approver: z.object({ id: z.string(), displayName: z.string().nullable() }),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  decidedAt: z.string().datetime().nullable(),
  decisionNote: z.string().nullable(),
  approverReachLost: z.boolean(),
  canWithdraw: z.boolean(),
});

export const approvalListResponseSchema = z.object({
  approvals: z.array(approvalResponseSchema),
});

export const approvalRequestContextSchema = z.object({
  enabled: z.boolean(),
  canRequestCustomer: z.boolean(),
  canRequestCab: z.boolean(),
  defaultExpiryDays: z.number().int(),
  maxExpiryDays: z.number().int(),
  transitions: z.array(
    z.object({
      id: z.string(),
      fromStateName: z.string().nullable(),
      toStateName: z.string(),
      requiresApproval: z.boolean(),
      requiresCab: z.boolean(),
    }),
  ),
});
export const approvalCandidatesQuery = z.object({
  kind: z.enum(["customer", "cab"]),
  q: z
    .string()
    .max(200)
    .refine(
      (value) =>
        Array.from(value).every(
          (character) =>
            character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
        ),
      "Search contains control characters",
    )
    .default(""),
  cursor: z.string().max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(25).default(25),
});
export const approvalCandidatesSchema = z.object({
  data: z.array(
    z.object({ id: z.string(), displayName: z.string().nullable() }),
  ),
  page: z.object({ hasMore: z.boolean(), nextCursor: z.string().nullable() }),
});
