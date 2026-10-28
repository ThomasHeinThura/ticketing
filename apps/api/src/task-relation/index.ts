import type { ResolvedIdentity } from "@taskdesk/permissions";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { resolveRequestIdentity } from "../permissions/resolve-request-identity";
import { assertWorkItemProjectReach } from "../utils/assert-work-item-project-reach";
import { callerReach } from "../utils/caller-reach";
import {
  legacyDeletionGoneMessage,
  legacyDeletionGoneMiddleware,
  legacyDeletionGoneResponseHeaders,
} from "../utils/legacy-deletion-gone";
import { markReach } from "../utils/reach-mark";
import { rejectNulByte } from "../utils/reject-nul-byte";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createTaskRelation from "./controllers/create-task-relation";
import getTaskRelations from "./controllers/get-task-relations";
import { findRelationEndpoints, findTaskReachRow } from "./repository";
import {
  taskRelationSchema,
  taskRelationWithTasksListSchema,
} from "./response";
import {
  createTaskRelationBody,
  taskIdParam,
  taskRelationParam,
} from "./schema";

const RELATION_DELETION_SUCCESSOR = "/api/work-items/{key}/relations/{id}";

async function requestIdentity(
  c: Context<{ Variables: BaseVariables & { workspaceId: string } }>,
): Promise<ResolvedIdentity> {
  const session = c.get("session") as { impersonatedBy?: string | null } | null;
  const identity = await resolveRequestIdentity({
    userId: c.get("userId"),
    apiKey: c.get("apiKey"),
    impersonatedBy: session?.impersonatedBy,
  });
  if (!identity) throw new HTTPException(403, { message: "Forbidden" });
  return identity;
}

function requireUserId(c: Context) {
  const userId = c.get("userId");
  if (!userId) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  return userId as string;
}

// Route middleware runs before the request validators, so these read the raw
// request rather than c.req.valid(), which is not populated yet.
async function scopeToSourceTask(c: Context, next: Next) {
  const userId = requireUserId(c);
  const identity = await requestIdentity(c);

  const body = (await c.req.json().catch(() => ({}))) as {
    sourceTaskId?: unknown;
  };
  const sourceTaskId =
    typeof body?.sourceTaskId === "string" ? body.sourceTaskId : null;
  if (!sourceTaskId) {
    throw new HTTPException(400, { message: "sourceTaskId is required" });
  }
  // #290 S4 sweep: this reaches `workspaceIdOfTask`'s raw `eq(taskTable.id, ...)`
  // query below, unvalidated -- a NUL byte would otherwise 500 instead of a clean
  // 400, the same class #281 fixed for path/query ids.
  rejectNulByte(sourceTaskId, "Task id");

  const sourceTask = await findTaskReachRow(identity, sourceTaskId);
  if (!sourceTask) {
    throw new HTTPException(404, { message: "Source task not found" });
  }
  const workspaceId = sourceTask.workspaceId;

  // #290 follow-up: a source task that exists but is in a workspace the caller
  // can't reach used to leak a bare 403 here, distinguishable from the 404 just
  // above for a genuinely nonexistent task -- the same existence-oracle class
  // #290 closed for every `workspaceAccess.from*` helper. Caught and re-thrown as
  // the identical "not found" answer, so the two are indistinguishable again.
  try {
    await validateWorkspaceAccess(userId, workspaceId);
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) {
      throw new HTTPException(404, { message: "Source task not found" });
    }
    throw error;
  }
  c.set("workspaceId", workspaceId);
  // #400 F1 (Opus review): row-derived (the source task's own project), never from
  // the caller's request -- label it so shadow mode's evidence gate keeps it instead
  // of always nulling it.
  c.set("workspaceIdSource", "row");
  await assertWorkItemProjectReach(
    c,
    userId,
    {
      projectId: sourceTask.projectId,
      workspaceId: sourceTask.workspaceId,
      workItemId: sourceTask.taskId,
    },
    { notFoundMessage: "Source task not found", deferApiKeyCapability: true },
  );
  return next();
}

async function scopeToRelation(c: Context, next: Next) {
  const userId = requireUserId(c);
  const identity = await requestIdentity(c);

  const id = c.req.param("id");
  // #281 sweep: this id reaches a raw `eq(taskRelationTable.id, ...)` query below,
  // unvalidated -- a NUL byte would otherwise 500 instead of a clean 400.
  if (id) {
    rejectNulByte(id, "Task relation id");
  }
  const rel = await findRelationEndpoints(identity, id ?? "");
  if (!rel) {
    throw new HTTPException(404, { message: "Task relation not found" });
  }

  const relationSource = await findTaskReachRow(identity, rel.sourceTaskId);
  const relationTarget = await findTaskReachRow(identity, rel.targetTaskId);
  if (!relationSource || !relationTarget) {
    throw new HTTPException(404, { message: "Task not found" });
  }
  const workspaceId = relationSource.workspaceId;

  // #290 follow-up: same class as `scopeToSourceTask` above -- a relation whose
  // source task is in a workspace the caller can't reach used to leak a bare 403,
  // distinguishable from the 404 a nonexistent relation id gets. Re-thrown as the
  // same 404 this route already gives for "no such relation", since the relation
  // id in the path is the identifier a caller would otherwise be able to probe.
  try {
    await validateWorkspaceAccess(userId, workspaceId);
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) {
      throw new HTTPException(404, { message: "Task relation not found" });
    }
    throw error;
  }
  c.set("workspaceId", workspaceId);
  // #400 F1 (Opus review): row-derived (the relation's source task's own project),
  // never from the caller's request -- label it so shadow mode's evidence gate keeps
  // it instead of always nulling it.
  c.set("workspaceIdSource", "row");
  await assertWorkItemProjectReach(
    c,
    userId,
    {
      projectId: relationSource.projectId,
      workspaceId: relationSource.workspaceId,
      workItemId: relationSource.taskId,
    },
    {
      notFoundMessage: "Task relation not found",
      deferApiKeyCapability: true,
    },
  );
  // Removing a relation needs update on BOTH ends (`relations-and-hierarchy.md`).
  await assertWorkItemProjectReach(
    c,
    userId,
    {
      projectId: relationTarget.projectId,
      workspaceId: relationTarget.workspaceId,
      workItemId: relationTarget.taskId,
    },
    {
      notFoundMessage: "Task relation not found",
      deferApiKeyCapability: true,
    },
  );
  return next();
}

