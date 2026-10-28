import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { IMPORT_PLUGIN_IDS } from "../database/schema-imports";
import { requireCurrentInstanceAdmin } from "../instance/require-instance-admin";
import { apiRouter, createRoute, jsonResponse, z } from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { ensureImportAdaptersRegistered } from "./adapters";
import { createImportEngineRouter } from "./engine/routes";
import type { ImportRunApprovalRequest } from "./engine/service";
import { createImportLinks, listImportLinks } from "./links";
import { requestImportRunApproval } from "./pending-action";
import { createImportReconciliationRouter } from "./reconciliation";
import {
  createImportRunBody,
  dryRunImportBody,
  executeImportBody,
  importRunIdParams,
  linkImportBody,
  listImportLinksQuery,
  listImportRunsQuery,
} from "./schema";
import {
  commitImportChunkRoute,
  createImportRun,
  dryRunImport,
  getImportReport,
  getImportRun,
  type ImportApprovalRequest,
  listImportRuns,
} from "./service";

const error = z.object({ message: z.string() });
const run = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string().nullable(),
  pluginId: z.enum(IMPORT_PLUGIN_IDS),
  sourceRef: z.string(),
  profileId: z.string().nullable(),
  state: z.enum(["queued", "running", "paused", "completed", "failed"]),
  stats: z.record(z.string(), z.number().int().nonnegative()),
  log: z.array(
    z.object({
      code: z.string(),
      at: z.string().datetime(),
      chunkId: z.string().optional(),
    }),
  ),
  version: z.number().int().positive(),
  nextCursor: z.string().nullable(),
  lastCommittedChunk: z.number().int().min(-1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const createRouteDef = createRoute({
  method: "post",
  path: "/imports",
  operationId: "createImportRun",
  tags: ["Imports"],
  summary: "Create an MCP import run",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createImportRunBody } },
    },
  },
  responses: {
    200: jsonResponse("Import run", run),
    400: jsonResponse("Invalid import run", error),
    403: jsonResponse("Forbidden", error),
    404: jsonResponse("Project not found or unreachable", error),
    409: jsonResponse("Source is already registered", error),
  },
});
const listRoute = createRoute({
  method: "get",
  path: "/imports",
  operationId: "listImportRuns",
  tags: ["Imports"],
  summary: "List import runs",
  request: { query: listImportRunsQuery },
  responses: {
    200: jsonResponse(
      "Import runs",
      z.object({ runs: z.array(run), nextCursor: z.string().nullable() }),
    ),
    403: jsonResponse("Forbidden", error),
    404: jsonResponse("Workspace not found", error),
  },
});
const detailRoute = createRoute({
  method: "get",
  path: "/imports/{id}",
  operationId: "getImportRun",
  tags: ["Imports"],
  summary: "Get an import run",
  request: { params: importRunIdParams },
  responses: {
    200: jsonResponse("Import run", run),
    403: jsonResponse("Forbidden", error),
    404: jsonResponse("Import run not found", error),
  },
});
const reportRoute = createRoute({
  method: "get",
  path: "/imports/{id}/report",
  operationId: "getImportReport",
  tags: ["Imports"],
  summary: "Get safe import statistics and fixed-code report",
  request: { params: importRunIdParams },
  responses: {
    200: jsonResponse("Import report", z.record(z.string(), z.unknown())),
    403: jsonResponse("Forbidden", error),
    404: jsonResponse("Import run not found", error),
  },
});
const dryRunRoute = createRoute({
  method: "post",
  path: "/imports/{id}/dry-run",
  operationId: "dryRunImportChunk",
  tags: ["Imports"],
  summary: "Preview an import chunk",
  request: {
    params: importRunIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: dryRunImportBody } },
    },
  },
  responses: {
    200: jsonResponse("Import preview", z.record(z.string(), z.unknown())),
    400: jsonResponse("Invalid chunk", error),
    403: jsonResponse("Forbidden", error),
    404: jsonResponse("Import run not found", error),
    409: jsonResponse("Import run changed", error),
  },
});
const recordsRoute = createRoute({
  method: "post",
  path: "/imports/{id}/records",
  operationId: "commitImportChunk",
  tags: ["Imports"],
  summary: "Commit a previewed import chunk",
  request: {
    params: importRunIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: executeImportBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "Committed import chunk",
      z.record(z.string(), z.unknown()),
    ),
    202: jsonResponse(
      "Import approval requested",
      z.record(z.string(), z.unknown()),
    ),
    400: jsonResponse("Invalid chunk", error),
    403: jsonResponse("Forbidden", error),
    404: jsonResponse("Import run not found", error),
    409: jsonResponse("Import preview changed", error),
  },
});
const createLinksRoute = createRoute({
  method: "post",
  path: "/imports/{id}/links",
  operationId: "createImportLinks",
  tags: ["Imports"],
  summary: "Create or repeat import identity links",
  request: {
    params: importRunIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: linkImportBody } },
    },
  },
  responses: {
    200: jsonResponse("Import links", z.record(z.string(), z.unknown())),
    202: jsonResponse(
      "Import approval requested",
      z.record(z.string(), z.unknown()),
    ),
    403: jsonResponse("Forbidden", error),
    404: jsonResponse("Target not found", error),
    409: jsonResponse("Source already linked to a different target", error),
  },
});
const getLinksRoute = createRoute({
  method: "get",
  path: "/imports/{id}/links",
  operationId: "listImportLinks",
  tags: ["Imports"],
  summary: "List source identity links",
  request: { params: importRunIdParams, query: listImportLinksQuery },
  responses: {
    200: jsonResponse("Import links", z.record(z.string(), z.unknown())),
    403: jsonResponse("Forbidden", error),
    404: jsonResponse("Import run not found", error),
  },
});

