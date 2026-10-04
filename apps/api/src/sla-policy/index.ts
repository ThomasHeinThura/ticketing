import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { rejectNulByte } from "../utils/reject-nul-byte";
import { requireApiKeyPermissionScope } from "../utils/require-api-key-permission-scope";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  createPolicy,
  getPolicy,
  listPolicies,
  PolicyVersionConflictError,
  publishPolicy,
  updatePolicy,
} from "./repository";
import {
  slaPolicyListSchema,
  slaPolicySchema,
  slaPolicyVersionConflictSchema,
} from "./response";
import {
  createPolicyBody,
  optionalPolicyIfMatchHeader,
  policyIdParam,
  updatePolicyBody,
  workspaceIdQuery,
} from "./schema";

async function policyReach(c: Context, next: Next) {
  const id = c.req.param("id");
  if (!id) throw new HTTPException(400, { message: "Missing SLA policy id" });
  rejectNulByte(id, "SLA policy id");
  const [row] = await db
    .select({ workspaceId: schema.slaPolicyTable.workspaceId })
    .from(schema.slaPolicyTable)
    .where(eq(schema.slaPolicyTable.id, id))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "SLA policy not found" });
  try {
    await validateWorkspaceAccess(
      c.get("userId"),
      row.workspaceId,
      c.get("apiKey")?.id,
    );
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) {
      throw new HTTPException(404, { message: "SLA policy not found" });
    }
    throw error;
  }
  c.set("workspaceId", row.workspaceId);
  c.set("workspaceIdSource", "row");
  await next();
}

const listRoute = createRoute({
  method: "get",
  path: "/",
  operationId: "listSlaPolicies",
  tags: ["SLA policies"],
  summary: "List SLA policies",
  middleware: [
    workspaceAccess.fromQuery(),
    requireApiKeyPermissionScope({ sla_policy: ["read"] }),
    requireWorkspaceCapability("sla_policy:read"),
  ] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse("SLA policies in the workspace", slaPolicyListSchema),
    400: errorResponse("Invalid workspace, cursor, or limit"),
    403: errorResponse("Missing sla_policy:read permission"),
  },
});

const createRouteDef = createRoute({
  method: "post",
  path: "/",
  operationId: "createSlaPolicy",
  tags: ["SLA policies"],
  summary: "Create an SLA policy and its first draft",
  middleware: [
    workspaceAccess.fromQuery(),
    requireApiKeyPermissionScope({ sla_policy: ["manage"] }),
    requireWorkspaceCapability("sla_policy:manage"),
  ] as const,
  request: {
    query: workspaceIdQuery.pick({ workspaceId: true }),
    body: {
      required: true,
      content: { "application/json": { schema: createPolicyBody } },
    },
  },
  responses: {
    200: jsonResponse("Created SLA policy", slaPolicySchema),
    400: errorResponse("Invalid policy request"),
    403: errorResponse("Missing sla_policy:manage permission"),
    422: errorResponse("Referenced calendar or work-item type is invalid"),
  },
});

const detailRoute = createRoute({
  method: "get",
  path: "/{id}",
  operationId: "getSlaPolicy",
  tags: ["SLA policies"],
  summary: "Get an SLA policy and its active and draft versions",
  middleware: [
    policyReach,
    requireApiKeyPermissionScope({ sla_policy: ["read"] }),
    requireWorkspaceCapability("sla_policy:read"),
  ] as const,
  request: { params: policyIdParam },
  responses: {
    200: jsonResponse("SLA policy details", slaPolicySchema),
    403: errorResponse("Missing sla_policy:read permission"),
    404: errorResponse("SLA policy not found"),
  },
});

