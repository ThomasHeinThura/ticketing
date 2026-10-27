/**
 * Import engine routes. Every route is instance-administrator work declared in
 * `imports/policy.ts`; every write requires an `Idempotency-Key`.
 *
 *   POST /api/import-sources                     create a read-only source connection
 *   GET  /api/import-sources?workspaceId=        list connections (credentials never returned)
 *   POST /api/import-sources/{id}/runs           create an engine run bound to a project
 *   GET  /api/imports/{id}/engine                run status (phase, pause reason, approval binding)
 *   POST /api/imports/{id}/discover              202; background: connect, discover, propose + persist the mapping
 *   GET  /api/imports/{id}/mapping               mapping entries + completeness + five state groups
 *   POST /api/imports/{id}/mapping               edit entries (version checked); invalidates dry run
 *   POST /api/imports/{id}/dry-run-all           202; background whole-run dry run (NOTE: `/dry-run` is the retained
 *                                                chunk preview of the MCP bulk path, so the run-level
 *                                                dry run lives beside it, not on top of it)
 *   GET  /api/imports/{id}/dry-run-all           last whole-run dry-run report
 *   POST /api/imports/{id}/execute               bind digest + total + mapping version; approve/start
 *   POST /api/imports/{id}/pause | /resume
 *   GET  /api/imports/{id}/losses                loss rows + per type/code summary
 */
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { IMPORT_PLUGIN_IDS } from "../../database/schema-imports";
import { requireCurrentInstanceAdmin } from "../../instance/require-instance-admin";
import { apiRouter, createRoute, jsonResponse, z } from "../../openapi";
import { setShadowLegacyAuthorization } from "../../permissions/shadow-context";
import { importRunIdParams } from "../schema";
import { MAPPING_DOMAINS, STATE_GROUPS } from "./adapter";
import { IMPORT_SOURCE_BODY_LIMIT_BYTES } from "./body-limit";
import {
  createEngineRun,
  createSourceConnection,
  discoverRun,
  dryRunWholeRun,
  executeRun,
  getEngineRun,
  getMapping,
  getWholeRunDryRun,
  type ImportRunApprovalRequest,
  listLosses,
  listSourceConnections,
  pauseRun,
  resumeRun,
  saveMappingEdits,
} from "./service";

const error = z.object({ message: z.string() });
const sourceError = z.object({
  message: z.string(),
  /** Fixed reason code (`file_too_large`, `auth_failed`, `unreachable`, ...). */
  reason: z.string().optional(),
});

export { IMPORT_SOURCE_BODY_LIMIT_BYTES };

const loose = z.record(z.string(), z.unknown());
const opaque = (max: number) => z.string().min(1).max(max);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

function requireIdempotencyKey(c: Context) {
  const key = c.req.header("Idempotency-Key");
  if (
    !key ||
    key.length > 200 ||
    [...key].some((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    })
  )
    throw new HTTPException(400, { message: "Idempotency-Key is required" });
}

const sourceBody = z
  .object({
    workspaceId: opaque(128),
    pluginId: z.enum(IMPORT_PLUGIN_IDS),
    name: opaque(120),
    // Non-secret settings only (base URL, organisation, fixture id). Secrets go in `credential`.
    config: z
      .record(z.string(), z.unknown())
      .refine(
        (config) =>
          !Object.keys(config).some((key) =>
            /(?:secret|token|password|credential|api[-_]?key|authorization)/iu.test(
              key,
            ),
          ),
        "config must not contain secrets; use credential",
      )
      .optional(),
    credential: z.string().min(1).max(4096).optional(),
  })
  .strict();
const runBody = z
  .object({ projectId: opaque(128), sourceRef: opaque(200) })
  .strict();
const target = z.union([
  z.object({ kind: z.literal("target"), id: opaque(128) }).strict(),
  z
    .object({
      kind: z.literal("group"),
      group: z.enum(STATE_GROUPS),
      stateId: opaque(128).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("priority"),
      value: z.enum(["low", "medium", "high", "urgent"]),
    })
    .strict(),
  z.object({ kind: z.literal("placeholder") }).strict(),
  z.object({ kind: z.literal("ignore") }).strict(),
]);
const mappingBody = z
  .object({
    expectedMappingVersion: z.number().int().min(0).safe(),
    entries: z
      .array(
        z
          .object({
            domain: z.enum(MAPPING_DOMAINS),
            value: opaque(512),
            target: target.nullable(),
          })
          .strict(),
      )
      .max(5000),
    confirmProposals: z.boolean().optional(),
  })
  .strict();
const executeBody = z
  .object({
    dryRunDigest: sha256,
    mappingVersion: z.number().int().positive().safe(),
    totalCount: z.number().int().min(0).safe(),
  })
  .strict();
const lossesQuery = z.object({
  code: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,63}$/u)
    .optional(),
  sourceType: opaque(80).optional(),
  cursor: opaque(128).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const sourceIdParams = z.object({ id: opaque(128) });