function requireIdempotencyKey(c: Context) {
  const key = c.req.header("Idempotency-Key");
  if (
    !key ||
    key.length > 200 ||
    [...key].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    })
  )
    throw new HTTPException(400, { message: "Idempotency-Key is required" });
}

export function createImportRouter(options: {
  requestImportChunkApproval: ImportApprovalRequest;
  /** P6 run-level approval (D2); defaults to the pending-action implementation. */
  requestImportRunApproval?: ImportRunApprovalRequest;
}) {
  ensureImportAdaptersRegistered();
  return apiRouter()
    .openapi(createRouteDef, async (c) => {
      await requireCurrentInstanceAdmin(c, "POST", "/api/imports");
      requireIdempotencyKey(c);
      setShadowLegacyAuthorization(c, "allowed");
      return c.json(await createImportRun(c, c.req.valid("json")), 200);
    })
    .openapi(listRoute, async (c) => {
      await requireCurrentInstanceAdmin(c, "GET", "/api/imports");
      setShadowLegacyAuthorization(c, "allowed");
      return c.json(
        await listImportRuns(c, {
          ...c.req.valid("query"),
          limit: Number(c.req.valid("query").limit),
        }),
        200,
      );
    })
    .openapi(detailRoute, async (c) => {
      await requireCurrentInstanceAdmin(c, "GET", "/api/imports/{id}");
      setShadowLegacyAuthorization(c, "allowed");
      return c.json(await getImportRun(c, c.req.valid("param").id), 200);
    })
    .openapi(reportRoute, async (c) => {
      await requireCurrentInstanceAdmin(c, "GET", "/api/imports/{id}/report");
      setShadowLegacyAuthorization(c, "allowed");
      return c.json(await getImportReport(c, c.req.valid("param").id), 200);
    })
    .openapi(dryRunRoute, async (c) => {
      await requireCurrentInstanceAdmin(c, "POST", "/api/imports/{id}/dry-run");
      requireIdempotencyKey(c);
      setShadowLegacyAuthorization(c, "allowed");
      return c.json(
        await dryRunImport(c, c.req.valid("param").id, c.req.valid("json")),
        200,
      );
    })
    .openapi(recordsRoute, async (c) => {
      await requireCurrentInstanceAdmin(c, "POST", "/api/imports/{id}/records");
      requireIdempotencyKey(c);
      setShadowLegacyAuthorization(c, "allowed");
      const { previewDigest, ...input } = c.req.valid("json");
      const result = await commitImportChunkRoute(
        c,
        { runId: c.req.valid("param").id, ...input, previewDigest },
        options.requestImportChunkApproval,
      );
      if ("kind" in result && result.kind === "pending_approval")
        return c.json(result, 202);
      return c.json(result, 200);
    })
    .openapi(createLinksRoute, async (c) => {
      await requireCurrentInstanceAdmin(c, "POST", "/api/imports/{id}/links");
      requireIdempotencyKey(c);
      setShadowLegacyAuthorization(c, "allowed");
      const result = await createImportLinks(
        c,
        c.req.valid("param").id,
        c.req.valid("json").links,
        options.requestImportChunkApproval,
      );
      if ("kind" in result && result.kind === "pending_approval")
        return c.json(result, 202);
      return c.json(result, 200);
    })
    .openapi(getLinksRoute, async (c) => {
      await requireCurrentInstanceAdmin(c, "GET", "/api/imports/{id}/links");
      setShadowLegacyAuthorization(c, "allowed");
      return c.json(
        await listImportLinks(c, c.req.valid("param").id, c.req.valid("query")),
        200,
      );
    })
    .route("/", createImportReconciliationRouter())
    .route(
      "/",
      createImportEngineRouter({
        requestImportRunApproval:
          options.requestImportRunApproval ?? requestImportRunApproval,
      }),
    );
}

export default createImportRouter;
