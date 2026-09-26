import { desc } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { auditLogTable } from "../../database/schema";
import { isInstanceAdmin } from "../../utils/is-instance-admin";
import {
  type AuditQuery,
  auditListFilters,
  combineFilters,
  writeAuditRead,
} from "./audit-read-common";

/**
 * `GET /api/instance/audit` — AU-11: instance administrators see everything.
 *
 * The instance-admin gate runs HERE: the registry entry declares the
 * `instance:read_audit` capability, but strict registry-driven enforcement is issue
 * #8's later slice — until then every route enforces by hand, exactly like
 * `requireWorkspacePermission` does today. `isInstanceAdmin(c)` is the codebase's one
 * instance-authority primitive; it aligns with `instance:read_audit` because
 * `BUILT_IN_ROLES.instance_admin` holds exactly the five `instance:*` capabilities
 * (roles.test.ts) and #315's identity mapping grants that authority from the same
 * user-role source. Alignment flagged for reviewers in the policy file, not assumed
 * silently. AU-12 (customers never) follows: a portal session has no user-role admin.
 */
export async function listInstanceAudit(c: Context, query: AuditQuery) {
  if (!(await isInstanceAdmin(c))) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const rows = await db
    .select()
    .from(auditLogTable)
    .where(combineFilters(auditListFilters(query)))
    .orderBy(desc(auditLogTable.seq))
    .limit(query.limit);

  await writeAuditRead(c, { workspaceId: null });
  return rows;
}