const getTaskRelationsRoute = createRoute({
  method: "get",
  operationId: "getTaskRelations",
  path: "/{taskId}",
  tags: ["Task Relations"],
  summary: "Get task relations",
  description:
    "Get every relation where the task is the source or the target, each with a summary of both linked tasks. Relations pointing outside the caller's workspace are omitted.",
  middleware: [
    workspaceAccess.fromTaskId("taskId", { requireProjectReach: true }),
  ] as const,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse(
      "Task relations with the linked task summaries",
      taskRelationWithTasksListSchema,
    ),
    // #290: a task that doesn't exist and a task in a workspace the caller can't
    // reach both answer this same 404 now, via `workspaceAccess.fromTaskId()`.
    400: errorResponse("taskId must not contain a NUL (\\u0000) byte"),
    404: errorResponse("Task not found"),
  },
});

markReach(scopeToSourceTask, { projectReach: true });
markReach(scopeToRelation, { projectReach: true });

const createTaskRelationRoute = createRoute({
  method: "post",
  operationId: "createTaskRelation",
  path: "/",
  tags: ["Task Relations"],
  summary: "Create task relation",
  description:
    "Link two tasks. Authorization is scoped to the source task's workspace.",
  middleware: [
    scopeToSourceTask,
    requireWorkspacePermission({ work_item: ["update"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createTaskRelationBody } },
    },
  },
  responses: {
    200: jsonResponse("The created relation", taskRelationSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse("Missing work_item:update permission"),
    // #290 follow-up: an unreachable source task now answers this same 404 as a
    // nonexistent one, via `scopeToSourceTask`.
    404: errorResponse("Source or target task not found"),
    409: errorResponse("This relation already exists"),
  },
});

const deleteTaskRelationRoute = createRoute({
  method: "delete",
  operationId: "deleteTaskRelation",
  path: "/{id}",
  tags: ["Task Relations"],
  deprecated: true,
  summary: "Delete task relation (removed; 410)",
  description:
    "Removed. This route used to delete a relation immediately with no approval. It now answers 410 Gone (after the same reach and permission checks). Request deletion through DELETE /api/work-items/{key}/relations/{id}, which records a pending action.",
  middleware: [
    legacyDeletionGoneMiddleware(RELATION_DELETION_SUCCESSOR),
    scopeToRelation,
    requireWorkspacePermission({ work_item: ["update"] }),
  ] as const,
  request: { params: taskRelationParam },
  responses: {
    403: errorResponse("Missing work_item:update permission"),
    // #290 follow-up: an unreachable relation/source task now answers this same 404
    // as a nonexistent one, via `scopeToRelation`.
    404: errorResponse("Task relation not found, or its source task is gone"),
    410: {
      ...errorResponse(
        "Removed: use DELETE /api/work-items/{key}/relations/{id}",
      ),
      headers: legacyDeletionGoneResponseHeaders(RELATION_DELETION_SUCCESSOR),
    },
  },
});

const taskRelation = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(getTaskRelationsRoute, async (c) => {
    const reach = await callerReach(c, c.get("userId"));
    const identity = await requestIdentity(c);
    return c.json(
      await getTaskRelations(
        identity,
        c.req.valid("param").taskId,
        c.get("workspaceId"),
        (task) => reach.reaches(task),
      ),
      200,
    );
  })
  .openapi(createTaskRelationRoute, async (c) => {
    const { sourceTaskId, targetTaskId, relationType } = c.req.valid("json");
    const reach = await callerReach(c, c.get("userId"));
    const identity = await requestIdentity(c);
    return c.json(
      await createTaskRelation({
        identity,
        sourceTaskId,
        targetTaskId,
        relationType,
        userId: c.get("userId"),
        apiKeyId: c.get("apiKey")?.id,
        workspaceId: c.get("workspaceId"),
        canReachTarget: async (task) =>
          (await reach.reaches(task)) &&
          (await reach.can("work_item:update", task)),
      }),
      200,
    );
  })
  .openapi(deleteTaskRelationRoute, (c) =>
    c.text(legacyDeletionGoneMessage(RELATION_DELETION_SUCCESSOR), 410),
  );

export default taskRelation;