const sourcesQuery = z.object({ workspaceId: opaque(128) });

const common = { 403: jsonResponse("Forbidden", error) };
const notFound = { 404: jsonResponse("Not found", error) };

const createSourceRoute = createRoute({
  method: "post",
  path: "/import-sources",
  operationId: "createImportSource",
  tags: ["Imports"],
  // Per-route limiter (never `router.use`, which the policy registry would see as an ALL route).
  middleware: [
    bodyLimit({
      maxSize: IMPORT_SOURCE_BODY_LIMIT_BYTES,
      onError: (c) => c.json({ message: "Request body too large" }, 413),
    }),
  ],
  summary: "Create a read-only import source connection",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: sourceBody } },
    },
  },
  responses: {
    200: jsonResponse("Import source", loose),
    409: jsonResponse("Source name already exists", error),
    413: jsonResponse("Request body too large", error),
    502: jsonResponse("Source could not be connected", sourceError),
    ...common,
    ...notFound,
  },
});
const listSourcesRoute = createRoute({
  method: "get",
  path: "/import-sources",
  operationId: "listImportSources",
  tags: ["Imports"],
  summary: "List import source connections",
  request: { query: sourcesQuery },
  responses: {
    200: jsonResponse("Import sources", loose),
    ...common,
    ...notFound,
  },
});
const createRunRoute = createRoute({
  method: "post",
  path: "/import-sources/{id}/runs",
  operationId: "createEngineImportRun",
  tags: ["Imports"],
  summary: "Create an import run for a source",
  request: {
    params: sourceIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: runBody } },
    },
  },
  responses: { 200: jsonResponse("Import run", loose), ...common, ...notFound },
});
const engineRoute = createRoute({
  method: "get",
  path: "/imports/{id}/engine",
  operationId: "getEngineImportRun",
  tags: ["Imports"],
  summary: "Get engine run status",
  request: { params: importRunIdParams },
  responses: { 200: jsonResponse("Import run", loose), ...common, ...notFound },
});
const discoverRoute = createRoute({
  method: "post",
  path: "/imports/{id}/discover",
  operationId: "discoverImportSource",
  tags: ["Imports"],
  summary: "Start discovering the source and proposing a mapping",
  description:
    "Returns 202 at once. Discovery runs in the background: poll GET /imports/{id}/engine for its `job` (progress, then `completed` or a fixed `failure` code) and read the result from GET /imports/{id}/mapping. A request while discovery is running returns its state and never starts a second read.",
  request: { params: importRunIdParams },
  responses: {
    202: jsonResponse("Discovery accepted or already running", loose),
    409: jsonResponse("Run not in a setup state", error),
    ...common,
    ...notFound,
  },
});
const getMappingRoute = createRoute({
  method: "get",
  path: "/imports/{id}/mapping",
  operationId: "getImportMapping",
  tags: ["Imports"],
  summary: "Get the editable mapping",
  request: { params: importRunIdParams },
  responses: { 200: jsonResponse("Mapping", loose), ...common, ...notFound },
});
const postMappingRoute = createRoute({
  method: "post",
  path: "/imports/{id}/mapping",
  operationId: "updateImportMapping",
  tags: ["Imports"],
  summary: "Edit the mapping",
  request: {
    params: importRunIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: mappingBody } },
    },
  },
  responses: {
    200: jsonResponse("Mapping", loose),
    400: jsonResponse("Invalid mapping edit", error),
    409: jsonResponse("Mapping version conflict", error),
    422: jsonResponse("Person target outside the run's organisation", error),
    ...common,
    ...notFound,
  },
});
const dryRunAllRoute = createRoute({
  method: "post",
  path: "/imports/{id}/dry-run-all",
  operationId: "dryRunImportRun",
  tags: ["Imports"],
  summary: "Start the whole-run dry run",
  description:
    "Returns 202 at once. The dry run reads the source in the background and resumes from a checkpoint after a restart: poll GET /imports/{id}/engine for its `job`, then read the report from GET /imports/{id}/dry-run-all. A run paused mid-execution returns to the dry-run stage through this call (its approval is cleared; committed records are kept and skipped). A request while a dry run is running returns its state and never starts a second read.",
  request: { params: importRunIdParams },
  responses: {
    202: jsonResponse("Dry run accepted or already running", loose),
    409: jsonResponse("Run changed or not in a setup state", error),
    ...common,
    ...notFound,
  },
});
const getDryRunAllRoute = createRoute({
  method: "get",
  path: "/imports/{id}/dry-run-all",
  operationId: "getImportRunDryRun",
  tags: ["Imports"],
  summary: "Last whole-run dry-run report",
  request: { params: importRunIdParams },
  responses: {
    200: jsonResponse("Dry-run report", loose),
    ...common,
    ...notFound,
  },
});
const executeRoute = createRoute({
  method: "post",
  path: "/imports/{id}/execute",
  operationId: "executeImportRun",
  tags: ["Imports"],
  summary: "Execute a dry-run-approved import run",
  request: {
    params: importRunIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: executeBody } },
    },
  },
  responses: {
    202: jsonResponse("Execution started or approval requested", loose),
    409: jsonResponse("Blocked", error),
    503: jsonResponse("Approval unavailable", error),
    ...common,
    ...notFound,
  },
});
const pauseRoute = createRoute({
  method: "post",
  path: "/imports/{id}/pause",
  operationId: "pauseImportRun",
  tags: ["Imports"],
  summary: "Pause a running import",
  request: { params: importRunIdParams },
  responses: {
    200: jsonResponse("Import run", loose),
    409: jsonResponse("Not running", error),
    ...common,
    ...notFound,
  },
});
const resumeRoute = createRoute({
  method: "post",
  path: "/imports/{id}/resume",
  operationId: "resumeImportRun",
  tags: ["Imports"],
  summary: "Resume a paused import from its last committed chunk",
  request: { params: importRunIdParams },
  responses: {
    200: jsonResponse("Import run", loose),
    409: jsonResponse("Cannot resume", error),
    ...common,
    ...notFound,
  },
});
const lossesRoute = createRoute({
  method: "get",
  path: "/imports/{id}/losses",
  operationId: "listImportLosses",
  tags: ["Imports"],
  summary: "List the import loss report",
  request: { params: importRunIdParams, query: lossesQuery },
  responses: { 200: jsonResponse("Losses", loose), ...common, ...notFound },
});

