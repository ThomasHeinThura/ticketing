import { z } from "../openapi";

/** Shared list query for both audit routes — the spec tables no params, so this is the
 * minimum honest surface: bounded page size, optional action-prefix and time window. */
export const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  /** Dotted action prefix — `auth.` matches the whole auth-lifecycle group. */
  action: z.string().max(200).optional(),
  /** ISO-8601 instants, inclusive `since`, exclusive `until`. */
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  /** Exact entity filter (`entity_type` + `entity_id`), AU-10 reach still applies. */
  entityType: z.string().min(1).max(100).optional(),
  entityId: z.string().min(1).max(200).optional(),
});

/** Hard ceiling on one export (AU-13): the response is a single bounded document. */
export const AUDIT_EXPORT_MAX_ROWS = 5000;

export const auditExportBody = z
  .object({
    format: z.enum(["csv", "json"]).default("csv"),
    action: z.string().max(200).optional(),
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    entityType: z.string().min(1).max(100).optional(),
    entityId: z.string().min(1).max(200).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(AUDIT_EXPORT_MAX_ROWS)
      .default(AUDIT_EXPORT_MAX_ROWS),
  })
  .strict();

export const auditEntityParam = z.object({
  type: z.enum(["work_item"]),
  id: z.string().min(1).max(200),
});

export const reconstructQuery = z.object({
  at: z.string().datetime(),
});

export const workspaceIdParam = z.object({ workspaceId: z.string() });
