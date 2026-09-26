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
});

export const workspaceIdParam = z.object({ workspaceId: z.string() });
