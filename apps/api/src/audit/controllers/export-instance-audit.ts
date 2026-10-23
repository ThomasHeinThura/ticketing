import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { resolveRequestIdentity } from "../../permissions/resolve-request-identity";
import { setShadowLegacyAuthorization } from "../../permissions/shadow-context";
import { isInstanceAdmin } from "../../utils/is-instance-admin";
import { auditRowsToCsv, auditRowsToJson } from "../export";
import { listInstanceAuditRows } from "../repository";
import type { AuditRowResponse } from "../response";
import type { auditExportBody } from "../schema";
import { writeAuditExport } from "./audit-read-common";

type ExportBody = ReturnType<typeof auditExportBody.parse>;

/**
 * `POST /api/instance/audit/export` (AU-13): the same instance-administrator gate as the
 * list, a hard row cap, and one `audit.exported` row that records the format, filters and
 * row count, never the rows. The export itself writes no `audit.read` row: exporting is its
 * own audited action. Step-up re-authentication (contract: elevated) is NOT consumed here;
 * see the route policy for the open gap.
 *
 * NOT MOUNTED: the permission gate (`elevated-actions.test.ts`) requires
 * `POST /api/instance/audit/export` to be `elevated: true`, which needs an `audit_export`
 * step-up operation in `auth/` (not editable from this lane). Mount this controller in
 * `audit/index.ts` and add the policy entry once that operation exists.
 */
export async function exportInstanceAudit(
  c: Context,
  body: ExportBody,
  toRow: (
    row: Awaited<ReturnType<typeof listInstanceAuditRows>>[number],
  ) => AuditRowResponse,
) {
  if (!(await isInstanceAdmin(c))) {
    setShadowLegacyAuthorization(c, "denied");
    throw new HTTPException(403, { message: "Forbidden" });
  }
  const userId = c.get("userId") as string | undefined;
  const session = c.get("session") as { impersonatedBy?: string | null } | null;
  const identity = userId
    ? await resolveRequestIdentity({
        userId,
        apiKey: c.get("apiKey"),
        impersonatedBy: session?.impersonatedBy,
      })
    : null;
  if (!identity) {
    setShadowLegacyAuthorization(c, "denied");
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const fetched = await listInstanceAuditRows(identity, {
    limit: body.limit + 1,
    action: body.action,
    since: body.since,
    until: body.until,
    entityType: body.entityType,
    entityId: body.entityId,
  });
  const truncated = fetched.length > body.limit;
  const rows = (truncated ? fetched.slice(0, body.limit) : fetched).map(toRow);
  const content =
    body.format === "csv" ? auditRowsToCsv(rows) : auditRowsToJson(rows);

  await writeAuditExport(c, {
    format: body.format,
    rowCount: rows.length,
    truncated,
    filters: {
      action: body.action ?? null,
      since: body.since ?? null,
      until: body.until ?? null,
      entityType: body.entityType ?? null,
      entityId: body.entityId ?? null,
    },
  });
  setShadowLegacyAuthorization(c, "allowed");
  return {
    format: body.format,
    filename: `audit-log-${new Date().toISOString().slice(0, 10)}.${body.format}`,
    rowCount: rows.length,
    truncated,
    content,
  };
}
