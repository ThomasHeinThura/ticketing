import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { runWithStepUp, stepUpTokenHeader } from "../auth/step-up-spend";
import { requireCurrentInstanceAdmin } from "../instance/require-instance-admin";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import {
  registeredDeletionRequestSchema,
  requestRegisteredDeletion,
} from "../pending-action/deletion-targets";
import { requireSessionOnly } from "../utils/require-session-only";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { requireWorkspaceMembership } from "../utils/require-workspace-membership";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { clientIpForContext } from "./enforce";
import { listKeysForInstance } from "./repository";
import {
  apiKeyCreatedSchema,
  apiKeyListSchema,
  apiKeySummarySchema,
  createPersonalKeyBody,
  createServiceKeyBody,
  instanceApiKeyListSchema,
  instanceKeyListQuery,
  personalKeyParam,
  workspaceIdParam,
  workspaceKeyParam,
} from "./schema";
import {
  createPersonalApiKey,
  createServiceApiKey,
  listMyApiKeys,
  listWorkspaceApiKeys,
  revokePersonalApiKey,
  revokeServiceApiKey,
} from "./service";
import { SERVICE_KEY_DELETION_ROUTE } from "./service-key-deletion-target";
import { toApiKeySummary } from "./summary";

const noStore = { "cache-control": "no-store" } as const;

/**
 * The create response carries the key itself. The idempotency layer would store a keyed
 * 2xx response for 24 hours and replay it, so a plaintext credential would sit in that table;
 * this route refuses the header instead (a non-2xx outcome releases the key). The personal
 * create route is already on the idempotency layer's secret-bearing list; this route
 * is not until that list gains it, and the refusal stays as defence in depth after.
 */
async function refuseIdempotencyKey(c: Context, next: Next) {
  if (c.req.header("Idempotency-Key") !== undefined)
    throw new HTTPException(400, {
      message:
        "idempotency_key_not_accepted: this response carries a one-time secret and is never stored or replayed",
    });
  await next();
}

const listMyKeysRoute = createRoute({
  method: "get",
  operationId: "listMyApiKeys",
  path: "/me/api-keys",
  tags: ["API keys"],
  summary: "List my API keys",
  description:
    "The caller's own personal keys: prefix, capabilities, last used time and address, expiry (`AK-5`). The key itself is never returned after creation.",
  responses: {
    200: jsonResponse("The caller's personal API keys", apiKeyListSchema),
    401: errorResponse("Authentication required"),
  },
});

const createMyKeyRoute = createRoute({
  method: "post",
  operationId: "createMyApiKey",
  path: "/me/api-keys",
  tags: ["API keys"],
  summary: "Create a personal API key",
  description:
    "Read-only unless write capabilities are explicitly requested (`AK-9`). The key is returned once, here, and cannot be retrieved later (`AK-2`). A personal key is clamped to its owner's live authority on every request (`AK-3`).",
  middleware: [requireSessionOnly()] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createPersonalKeyBody } },
    },
  },
  responses: {
    201: jsonResponse("The new key, shown once", apiKeyCreatedSchema),
    400: errorResponse("Invalid name, capability, expiry or allowlist entry"),
    401: errorResponse("Authentication required"),
    403: errorResponse("A browser session by a staff account is required"),
  },
});

const revokeMyKeyRoute = createRoute({
  method: "post",
  operationId: "revokeMyApiKey",
  path: "/me/api-keys/{id}/revoke",
  tags: ["API keys"],
  summary: "Revoke a personal API key",
  description:
    "Immediate (`AK-6`). Not a deletion: the row stays for audit, and any pending action the key requested is invalidated.",
  request: { params: personalKeyParam },
  responses: {
    200: jsonResponse("The revoked key", apiKeySummarySchema),
    401: errorResponse("Authentication required"),
    404: errorResponse("API key not found"),
  },
});

const listServiceKeysRoute = createRoute({
  method: "get",
  operationId: "listWorkspaceApiKeys",
  path: "/workspaces/{id}/api-keys",
  tags: ["API keys"],
  summary: "List a workspace's service keys",
  middleware: [
    workspaceAccess.fromParam("id"),
    requireWorkspaceMembership,
    requireWorkspaceCapability("api_key:manage"),
  ] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("Service keys of this workspace", apiKeyListSchema),
    403: errorResponse("Missing api_key:manage"),
  },
});

const createServiceKeyRoute = createRoute({
  method: "post",
  operationId: "createWorkspaceApiKey",
  path: "/workspaces/{id}/api-keys",
  tags: ["API keys"],
  summary: "Create a workspace service key",
  description:
    "Elevated: spends a one-use PA-15 step-up proof (`service_key_create`) sent in `X-TaskDesk-Step-Up-Token`. Owned by the workspace, not a person (`AK-7`). Its capability subset is bounded by the creator's authority now and frozen; the exact set is audited. Never an MCP key (`AK-10`).",
  middleware: [
    refuseIdempotencyKey,
    requireSessionOnly(),
    workspaceAccess.fromParam("id"),
    requireWorkspaceMembership,
    requireWorkspaceCapability("api_key:manage"),
  ] as const,
  request: {
    headers: stepUpTokenHeader,
    params: workspaceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createServiceKeyBody } },
    },
  },
  responses: {
    201: jsonResponse("The new key, shown once", apiKeyCreatedSchema),
    400: errorResponse("Invalid name, capability, expiry or allowlist entry"),
    403: errorResponse(
      "Not a browser session, missing api_key:manage, a capability beyond the creator's own, or the step-up proof is missing (step_up_required) or unusable (step_up_unavailable)",
    ),
  },
});

