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