const updateRoute = createRoute({
  method: "patch",
  path: "/{id}",
  operationId: "updateSlaPolicy",
  tags: ["SLA policies"],
  summary: "Update policy metadata or its draft",
  description:
    "If-Match may contain the current quoted version. A mismatch returns 409 with asserted/current versions.",
  middleware: [
    policyReach,
    requireApiKeyPermissionScope({ sla_policy: ["manage"] }),
    requireWorkspaceCapability("sla_policy:manage"),
  ] as const,
  request: {
    params: policyIdParam,
    headers: optionalPolicyIfMatchHeader,
    body: {
      required: true,
      content: { "application/json": { schema: updatePolicyBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated SLA policy", slaPolicySchema),
    400: errorResponse("Invalid policy request"),
    403: errorResponse("Missing sla_policy:manage permission"),
    404: errorResponse("SLA policy not found"),
    409: jsonResponse(
      "SLA policy version conflict",
      slaPolicyVersionConflictSchema,
    ),
    422: errorResponse("Referenced calendar or work-item type is invalid"),
  },
});

const publishRoute = createRoute({
  method: "post",
  path: "/{id}/publish",
  operationId: "publishSlaPolicy",
  tags: ["SLA policies"],
  summary: "Publish the current SLA policy draft",
  description:
    "If-Match may contain the current quoted version. A mismatch returns 409 with asserted/current versions.",
  middleware: [
    policyReach,
    requireApiKeyPermissionScope({ sla_policy: ["manage"] }),
    requireWorkspaceCapability("sla_policy:manage"),
  ] as const,
  request: { params: policyIdParam, headers: optionalPolicyIfMatchHeader },
  responses: {
    200: jsonResponse("Published SLA policy", slaPolicySchema),
    403: errorResponse("Missing sla_policy:manage permission"),
    404: errorResponse("SLA policy not found"),
    409: jsonResponse(
      "SLA policy version conflict or no draft",
      slaPolicyVersionConflictSchema,
    ),
    422: errorResponse("Draft needs at least one complete goal matrix"),
  },
});

const router = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listRoute, async (c) => {
    const query = c.req.valid("query");
    return c.json(await listPolicies(query.workspaceId, query), 200);
  })
  .openapi(createRouteDef, async (c) => {
    const query = c.req.valid("query");
    const body = c.req.valid("json");
    const apiKey = c.get("apiKey");
    const result = await createPolicy(
      { ...body, workspaceId: query.workspaceId },
      {
        actorId: c.get("userId"),
        actorType: apiKey ? "api_key" : "person",
        apiKeyId: apiKey?.id ?? null,
        userAgent: c.req.header("user-agent") ?? null,
      },
    );
    if (!result) throw new Error("Created SLA policy could not be read");
    return c.json(slaPolicySchema.parse(result), 200);
  })
  .openapi(detailRoute, async (c) => {
    const row = await getPolicy(c.req.valid("param").id, c.get("workspaceId"));
    if (!row) throw new HTTPException(404, { message: "SLA policy not found" });
    return c.json(slaPolicySchema.parse(row), 200);
  })
  .openapi(updateRoute, async (c) => {
    const apiKey = c.get("apiKey");
    const ifMatch = c.req.valid("header")["if-match"];
    const assertedVersion = ifMatch ? Number(ifMatch.slice(1, -1)) : undefined;
    try {
      const row = await updatePolicy(
        c.req.valid("param").id,
        c.get("workspaceId"),
        c.req.valid("json"),
        assertedVersion,
        {
          actorId: c.get("userId"),
          actorType: apiKey ? "api_key" : "person",
          apiKeyId: apiKey?.id ?? null,
          userAgent: c.req.header("user-agent") ?? null,
        },
      );
      if (!row)
        throw new HTTPException(404, { message: "SLA policy not found" });
      return c.json(slaPolicySchema.parse(row), 200);
    } catch (error) {
      if (error instanceof PolicyVersionConflictError) {
        return c.json(
          {
            message: error.message,
            assertedVersion: error.assertedVersion,
            currentVersion: error.currentVersion,
          },
          409,
        );
      }
      throw error;
    }
  })
  .openapi(publishRoute, async (c) => {
    const apiKey = c.get("apiKey");
    const ifMatch = c.req.valid("header")["if-match"];
    const assertedVersion = ifMatch ? Number(ifMatch.slice(1, -1)) : undefined;
    try {
      const row = await publishPolicy(
        c.req.valid("param").id,
        c.get("workspaceId"),
        assertedVersion,
        {
          actorId: c.get("userId"),
          actorType: apiKey ? "api_key" : "person",
          apiKeyId: apiKey?.id ?? null,
          userAgent: c.req.header("user-agent") ?? null,
        },
      );
      if (!row)
        throw new HTTPException(404, { message: "SLA policy not found" });
      return c.json(slaPolicySchema.parse(row), 200);
    } catch (error) {
      if (error instanceof PolicyVersionConflictError) {
        return c.json(
          {
            message: error.message,
            assertedVersion: error.assertedVersion,
            currentVersion: error.currentVersion,
          },
          409,
        );
      }
      throw error;
    }
  });

export default router;
