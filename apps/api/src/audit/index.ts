import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { requireWorkspaceMembership } from "../utils/require-workspace-membership";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { listInstanceAudit } from "./controllers/list-instance-audit";
import { listWorkspaceAudit } from "./controllers/list-workspace-audit";
import { auditListSchema, type auditRowSchema } from "./response";
import { auditQuery, workspaceIdParam } from "./schema";

/**
 * Audit-read routes (`docs/03-features/audit-trail.md` § API), mounted flat under
 * `/api` so the paths match the spec table exactly — `/api/instance/audit` and
 * `/api/workspaces/{workspaceId}/audit` (the plural form the spec and rbac.md both
 * use; the singular/plural drift against existing runtime routes is flagged in the PR,
 * not silently normalised).
 */

const listInstanceAuditRoute = createRoute({
  method: "get",
  operationId: "listInstanceAudit",
  path: "/instance/audit",
  tags: ["Audit"],
  summary: "List the instance-wide audit log",
  description:
    "Instance administrators see every audit row (AU-11). Reading the log is itself audited as one `audit.read` row per request (AU-13); a failed audit-read write never fails the read (AU-14). Filters: dotted-action prefix, inclusive `since`, exclusive `until`, bounded `limit`.",
  request: { query: auditQuery },
  responses: {
    200: jsonResponse("Audit rows, newest first by sequence", auditListSchema),
    400: errorResponse("Invalid query (limit bounds, malformed datetime)"),
    401: errorResponse("No credential"),
    403: errorResponse("Caller is not an instance administrator"),
  },
});

const listWorkspaceAuditRoute = createRoute({
  method: "get",
  operationId: "listWorkspaceAudit",
  path: "/workspaces/{workspaceId}/audit",
  tags: ["Audit"],
  summary: "List a workspace's audit log",
  description:
    "Workspace administrators (`workspace:manage_settings`) see their own workspace's rows (AU-10); customers never see the audit log (AU-12). Each read is itself audited (AU-13). The tenant filter is applied unconditionally in the handler, independent of the middleware chain.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspaceMembership,
    requireWorkspaceCapability("workspace:manage_settings"),
  ] as const,
  request: { params: workspaceIdParam, query: auditQuery },
  responses: {
    200: jsonResponse(
      "Audit rows for this workspace, newest first by sequence",
      auditListSchema,
    ),
    400: errorResponse("Workspace id undetermined, NUL byte, or invalid query"),
    401: errorResponse("No credential"),
    403: errorResponse("Not a workspace administrator"),
  },
});

function toRowResponse(row: {
  id: string;
  seq: bigint;
  createdAt: Date;
  actorId: string | null;
  actorType: string;
  impersonatorId: string | null;
  workspaceId: string | null;
  organisationId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
}) {
  return {
    id: row.id,
    seq: row.seq.toString(),
    createdAt: row.createdAt.toISOString(),
    actorId: row.actorId,
    actorType: row.actorType,
    impersonatorId: row.impersonatorId,
    workspaceId: row.workspaceId,
    organisationId: row.organisationId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    before: (row.before ?? null) as unknown,
    after: (row.after ?? null) as unknown,
  } satisfies typeof auditRowSchema._output;
}

const audit = apiRouter()
  .openapi(listInstanceAuditRoute, async (c) => {
    const rows = await listInstanceAudit(c, c.req.valid("query"));
    return c.json({ rows: rows.map(toRowResponse) }, 200);
  })
  .openapi(listWorkspaceAuditRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const rows = await listWorkspaceAudit(c, workspaceId, c.req.valid("query"));
    return c.json({ rows: rows.map(toRowResponse) }, 200);
  });

export default audit;
