import { and, gte, like, lt, type SQL } from "drizzle-orm";
import type { Context } from "hono";
import db from "../../database";
import { auditLogTable } from "../../database/schema";
import { appendAuditLog } from "../audit-writer";

export type AuditQuery = {
  readonly limit: number;
  readonly action?: string | undefined;
  readonly since?: string | undefined;
  readonly until?: string | undefined;
};

/**
 * Shared WHERE construction for both audit list routes. The `action` filter is a
 * dotted-key PREFIX match (`auth.` selects the whole auth-lifecycle group). `%`, `_`
 * and backslash in the caller's prefix are backslash-escaped; PostgreSQL's LIKE treats
 * backslash as its default escape character, so a crafted prefix cannot become a
 * wildcard scan of every action.
 */
export function auditListFilters(query: AuditQuery): (SQL | undefined)[] {
  const actionFilter =
    query.action === undefined
      ? undefined
      : like(
          auditLogTable.action,
          `${query.action.replace(/[\\%_]/g, (m) => `\\${m}`)}%`,
        );
  return [
    actionFilter,
    query.since === undefined
      ? undefined
      : gte(auditLogTable.createdAt, new Date(query.since)),
    query.until === undefined
      ? undefined
      : lt(auditLogTable.createdAt, new Date(query.until)),
  ];
}

export function combineFilters(filters: (SQL | undefined)[]): SQL | undefined {
  const defined = filters.filter((f): f is SQL => f !== undefined);
  return defined.length === 0 ? undefined : and(...defined);
}

/**
 * AU-13: every read of the log is itself audited — one `audit.read` row, no batching,
 * no sampling (the spec's own volume decision, audit-trail.md § Access). AU-14: a
 * failed write never fails the read; it logs at error level (the metric and
 * notification hooks land with the observability slice). `audit.read` is in
 * `actions.ts`'s catalogue (line 86), so `validateAction` accepts it.
 */
export async function writeAuditRead(
  c: Context,
  scope: { readonly workspaceId: string | null },
): Promise<void> {
  try {
    const userId = c.get("userId") as string | undefined;
    await appendAuditLog(db, {
      actorId: userId ?? null,
      actorType: "person",
      workspaceId: scope.workspaceId,
      action: "audit.read",
      entityType: "audit_log",
      entityId: scope.workspaceId ?? "instance",
    });
  } catch (error) {
    console.error("AU-14: audit.read write failed", error);
  }
}
