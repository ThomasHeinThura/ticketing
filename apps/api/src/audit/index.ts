import { reconstructAt } from "@taskdesk/domain";
import { HTTPException } from "hono/http-exception";
import { stepUpTokenHeader } from "../auth/step-up-spend";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireApiKeyCapabilityScope } from "../utils/require-api-key-permission-scope";
import { requireSessionOnly } from "../utils/require-session-only";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { requireWorkspaceMembership } from "../utils/require-workspace-membership";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { requireWorkItemReach } from "../work-item/require-work-item-reach";
import { workItemKeyParam } from "../work-item/schema";
import { writeAuditRead } from "./controllers/audit-read-common";
import { exportInstanceAudit } from "./controllers/export-instance-audit";
import { listInstanceAudit } from "./controllers/list-instance-audit";
import { listWorkspaceAudit } from "./controllers/list-workspace-audit";
import {
  auditEntityHistorySchema,
  auditExportResponseSchema,
  auditListSchema,
  type auditRowSchema,
  workItemReconstructionSchema,
} from "./response";
import {
  auditEntityParam,
  auditExportBody,
  auditQuery,
  reconstructQuery,
  workspaceIdParam,
} from "./schema";
import {
  listActivityForReconstruction,
  listEntityAuditRows,
  RECONSTRUCTION_MAX_ROWS,
} from "./work-item-history.repository";

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
  middleware: [requireApiKeyCapabilityScope("instance:read_audit")] as const,
  request: { query: auditQuery },
  responses: {
    200: jsonResponse("Audit rows, newest first by sequence", auditListSchema),
    400: errorResponse("Invalid query (limit bounds, malformed datetime)"),
    401: errorResponse("No credential"),
    403: errorResponse("Caller is not an instance administrator"),
  },
});

const exportInstanceAuditRoute = createRoute({
  method: "post",
  operationId: "exportInstanceAudit",
  path: "/instance/audit/export",
  tags: ["Audit"],
  summary: "Export the instance-wide audit log",
  description:
    "Instance administrators only, elevated and session-only (PA-15 operation `audit_export`, bound to the exact format, filters and row cap). Returns at most the capped number of rows as CSV or JSON; `truncated` says more rows matched. The export writes one `audit.exported` row with the format, filters and row count, never the rows (AU-13).",
  middleware: [requireSessionOnly()] as const,
  request: {
    headers: stepUpTokenHeader,
    body: {
      required: true,
      content: { "application/json": { schema: auditExportBody } },
    },
  },
  responses: {
    200: jsonResponse("The export", auditExportResponseSchema),
    400: errorResponse("Invalid body (format, filters or limit)"),
    401: errorResponse("No credential"),
    403: errorResponse(
      "Not an instance administrator, not a browser session, or step-up required/unavailable",
    ),
  },
});

const listWorkspaceAuditRoute = createRoute({
  method: "get",
  operationId: "listWorkspaceAudit",
  path: "/workspaces/{workspaceId}/audit",
  tags: ["Audit"],
  summary: "List a workspace's audit log",
  description:
    "Workspace administrators (`workspace:manage_settings`) see their own workspace's rows (AU-10), reach-filtered to non-project rows plus the rows of projects they can reach (#344) -- never a project outside that; customers never see the audit log (AU-12). Each read is itself audited (AU-13). The tenant filter is applied unconditionally in the handler, independent of the middleware chain.",
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

const getWorkItemAuditHistoryRoute = createRoute({
  method: "get",
  operationId: "getAuditEntityHistory",
  path: "/audit/entity/{type}/{id}",
  tags: ["Audit"],
  summary: "Read one entity's audit history",
  description:
    "Audit rows for one entity, newest first (at most 200). Only `type=work_item` is supported; its `id` is the work item key, and reach plus `work_item:read` are enforced exactly as for the work item itself. Each read is audited (AU-13).",
  middleware: [
    requireWorkItemReach("id", { allowArchivedForRead: true }),
  ] as const,
  request: { params: auditEntityParam },
  responses: {
    200: jsonResponse("Audit rows for the entity", auditEntityHistorySchema),
    400: errorResponse("Invalid entity type or key"),
    403: errorResponse("Missing work_item:read permission"),
    404: errorResponse("Work item not found or out of reach"),
  },
});

const reconstructWorkItemRoute = createRoute({
  method: "get",
  operationId: "reconstructWorkItem",
  path: "/work-items/{key}/reconstruct",
  tags: ["Audit"],
  summary: "Reconstruct a work item at an instant",
  description:
    "Replays the work item's activity journal up to `at` and returns each recorded field's value then (AU-8, AU-9). A field the journal never changed does not appear. `snapshot` is null when `at` precedes the first recorded activity. Never a stored snapshot.",
  middleware: [
    requireWorkItemReach("key", { allowArchivedForRead: true }),
  ] as const,
  request: { params: workItemKeyParam, query: reconstructQuery },
  responses: {
    200: jsonResponse("Reconstructed state", workItemReconstructionSchema),
    400: errorResponse("Invalid key or instant"),
    403: errorResponse("Missing work_item:read permission"),
    404: errorResponse("Work item not found or out of reach"),
    422: errorResponse("Journal too long to replay in one request"),
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

/** Clock skew between the audit row and its activity row (see the reconstruct handler). */
const RECONSTRUCT_CLOCK_GRACE_MS = 1000;

const audit = apiRouter<
  BaseVariables & { workspaceId: string; workItemId: string }
>()
  .openapi(listInstanceAuditRoute, async (c) => {
    const rows = await listInstanceAudit(c, c.req.valid("query"));
    return c.json({ rows: rows.map(toRowResponse) }, 200);
  })
  .openapi(exportInstanceAuditRoute, async (c) => {
    c.header("Cache-Control", "no-store");
    const result = await exportInstanceAudit(
      c,
      c.req.valid("json"),
      toRowResponse,
    );
    return c.json(result, 200);
  })
  .openapi(listWorkspaceAuditRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const rows = await listWorkspaceAudit(c, workspaceId, c.req.valid("query"));
    return c.json({ rows: rows.map(toRowResponse) }, 200);
  })
  .openapi(getWorkItemAuditHistoryRoute, async (c) => {
    const { type, id } = c.req.valid("param");
    const workItemId = c.get("workItemId");
    const workspaceId = c.get("workspaceId");
    const rows = await listEntityAuditRows(workspaceId, type, workItemId);
    await writeAuditRead(c, { workspaceId });
    return c.json(
      { entityType: type, entityId: id, rows: rows.map(toRowResponse) },
      200,
    );
  })
  .openapi(reconstructWorkItemRoute, async (c) => {
    const { key } = c.req.valid("param");
    const requestedAt = new Date(c.req.valid("query").at);
    // An audit row and the activity-journal row of the same transaction are stamped by
    // different clocks (database now() vs the application's Date), a few milliseconds
    // apart, and the History view asks for "state as of this audit row". A short grace keeps
    // one transaction's journal rows together; changes further apart are never merged.
    const at = new Date(requestedAt.getTime() + RECONSTRUCT_CLOCK_GRACE_MS);
    const workItemId = c.get("workItemId");
    const { rows, truncated, current } = await listActivityForReconstruction(
      c.get("workspaceId"),
      workItemId,
      at,
    );
    if (truncated)
      throw new HTTPException(422, {
        message: `History exceeds ${RECONSTRUCTION_MAX_ROWS} journal rows`,
      });
    return c.json(
      {
        key,
        workItemId,
        at: requestedAt.toISOString(),
        snapshot: reconstructAt(rows, at, { current }),
      },
      200,
    );
  });

export default audit;
