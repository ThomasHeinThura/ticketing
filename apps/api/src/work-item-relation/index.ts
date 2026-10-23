import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import {
  createPendingAction,
  requirePendingActionRequesterIdentity,
} from "../pending-action/service";
import { callerReach } from "../utils/caller-reach";
import { apiKeyHasCapabilityScope } from "../utils/require-api-key-permission-scope";
import {
  assertCallerHasCapability,
  capabilityCredential,
  requireWorkspaceCapability,
} from "../utils/require-workspace-capability";
import { assertWorkItemStillLive } from "../work-item/assert-work-item-live";
import { requireWorkItemReach } from "../work-item/require-work-item-reach";
import { findEndpoint, findRelation } from "./repository";
import {
  relationCandidatesSchema,
  relationDeletionSchema,
  relationListSchema,
  relationSchema,
} from "./response";
import {
  createRelationBody,
  relationCandidatesQuery,
  relationIdParam,
  relationKeyParam,
} from "./schema";
import {
  createWorkItemRelation,
  listWorkItemRelationCandidates,
  listWorkItemRelations,
  type RelationEndpoint,
} from "./service";

async function access(c: Context) {
  const reach = await callerReach(c, c.get("userId"));
  let keyCanUpdate = false;
  try {
    await assertCallerHasCapability(
      c.get("workspaceId"),
      c.get("userId"),
      "work_item:update",
      capabilityCredential(c.get("apiKey")),
    );
    keyCanUpdate =
      !c.get("apiKey") ||
      apiKeyHasCapabilityScope(c.get("apiKey"), "work_item:update");
  } catch (error) {
    if (!(error instanceof HTTPException) || error.status !== 403) throw error;
  }
  return {
    canRead: async (row: RelationEndpoint) =>
      (await reach.reaches(row)) && (await reach.can("work_item:read", row)),
    canUpdate: async (row: RelationEndpoint) =>
      keyCanUpdate &&
      (await reach.reaches(row)) &&
      (await reach.can("work_item:update", row)),
    authorize: async (row: RelationEndpoint) => {
      if (!(await reach.reaches(row)))
        throw new HTTPException(404, { message: "Work item not found" });
      if (!keyCanUpdate || !(await reach.can("work_item:update", row)))
        throw new HTTPException(403, { message: "Insufficient permissions" });
    },
  };
}
const candidatesRoute = createRoute({
  method: "get",
  path: "/work-items/{key}/relation-candidates",
  operationId: "getWorkItemRelationCandidates",
  tags: ["Work items"],
  summary: "Search readable and updatable relation peers",
  middleware: [
    requireWorkItemReach("key", { deferApiKeyCapability: true }),
    requireWorkspaceCapability("work_item:update"),
  ] as const,
  request: { params: relationKeyParam, query: relationCandidatesQuery },
  responses: {
    200: jsonResponse("A page of scoped candidates", relationCandidatesSchema),
    400: errorResponse("Invalid candidate query"),
    403: errorResponse("Update permission required"),
    404: errorResponse("Work item not found"),
  },
});
const readRoute = createRoute({
  method: "get",
  path: "/work-items/{key}/relations",
  operationId: "getWorkItemRelations",
  tags: ["Work items"],
  summary: "Read canonical peer relations",
  middleware: [requireWorkItemReach()] as const,
  request: { params: relationKeyParam },
  responses: {
    200: jsonResponse(
      "Visible peer relations and hidden count",
      relationListSchema,
    ),
    400: errorResponse("Invalid key"),
    403: errorResponse("Insufficient permission"),
    404: errorResponse("Work item not found"),
  },
});
const createRelationRoute = createRoute({
  method: "post",
  path: "/work-items/{key}/relations",
  operationId: "createWorkItemRelation",
  tags: ["Work items"],
  summary: "Link canonical work items",
  middleware: [
    requireWorkItemReach("key", { deferApiKeyCapability: true }),
    requireWorkspaceCapability("work_item:update"),
  ] as const,
  request: {
    params: relationKeyParam,
    body: {
      required: true,
      content: { "application/json": { schema: createRelationBody } },
    },
  },
  responses: {
    200: jsonResponse("Created or existing relation", relationSchema),
    400: errorResponse("Invalid relation"),
    403: errorResponse("Update permission required on both ends"),
    404: errorResponse("Work item not found"),
    422: errorResponse("Self relation is invalid"),
  },
});
const deleteRelationRoute = createRoute({
  method: "delete",
  path: "/work-items/{key}/relations/{id}",
  operationId: "requestWorkItemRelationDeletion",
  tags: ["Work items"],
  summary: "Request approved relation removal",
  middleware: [
    requireWorkItemReach("key", { deferApiKeyCapability: true }),
    requireWorkspaceCapability("work_item:update"),
  ] as const,
  request: { params: relationIdParam },
  responses: {
    202: jsonResponse(
      "Pending relation removal; no relation deleted",
      relationDeletionSchema,
    ),
    400: errorResponse("Invalid relation"),
    403: errorResponse("Update permission required on both ends"),
    404: errorResponse("Relation not found"),
    409: errorResponse("An equivalent deletion is pending"),
  },
});

const workItemRelation = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(candidatesRoute, async (c) =>
    c.json(
      relationCandidatesSchema.parse(
        await listWorkItemRelationCandidates({
          key: c.req.valid("param").key,
          workspaceId: c.get("workspaceId"),
          ...c.req.valid("query"),
          ...(await access(c)),
        }),
      ),
      200,
    ),
  )
  .openapi(readRoute, async (c) =>
    c.json(
      relationListSchema.parse(
        await listWorkItemRelations({
          key: c.req.valid("param").key,
          workspaceId: c.get("workspaceId"),
          ...(await access(c)),
        }),
      ),
      200,
    ),
  )
  .openapi(createRelationRoute, async (c) => {
    const { key } = c.req.valid("param");
    return c.json(
      relationSchema.parse(
        await createWorkItemRelation({
          key,
          ...c.req.valid("json"),
          workspaceId: c.get("workspaceId"),
          actorId: c.get("userId"),
          actorType: c.get("apiKey") ? "api_key" : "person",
          authorize: (await access(c)).authorize,
        }),
      ),
      200,
    );
  })
  .openapi(deleteRelationRoute, async (c) => {
    const { key, id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const relation = await findRelation(id);
    const source = await findEndpoint(key, workspaceId);
    assertWorkItemStillLive(source);
    if (
      !relation ||
      (source.id !== relation.sourceId && source.id !== relation.targetId)
    )
      throw new HTTPException(404, { message: "Relation not found" });
    const { authorize } = await access(c);
    // Pending-action service re-resolves, locks and freezes both endpoint identities.
    const apiKey = c.get("apiKey");
    const session = c.get("session");
    await authorize(source);
    const requesterPersonId = await requirePendingActionRequesterIdentity(
      c.get("userId"),
      apiKey,
    );
    const created = await createPendingAction({
      requesterPersonId,
      credentialType: apiKey ? "api_key" : "session",
      credentialId: apiKey?.id ?? session?.id ?? null,
      origin: apiKey ? "api" : "web",
      action: "delete",
      routeKey: "DELETE /api/work-items/{key}/relations/{id}",
      targetType: "relation",
      targetIds: [id],
      workspaceId,
      actorId: c.get("userId"),
      actorType: apiKey ? "api_key" : "person",
      actorIp: c.req.header("x-forwarded-for") ?? null,
      userAgent: c.req.header("user-agent") ?? null,
    });
    return c.json(relationDeletionSchema.parse(created), 202);
  });
export default workItemRelation;