export function createImportEngineRouter(options: {
  requestImportRunApproval?: ImportRunApprovalRequest;
}) {
  const guard = async (
    c: Context,
    method: "GET" | "POST",
    path: string,
    write: boolean,
  ) => {
    await requireCurrentInstanceAdmin(c, method, path);
    if (write) requireIdempotencyKey(c);
    setShadowLegacyAuthorization(c, "allowed");
  };
  return apiRouter()
    .openapi(createSourceRoute, async (c) => {
      await guard(c, "POST", "/api/import-sources", true);
      return c.json(await createSourceConnection(c, c.req.valid("json")), 200);
    })
    .openapi(listSourcesRoute, async (c) => {
      await guard(c, "GET", "/api/import-sources", false);
      return c.json(
        await listSourceConnections(c, c.req.valid("query").workspaceId),
        200,
      );
    })
    .openapi(createRunRoute, async (c) => {
      await guard(c, "POST", "/api/import-sources/{id}/runs", true);
      return c.json(
        await createEngineRun(c, c.req.valid("param").id, c.req.valid("json")),
        200,
      );
    })
    .openapi(engineRoute, async (c) => {
      await guard(c, "GET", "/api/imports/{id}/engine", false);
      return c.json(await getEngineRun(c, c.req.valid("param").id), 200);
    })
    .openapi(discoverRoute, async (c) => {
      await guard(c, "POST", "/api/imports/{id}/discover", true);
      return c.json(await discoverRun(c, c.req.valid("param").id), 202);
    })
    .openapi(getMappingRoute, async (c) => {
      await guard(c, "GET", "/api/imports/{id}/mapping", false);
      return c.json(await getMapping(c, c.req.valid("param").id), 200);
    })
    .openapi(postMappingRoute, async (c) => {
      await guard(c, "POST", "/api/imports/{id}/mapping", true);
      return c.json(
        await saveMappingEdits(c, c.req.valid("param").id, c.req.valid("json")),
        200,
      );
    })
    .openapi(dryRunAllRoute, async (c) => {
      await guard(c, "POST", "/api/imports/{id}/dry-run-all", true);
      return c.json(await dryRunWholeRun(c, c.req.valid("param").id), 202);
    })
    .openapi(getDryRunAllRoute, async (c) => {
      await guard(c, "GET", "/api/imports/{id}/dry-run-all", false);
      return c.json(await getWholeRunDryRun(c, c.req.valid("param").id), 200);
    })
    .openapi(executeRoute, async (c) => {
      await guard(c, "POST", "/api/imports/{id}/execute", true);
      return c.json(
        await executeRun(
          c,
          c.req.valid("param").id,
          c.req.valid("json"),
          options.requestImportRunApproval,
        ),
        202,
      );
    })
    .openapi(pauseRoute, async (c) => {
      await guard(c, "POST", "/api/imports/{id}/pause", true);
      return c.json(await pauseRun(c, c.req.valid("param").id), 200);
    })
    .openapi(resumeRoute, async (c) => {
      await guard(c, "POST", "/api/imports/{id}/resume", true);
      return c.json(await resumeRun(c, c.req.valid("param").id), 200);
    })
    .openapi(lossesRoute, async (c) => {
      await guard(c, "GET", "/api/imports/{id}/losses", false);
      return c.json(
        await listLosses(c, c.req.valid("param").id, c.req.valid("query")),
        200,
      );
    });
}

export default createImportEngineRouter;
