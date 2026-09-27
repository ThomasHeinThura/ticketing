import { desc, eq } from "drizzle-orm";
import type { Context } from "hono";
import db from "../../database";
import { auditLogTable } from "../../database/schema";
import {
  type AuditQuery,
  auditListFilters,
  combineFilters,
  writeAuditRead,
} from "./audit-read-common";

/**
 * `GET /api/workspaces/{workspaceId}/audit` — AU-10: workspace administrators see
 * their workspace's rows. The route's middleware chain
 * (`workspaceAccess.fromParam` → `requireWorkspaceMembership` →
 * `requireWorkspaceCapability("workspace:manage_settings")`) has already proven
 * membership and the canonical capability by the time this runs; this handler's own
 * job is the tenant filter, applied unconditionally — the query never sees another
 * workspace's rows even if a future refactor drops a middleware. AU-13 applies.
 */
export async function listWorkspaceAudit(
  c: Context,
  workspaceId: string,
  query: AuditQuery,
) {
  const rows = await db
    .select()
    .from(auditLogTable)
    .where(
      combineFilters([
        eq(auditLogTable.workspaceId, workspaceId),
        ...auditListFilters(query),
      ]),
    )
    .orderBy(desc(auditLogTable.seq))
    .limit(query.limit);

  await writeAuditRead(c, { workspaceId });
  return rows;
}
