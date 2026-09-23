import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { projectTable, taskRelationTable, taskTable } from "../database/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { rejectNulByte } from "../utils/reject-nul-byte";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createTaskRelation from "./controllers/create-task-relation";
import deleteTaskRelation from "./controllers/delete-task-relation";
import getTaskRelations from "./controllers/get-task-relations";
import {
  taskRelationSchema,
  taskRelationWithTasksListSchema,
} from "./response";
import {
  createTaskRelationBody,
  taskIdParam,
  taskRelationParam,
} from "./schema";

async function workspaceIdOfTask(taskId: string) {
  const [task] = await db
    .select({ workspaceId: projectTable.workspaceId })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(eq(taskTable.id, taskId))
    .limit(1);
  return task?.workspaceId ?? null;
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

  const workspaceId = await workspaceIdOfTask(sourceTaskId);
  if (!workspaceId) {
    throw new HTTPException(404, { message: "Source task not found" });
  }

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
  return next();
}

async function scopeToRelation(c: Context, next: Next) {
  const userId = requireUserId(c);

  const id = c.req.param("id");
  // #281 sweep: this id reaches a raw `eq(taskRelationTable.id, ...)` query below,
  // unvalidated -- a NUL byte would otherwise 500 instead of a clean 400.
  if (id) {
    rejectNulByte(id, "Task relation id");
  }
  const [rel] = await db
    .select({ sourceTaskId: taskRelationTable.sourceTaskId })
    .from(taskRelationTable)
    .where(eq(taskRelationTable.id, id ?? ""))
    .limit(1);
  if (!rel) {
    throw new HTTPException(404, { message: "Task relation not found" });
  }

  const workspaceId = await workspaceIdOfTask(rel.sourceTaskId);
  if (!workspaceId) {
    throw new HTTPException(404, { message: "Task not found" });
  }

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
  middleware: [workspaceAccess.fromTaskId("taskId")] as const,
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
    requireWorkspacePermission({ task: ["update"] }),
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
    403: errorResponse("Missing task:update permission"),
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
  summary: "Delete task relation",
  description: "Remove a link between two tasks. Returns the deleted relation.",
  middleware: [
    scopeToRelation,
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: { params: taskRelationParam },
  responses: {
    200: jsonResponse("The deleted relation", taskRelationSchema),
    403: errorResponse("Missing task:update permission"),
    // #290 follow-up: an unreachable relation/source task now answers this same 404
    // as a nonexistent one, via `scopeToRelation`.
    404: errorResponse("Task relation not found, or its source task is gone"),
  },
});

const taskRelation = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(getTaskRelationsRoute, async (c) =>
    c.json(
      await getTaskRelations(c.req.valid("param").taskId, c.get("workspaceId")),
      200,
    ),
  )
  .openapi(createTaskRelationRoute, async (c) => {
    const { sourceTaskId, targetTaskId, relationType } = c.req.valid("json");
    return c.json(
      await createTaskRelation({
        sourceTaskId,
        targetTaskId,
        relationType,
        userId: c.get("userId"),
        workspaceId: c.get("workspaceId"),
      }),
      200,
    );
  })
  .openapi(deleteTaskRelationRoute, async (c) =>
    c.json(
      await deleteTaskRelation(c.req.valid("param").id, c.get("userId")),
      200,
    ),
  );

export default taskRelation;