const deleteServiceKeyRoute = createRoute({
  method: "delete",
  operationId: "deleteWorkspaceApiKey",
  path: "/workspaces/{id}/api-keys/{keyId}",
  tags: ["API keys"],
  summary: "Request deletion of a workspace service key",
  description:
    "Opens a pending action (typed exact name + step-up, `AK-11`); nothing is deleted until the requester approves it in the browser. A key or an impersonation session is `403 session_required`.",
  middleware: [
    requireSessionOnly(),
    workspaceAccess.fromParam("id"),
    requireWorkspaceMembership,
    requireWorkspaceCapability("api_key:manage"),
  ] as const,
  request: { params: workspaceKeyParam },
  responses: {
    202: jsonResponse("Pending deletion", registeredDeletionRequestSchema),
    403: errorResponse("session_required, or missing api_key:manage"),
    404: errorResponse("API key not found"),
    409: errorResponse("A deletion of this key is already pending"),
  },
});

const revokeServiceKeyRoute = createRoute({
  method: "post",
  operationId: "revokeWorkspaceApiKey",
  path: "/workspaces/{id}/api-keys/{keyId}/revoke",
  tags: ["API keys"],
  summary: "Revoke a workspace service key",
  description: "Immediate (`AK-6`); the row stays for audit.",
  middleware: [
    workspaceAccess.fromParam("id"),
    requireWorkspaceMembership,
    requireWorkspaceCapability("api_key:manage"),
  ] as const,
  request: { params: workspaceKeyParam },
  responses: {
    200: jsonResponse("The revoked key", apiKeySummarySchema),
    403: errorResponse("Missing api_key:manage"),
    404: errorResponse("API key not found"),
  },
});

const listInstanceKeysRoute = createRoute({
  method: "get",
  operationId: "listInstanceApiKeys",
  path: "/instance/api-keys",
  tags: ["API keys"],
  summary: "List every API key on the instance",
  description:
    "God Mode inventory (`AK-7`): personal and service keys with owner or workspace, last use and expiry. A service key whose creator has left shows `createdByFormerMember`. Never returns a key or its hash.",
  middleware: [requireSessionOnly()] as const,
  request: { query: instanceKeyListQuery },
  responses: {
    200: jsonResponse("Every key on the instance", instanceApiKeyListSchema),
    403: errorResponse("Instance administrators only"),
  },
});

function requestContext(c: {
  get: (key: "userId") => string;
  req: { header: (name: string) => string | undefined };
}) {
  const userId = c.get("userId");
  if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
  return {
    userId,
    userAgent: c.req.header("user-agent") ?? null,
  };
}

const apiKey = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listMyKeysRoute, async (c) => {
    const { userId } = requestContext(c);
    return c.json({ apiKeys: await listMyApiKeys(userId) }, 200);
  })
  .openapi(createMyKeyRoute, async (c) => {
    const created = await createPersonalApiKey(
      { ...requestContext(c), actorIp: clientIpForContext(c) },
      c.req.valid("json"),
    );
    return c.json(created, 201, noStore);
  })
  .openapi(revokeMyKeyRoute, async (c) => {
    const revoked = await revokePersonalApiKey(
      { ...requestContext(c), actorIp: clientIpForContext(c) },
      c.req.valid("param").id,
    );
    return c.json(revoked, 200);
  })
  .openapi(listInstanceKeysRoute, async (c) => {
    await requireCurrentInstanceAdmin(c, "GET", "/api/instance/api-keys");
    const { limit } = c.req.valid("query");
    const { rows, hasMore } = await listKeysForInstance(limit);
    return c.json(
      {
        apiKeys: rows.map((row) => ({
          ...toApiKeySummary(row),
          ownerName: row.ownerName,
          workspaceName: row.workspaceName,
        })),
        hasMore,
      },
      200,
    );
  })
  .openapi(listServiceKeysRoute, async (c) => {
    const { id } = c.req.valid("param");
    return c.json({ apiKeys: await listWorkspaceApiKeys(id) }, 200);
  })
  .openapi(createServiceKeyRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    // Elevated (AK-7): the proof is bound to this workspace and this exact name, capability
    // subset, expiry and limits, and is spent in the key's own insert transaction.
    const created = await runWithStepUp(
      c,
      { ...body, operation: "service_key_create", workspaceId: id },
      (spend) =>
        createServiceApiKey(
          { ...requestContext(c), actorIp: clientIpForContext(c) },
          id,
          body,
          spend,
        ),
    );
    return c.json(created, 201, noStore);
  })
  .openapi(deleteServiceKeyRoute, async (c) => {
    const { id, keyId } = c.req.valid("param");
    const pending = await requestRegisteredDeletion(c, {
      routeKey: SERVICE_KEY_DELETION_ROUTE,
      targetType: "api_key",
      id: keyId,
      workspaceId: id,
    });
    return c.json(pending, 202);
  })
  .openapi(revokeServiceKeyRoute, async (c) => {
    const { id, keyId } = c.req.valid("param");
    const revoked = await revokeServiceApiKey(
      { ...requestContext(c), actorIp: clientIpForContext(c) },
      id,
      keyId,
    );
    return c.json(revoked, 200);
  });

export default apiKey;
