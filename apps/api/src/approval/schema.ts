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
