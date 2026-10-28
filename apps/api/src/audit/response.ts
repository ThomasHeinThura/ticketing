import { z } from "../openapi";

/** One audit row as the API returns it (`data-model.md` §11's columns, ids only —
 * the writer already guarantees no secret, body, header, email or name is stored). */
export const auditRowSchema = z.object({
  id: z.string(),
  /** bigint as a decimal string — JSON has no 64-bit integers. */
  seq: z.string(),
  createdAt: z.string(),
  actorId: z.string().nullable(),
  actorType: z.string(),
  impersonatorId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  organisationId: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
});

export const auditListSchema = z.object({
  rows: z.array(auditRowSchema),
});
export type AuditRowResponse = z.infer<typeof auditRowSchema>;

export const auditEntityHistorySchema = z.object({
  entityType: z.string(),
  entityId: z.string(),
  rows: z.array(auditRowSchema),
});

/** Point-in-time work-item state (AU-8/AU-9): field name to the value it held at `at`. */
export const workItemReconstructionSchema = z.object({
  key: z.string(),
  workItemId: z.string(),
  at: z.string().datetime(),
  /** `null` when `at` precedes the first recorded activity of the item. */
  snapshot: z
    .object({ fields: z.record(z.string(), z.string().nullable()) })
    .nullable(),
});

export const auditExportResponseSchema = z.object({
  format: z.enum(["csv", "json"]),
  filename: z.string(),
  rowCount: z.number().int().min(0),
  /** True when more rows matched than the export cap; narrow the filters to get them. */
  truncated: z.boolean(),
  content: z.string(),
});
