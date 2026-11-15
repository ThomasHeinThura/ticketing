import type { ResolvedIdentity } from "@taskdesk/permissions";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { assertOrganisationStorageQuota } from "../attachment/storage-quota";
import db from "../database";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import {
  assertTaskImageKeyMatchesContext,
  createTaskImageUploadUrl,
  deleteStorageObject,
  getMaxImageUploadBytes,
  getObjectSizeAndHeader,
  isImageContentType,
  validateTaskAssetUploadInput,
} from "../storage";
import { resolveCallerIdentity } from "../utils/has-project-reach";
import { normalizeApiServerUrl } from "../utils/openapi-spec";
import { requirePublicAppOrigin } from "../utils/request-origin";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  lockProjectAndAssertLiveForTaskNumberForIdentity,
  lockTaskAndAssertProjectLiveForIdentity,
} from "./assert-task-project-live";
import createTask from "./controllers/create-task";
import { LEGACY_TASK_DELETION_GONE_MESSAGE } from "./controllers/delete-task";
import getTask from "./controllers/get-task";
import getTasks from "./controllers/get-tasks";
import moveTask from "./controllers/move-task";
import { requireTaskAssigneePermission } from "./controllers/require-task-permission";
import updateTask, {
  TaskVersionConflictError,
} from "./controllers/update-task";
import updateTaskAssignee from "./controllers/update-task-assignee";
import updateTaskDescription from "./controllers/update-task-description";
import updateTaskDueDate from "./controllers/update-task-due-date";
import updateTaskPriority from "./controllers/update-task-priority";
import updateTaskStatus from "./controllers/update-task-status";
import updateTaskTitle from "./controllers/update-task-title";
import {
  findAssetIdByObjectKey,
  findLiveProject,
  findProjectWorkspaceContext,
  insertAsset,
  updateAssetById,
} from "./repository";
import {
  boardSchema,
  finalizedAssetSchema,
  imageUploadSchema,
  moveTaskResultSchema,
  taskSchema,
  taskVersionConflictSchema,
  taskWithAssigneeSchema,
} from "./response";
import {
  createTaskBody,
  finalizeImageUploadBody,
  imageUploadBody,
  listTasksQuery,
  moveTaskBody,
  optionalTaskIfMatchHeader,
  projectIdParam,
  taskIfMatchHeader,
  taskParam,
  updateAssigneeBody,
  updateDescriptionBody,
  updateDueDateBody,
  updatePriorityBody,
  updateStatusBody,
  updateTaskBody,
  updateTitleBody,
} from "./schema";

const listTasksRoute = createRoute({
  method: "get",
  operationId: "listTasks",
  path: "/tasks/{projectId}",
  tags: ["Tasks"],
  summary: "List tasks",
  description:
    "Get a project's board: its columns, each with the tasks in it, plus the archived and planned buckets. Filter and paginate with the query parameters.",
  middleware: [
    workspaceAccess.fromProject("projectId", { requireProjectReach: true }),
  ] as const,
  request: { params: projectIdParam, query: listTasksQuery },
  responses: {
    200: jsonResponse("The project board", boardSchema),
    400: errorResponse("Malformed project ID (including a NUL byte)"),
    404: errorResponse("Project not found or out of reach"),
  },
});

const createTaskRoute = createRoute({
  method: "post",
  operationId: "createTask",
  path: "/{projectId}",
  tags: ["Tasks"],
  summary: "Create task",
  description:
    "Add a task to a project. It is placed in the column named by `status`.",
  middleware: [
    workspaceAccess.fromProject("projectId", {
      requireProjectReach: true,
      deferApiKeyCapability: true,
    }),
    requireWorkspacePermission({ work_item: ["create"] }),
  ] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createTaskBody } },
    },
  },
  responses: {
    200: jsonResponse("The created task", taskSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse("Missing work_item:create permission"),
    404: errorResponse("Project not found"),
  },
});

const getTaskRoute = createRoute({
  method: "get",
  operationId: "getTask",
  path: "/{id}",
  tags: ["Tasks"],
  summary: "Get task",
  description: "Get a single task by ID, with its assignee's name resolved.",
  middleware: [
    workspaceAccess.fromTask("id", { requireProjectReach: true }),
  ] as const,
  request: { params: taskParam },
  responses: {
    200: jsonResponse("Task details", taskWithAssigneeSchema),
    // #290: a nonexistent task and a task in a workspace the caller can't reach both
    // answer this same 404 now, via `workspaceAccess.fromTask()`.
    400: errorResponse("id must not contain a NUL (\\u0000) byte"),
    404: errorResponse("Task not found"),
  },
});

const moveTaskRoute = createRoute({
  method: "put",
  operationId: "moveTask",
  path: "/move/{id}",
  tags: ["Tasks"],
  summary: "Move task",
  description:
    "Move a task to another project, optionally into a named column. Both projects must be in the same workspace.",
  middleware: [
    workspaceAccess.fromTask("id", {
      requireProjectReach: true,
      deferApiKeyCapability: true,
    }),
    requireWorkspacePermission({ work_item: ["update"] }),
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: moveTaskBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The moved task, with both project ids",
      moveTaskResultSchema,
    ),
    400: errorResponse("Invalid body"),
    403: errorResponse("Missing work_item:update permission"),
    404: errorResponse("Task or destination project not found"),
  },
});

const legacyTaskDeprecationHeaders: MiddlewareHandler<{
  Variables: BaseVariables & { workspaceId: string };
}> = async (c, next) => {
  c.header("Deprecation", "@1790812800");
  c.header("Sunset", "Thu, 01 Apr 2027 00:00:00 GMT");
  c.header(
    "Link",
    `</api/v2/task/${c.req.param("id")}>; rel="successor-version"`,
  );
  await next();
};

const legacyTaskResponseHeaders = {
  Deprecation: {
    description: "This compatibility operation was deprecated on 2026-10-01.",
    schema: { type: "string", example: "@1790812800" },
  },
  Sunset: {
    description:
      "Earliest removal date, subject to two subsequent minor releases.",
    schema: { type: "string", example: "Thu, 01 Apr 2027 00:00:00 GMT" },
  },
  Link: {
    description: "Successor version operation.",
    schema: {
      type: "string",
      example: '</api/v2/task/{id}>; rel="successor-version"',
    },
  },
} as const;

const LEGACY_TASK_EXPORT_GONE_MESSAGE =
  "task_export_gone: GET /api/task/export/{projectId} was removed. Export work items through GET /api/work-items/export.";
const LEGACY_TASK_IMPORT_GONE_MESSAGE =
  "task_import_gone: POST /api/task/import/{projectId} was removed. Import work items through POST /api/instance/imports.";

function legacyTaskGoneDeprecationHeaders(
  successor: string,
): MiddlewareHandler<{
  Variables: BaseVariables & { workspaceId: string };
}> {
  return async (c, next) => {
    c.header("Deprecation", "@1790812800");
    c.header("Sunset", "Thu, 01 Apr 2027 00:00:00 GMT");
    c.header("Link", `<${successor}>; rel="successor-version"`);
    await next();
  };
}

function legacyTaskGoneResponseHeaders(successor: string, description: string) {
  return {
    Deprecation: legacyTaskResponseHeaders.Deprecation,
    Sunset: legacyTaskResponseHeaders.Sunset,
    Link: {
      description,
      schema: {
        type: "string",
        example: `<${successor}>; rel="successor-version"`,
      },
    },
  } as const;
}

// DELETE has no `/api/v2/task/{id}` successor, so it carries its own Link to the work-item route.
const legacyTaskDeletionDeprecationHeaders = legacyTaskGoneDeprecationHeaders(
  "/api/work-items/{key}",
);

const legacyTaskDeletionResponseHeaders = legacyTaskGoneResponseHeaders(
  "/api/work-items/{key}",
  "Successor operation (a work-item key, not this task id).",
);

const legacyTaskExportDeprecationHeaders = legacyTaskGoneDeprecationHeaders(
  "/api/work-items/export",
);
const legacyTaskExportResponseHeaders = legacyTaskGoneResponseHeaders(
  "/api/work-items/export",
  "Successor operation for structured work-item export.",
);

const legacyTaskImportDeprecationHeaders = legacyTaskGoneDeprecationHeaders(
  "/api/instance/imports",
);
const legacyTaskImportResponseHeaders = legacyTaskGoneResponseHeaders(
  "/api/instance/imports",
  "Successor operation for work-item imports.",
);

async function runFullTaskUpdate(input: {
  identity: ResolvedIdentity;
  apiKeyId?: string | null;
  id: string;
  assertedVersion: number | undefined;
  title: string;
  status: string;
  startDate: string | undefined;
  dueDate: string | undefined;
  projectId: string;
  description: string;
  priority: string;
  position: number;
  userId: string | undefined;
  currentUserId: string | undefined;
}) {
  try {
    return {
      task: await updateTask(
        input.identity,
        input.id,
        input.assertedVersion,
        input.title,
        input.status,
        input.startDate,
        input.dueDate,
        input.projectId,
        input.description,
        input.priority,
        input.position,
        input.userId,
        input.currentUserId,
        input.apiKeyId,
      ),
    };
  } catch (error) {
    if (error instanceof TaskVersionConflictError) {
      return {
        conflict: {
          message: error.message,
          assertedVersion: error.assertedVersion,
          currentVersion: error.currentVersion,
        },
      };
    }
    throw error;
  }
}

const updateTaskRoute = createRoute({
  method: "put",
  operationId: "updateTask",
  path: "/{id}",
  tags: ["Tasks"],
  deprecated: true,
  summary: "Update task (deprecated compatibility route)",
  description:
    "Deprecated compatibility route. Replace every field of a task. If If-Match is " +
    "supplied, it must be the current quoted version and a mismatch returns 409. Without " +
    "If-Match, prior last-write-wins behavior is preserved. Use PUT /api/v2/task/{id} " +
    "for required optimistic concurrency or a single-field route for narrower edits.",
  middleware: [
    legacyTaskDeprecationHeaders,
    workspaceAccess.fromTask("id", {
      requireProjectReach: true,
      deferApiKeyCapability: true,
    }),
    requireWorkspacePermission({ work_item: ["update"] }),
    requireTaskAssigneePermission,
  ] as const,
  request: {
    params: taskParam,
    headers: optionalTaskIfMatchHeader,
    body: {
      required: true,
      content: { "application/json": { schema: updateTaskBody } },
    },
  },
  responses: {
    200: {
      ...jsonResponse("The updated task", taskSchema),
      headers: legacyTaskResponseHeaders,
    },
    400: {
      ...errorResponse("Invalid body or malformed If-Match header"),
      headers: legacyTaskResponseHeaders,
    },
    403: {
      ...errorResponse(
        "Missing work_item:update or work_item:assign permission",
      ),
      headers: legacyTaskResponseHeaders,
    },
    404: {
      ...errorResponse("Task not found"),
      headers: legacyTaskResponseHeaders,
    },
    409: {
      ...jsonResponse("Task version conflict", taskVersionConflictSchema),
      headers: legacyTaskResponseHeaders,
    },
  },
});

const updateTaskV2Route = createRoute({
  method: "put",
  operationId: "updateTaskV2",
  path: "/{id}",
  tags: ["Tasks"],
  summary: "Update task with optimistic concurrency",
  description:
    "Replace every field of a task using its current quoted If-Match version. A mismatch returns 409 with asserted/current versions. Use the single-field routes for narrower edits.",
  middleware: [
    workspaceAccess.fromTask("id", {
      requireProjectReach: true,
      deferApiKeyCapability: true,
    }),
    requireWorkspacePermission({ work_item: ["update"] }),
    requireTaskAssigneePermission,
  ] as const,
  request: {
    params: taskParam,
    headers: taskIfMatchHeader,
    body: {
      required: true,
      content: { "application/json": { schema: updateTaskBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid body or missing/malformed If-Match header"),
    403: errorResponse(
      "Missing work_item:update or work_item:assign permission",
    ),
    404: errorResponse("Task not found"),
    409: jsonResponse("Task version conflict", taskVersionConflictSchema),
  },
});

const exportTasksRoute = createRoute({
  method: "get",
  operationId: "exportTasks",
  path: "/export/{projectId}",
  tags: ["Tasks"],
  deprecated: true,
  summary: "Export tasks (removed; 410)",
  description:
    "Removed. Legacy project JSON task export now answers 410 Gone (after the same reach, " +
    "capability, and live-project checks) under the compatibility Deprecation/Sunset headers. " +
    "Use GET /api/work-items/export instead.",
  middleware: [
    legacyTaskExportDeprecationHeaders,
    workspaceAccess.fromProject("projectId", { requireProjectReach: true }),
  ] as const,
  request: { params: projectIdParam },
  responses: {
    400: {
      ...errorResponse("Malformed project ID (including a NUL byte)"),
      headers: legacyTaskExportResponseHeaders,
    },
    403: {
      ...errorResponse("Missing work_item:read permission"),
      headers: legacyTaskExportResponseHeaders,
    },
    404: {
      ...errorResponse("Project not found or out of reach"),
      headers: legacyTaskExportResponseHeaders,
    },
    410: {
      ...errorResponse("Removed: use GET /api/work-items/export"),
      headers: legacyTaskExportResponseHeaders,
    },
  },
});

const importTasksRoute = createRoute({
  method: "post",
  operationId: "importTasks",
  path: "/import/{projectId}",
  tags: ["Tasks"],
  deprecated: true,
  summary: "Import tasks (removed; 410)",
  description:
    "Removed. Legacy JSON task import now answers 410 Gone (after the same reach, " +
    "permission, and live-project checks) under the compatibility Deprecation/Sunset headers. " +
    "Use POST /api/instance/imports instead.",
  middleware: [
    legacyTaskImportDeprecationHeaders,
    workspaceAccess.fromProject("projectId", {
      requireProjectReach: true,
      deferApiKeyCapability: true,
    }),
    requireWorkspacePermission({ work_item: ["create"] }),
  ] as const,
  request: { params: projectIdParam },
  responses: {
    400: {
      ...errorResponse("Malformed project ID (including a NUL byte)"),
      headers: legacyTaskImportResponseHeaders,
    },
    403: {
      ...errorResponse("Missing work_item:create permission"),
      headers: legacyTaskImportResponseHeaders,
    },
    404: {
      ...errorResponse("Project not found"),
      headers: legacyTaskImportResponseHeaders,
    },
    410: {
      ...errorResponse("Removed: use POST /api/instance/imports"),
      headers: legacyTaskImportResponseHeaders,
    },
  },
});

const deleteTaskRoute = createRoute({
  method: "delete",
  operationId: "deleteTask",
  path: "/{id}",
  tags: ["Tasks"],
  deprecated: true,
  summary: "Delete task (removed; 410)",
  description:
    "Removed. This route used to hard-delete a task and its comments, labels, time entries " +
    "and stored assets with no approval. It now answers 410 Gone (after the same reach and " +
    "permission checks) under the compatibility Deprecation/Sunset headers. Request deletion " +
    "through DELETE /api/work-items/{key}, which records a pending action for approval.",
  middleware: [
    legacyTaskDeletionDeprecationHeaders,
    workspaceAccess.fromTask("id", {
      requireProjectReach: true,
      deferApiKeyCapability: true,
    }),
    requireWorkspacePermission({ work_item: ["delete"] }),
  ] as const,
  request: { params: taskParam },
  responses: {
    400: {
      ...errorResponse("id must not contain a NUL (\\u0000) byte"),
      headers: legacyTaskDeletionResponseHeaders,
    },
    403: {
      ...errorResponse("Missing work_item:delete permission"),
      headers: legacyTaskDeletionResponseHeaders,
    },
    404: {
      ...errorResponse("Task not found"),
      headers: legacyTaskDeletionResponseHeaders,
    },
    410: {
      ...errorResponse(
        "Removed: use DELETE /api/work-items/{key} (pending action)",
      ),
      headers: legacyTaskDeletionResponseHeaders,
    },
  },
});

const updateTaskStatusRoute = createRoute({
  method: "put",
  operationId: "updateTaskStatus",
  path: "/status/{id}",
  tags: ["Tasks"],
  summary: "Update task status",
  description: "Move a task to another column in the same project.",
  middleware: [
    workspaceAccess.fromTask("id", {
      requireProjectReach: true,
      deferApiKeyCapability: true,
    }),
    requireWorkspacePermission({ work_item: ["update"] }),
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateStatusBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse("Missing work_item:update permission"),
    404: errorResponse("Task not found"),
  },
});

const updateTaskPriorityRoute = createRoute({
  method: "put",
  operationId: "updateTaskPriority",
  path: "/priority/{id}",
  tags: ["Tasks"],
  summary: "Update task priority",
  description: "Set a task's priority.",
  middleware: [
    workspaceAccess.fromTask("id", {
      requireProjectReach: true,
      deferApiKeyCapability: true,
    }),
    requireWorkspacePermission({ work_item: ["update"] }),
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updatePriorityBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid priority"),
    403: errorResponse("Missing work_item:update permission"),
    404: errorResponse("Task not found"),
  },
});

const updateTaskAssigneeRoute = createRoute({
  method: "put",
  operationId: "updateTaskAssignee",
  path: "/assignee/{id}",
  tags: ["Tasks"],
  summary: "Update task assignee",
  description:
    "Assign a task to a workspace member, or send null to unassign it.",
  middleware: [
    workspaceAccess.fromTask("id", {
      requireProjectReach: true,
      deferApiKeyCapability: true,
    }),
    requireWorkspacePermission({ work_item: ["assign"] }),
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateAssigneeBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "Missing work_item:assign permission, or the assignee is not a member of this workspace",
    ),
    404: errorResponse("Task not found"),
  },
});

const updateTaskDueDateRoute = createRoute({
  method: "put",
  operationId: "updateTaskDueDate",
  path: "/due-date/{id}",
  tags: ["Tasks"],
  summary: "Update task due date",
  description: "Set or clear a task's due date.",
  middleware: [
    workspaceAccess.fromTask("id", {
      requireProjectReach: true,
      deferApiKeyCapability: true,
    }),
    requireWorkspacePermission({ work_item: ["update"] }),
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateDueDateBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid date"),
    403: errorResponse("Missing work_item:update permission"),
    404: errorResponse("Task not found"),
  },
});

const updateTaskTitleRoute = createRoute({
  method: "put",
  operationId: "updateTaskTitle",
  path: "/title/{id}",
  tags: ["Tasks"],
  summary: "Update task title",
  description: "Rename a task.",
  middleware: [
    workspaceAccess.fromTask("id", {
      requireProjectReach: true,
      deferApiKeyCapability: true,
    }),
    requireWorkspacePermission({ work_item: ["update"] }),
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateTitleBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse("Missing work_item:update permission"),
    404: errorResponse("Task not found"),
  },
});

const createTaskImageUploadRoute = createRoute({
  method: "put",
  operationId: "createTaskImageUpload",
  path: "/image-upload/{id}",
  tags: ["Tasks"],
  summary: "Create image upload URL",
  description:
    "Get a presigned URL for uploading an image used in a task description or comment. PUT the bytes to it, then call the finalize route.",
  middleware: [
    workspaceAccess.fromTask("id", {
      requireProjectReach: true,
      deferApiKeyCapability: true,
    }),
    requireWorkspacePermission({ work_item: ["update"] }),
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: imageUploadBody } },
    },
  },
  responses: {
    200: jsonResponse("The presigned upload", imageUploadSchema),
    400: errorResponse("Unsupported content type, or the file is too large"),
    403: errorResponse("Missing work_item:update permission"),
    404: errorResponse("Task not found"),
    429: errorResponse("Organisation storage limit reached"),
    503: errorResponse("Image uploads are not configured on this instance"),
  },
});

const finalizeTaskImageUploadRoute = createRoute({
  method: "post",
  operationId: "finalizeTaskImageUpload",
  path: "/image-upload/{id}/finalize",
  tags: ["Tasks"],
  summary: "Finalize image upload",
  description:
    "Record an uploaded image as a private asset and return the URL to reference it by.",
  middleware: [
    workspaceAccess.fromTask("id", {
      requireProjectReach: true,
      deferApiKeyCapability: true,
    }),
    requireWorkspacePermission({ work_item: ["update"] }),
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: finalizeImageUploadBody } },
    },
  },
  responses: {
    200: jsonResponse("The stored asset", finalizedAssetSchema),
    400: errorResponse(
      "Invalid upload, or the key does not belong to this task",
    ),
    403: errorResponse("Missing work_item:update permission"),
    404: errorResponse("Task not found"),
    429: errorResponse("Organisation storage limit reached"),
  },
});

const updateTaskDescriptionRoute = createRoute({
  method: "put",
  operationId: "updateTaskDescription",
  path: "/description/{id}",
  tags: ["Tasks"],
  summary: "Update task description",
  description: "Replace a task's description.",
  middleware: [
    workspaceAccess.fromTask("id", {
      requireProjectReach: true,
      deferApiKeyCapability: true,
    }),
    requireWorkspacePermission({ work_item: ["update"] }),
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateDescriptionBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse("Missing work_item:update permission"),
    404: errorResponse("Task not found"),
  },
});

async function requireTaskIdentity(c: Context): Promise<ResolvedIdentity> {
  const userId = c.get("userId");
  if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
  const identity = await resolveCallerIdentity(c, userId);
  if (!identity) throw new HTTPException(404, { message: "Not found" });
  return identity;
}

const task = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listTasksRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const filters = c.req.valid("query") || {};
    const tasks = await getTasks(
      await requireTaskIdentity(c),
      projectId,
      filters,
    );

    return c.json(tasks, 200);
  })
  .openapi(createTaskRoute, async (c) => {
    const { projectId } = c.req.param();
    const { title, description, startDate, dueDate, priority, status, userId } =
      c.req.valid("json");

    const task = await createTask({
      identity: await requireTaskIdentity(c),
      apiKeyId: c.get("apiKey")?.id,
      projectId,
      currentUserId: c.get("userId"),
      userId: userId,
      title,
      description,
      startDate,
      dueDate,
      priority,
      status,
    });

    return c.json(task, 200);
  })
  .openapi(getTaskRoute, async (c) => {
    const { id } = c.req.valid("param");

    const task = await getTask(await requireTaskIdentity(c), id);

    return c.json(task, 200);
  })
  .openapi(moveTaskRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { destinationProjectId, destinationStatus } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const result = await moveTask({
      identity: await requireTaskIdentity(c),
      apiKeyId: c.get("apiKey")?.id,
      taskId: id,
      destinationProjectId,
      destinationStatus,
      currentUserId,
    });

    return c.json(result, 200);
  })
  .openapi(updateTaskRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { "if-match": ifMatch } = c.req.valid("header");
    const {
      title,
      description,
      startDate,
      dueDate,
      priority,
      status,
      projectId,
      position,
      userId,
    } = c.req.valid("json");

    const currentUserId = c.get("userId");

    const result = await runFullTaskUpdate({
      identity: await requireTaskIdentity(c),
      id,
      assertedVersion: ifMatch ? Number(ifMatch.slice(1, -1)) : undefined,
      title,
      status,
      startDate,
      dueDate,
      projectId,
      description,
      priority,
      position,
      userId,
      currentUserId,
      apiKeyId: c.get("apiKey")?.id,
    });
    if ("conflict" in result) return c.json(result.conflict, 409);
    return c.json(result.task, 200);
  })
  .openapi(exportTasksRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const project = await findLiveProject(
      await requireTaskIdentity(c),
      projectId,
    );
    if (!project) {
      throw new HTTPException(404, { message: "Project not found" });
    }
    return c.text(LEGACY_TASK_EXPORT_GONE_MESSAGE, 410);
  })
  .openapi(importTasksRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const identity = await requireTaskIdentity(c);
    await db.transaction(async (tx) => {
      await lockProjectAndAssertLiveForTaskNumberForIdentity(
        tx,
        projectId,
        identity,
        "Project not found",
      );
    });
    return c.text(LEGACY_TASK_IMPORT_GONE_MESSAGE, 410);
  })
  .openapi(deleteTaskRoute, (c) =>
    c.text(LEGACY_TASK_DELETION_GONE_MESSAGE, 410),
  )
  .openapi(updateTaskStatusRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { status } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const task = await updateTaskStatus({
      identity: await requireTaskIdentity(c),
      apiKeyId: c.get("apiKey")?.id,
      id,
      status,
      currentUserId,
    });

    return c.json(task, 200);
  })
  .openapi(updateTaskPriorityRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { priority } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const task = await updateTaskPriority({
      identity: await requireTaskIdentity(c),
      apiKeyId: c.get("apiKey")?.id,
      id,
      priority,
      currentUserId,
    });

    return c.json(task, 200);
  })
  .openapi(updateTaskAssigneeRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { userId } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const task = await updateTaskAssignee({
      identity: await requireTaskIdentity(c),
      apiKeyId: c.get("apiKey")?.id,
      id,
      userId,
      currentUserId,
    });

    return c.json(task, 200);
  })
  .openapi(updateTaskDueDateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { dueDate = null } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const task = await updateTaskDueDate({
      identity: await requireTaskIdentity(c),
      apiKeyId: c.get("apiKey")?.id,
      id,
      dueDate,
      currentUserId,
    });

    return c.json(task, 200);
  })
  .openapi(updateTaskTitleRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { title } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const task = await updateTaskTitle({
      identity: await requireTaskIdentity(c),
      apiKeyId: c.get("apiKey")?.id,
      id,
      title,
      currentUserId,
    });

    return c.json(task, 200);
  })
  .openapi(createTaskImageUploadRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { filename, contentType, size, surface } = c.req.valid("json");
    const identity = await requireTaskIdentity(c);

    try {
      const upload = await db.transaction(async (tx) => {
        const task = await lockTaskAndAssertProjectLiveForIdentity(
          tx,
          id,
          identity,
        );
        try {
          validateTaskAssetUploadInput(contentType, size);
        } catch (error) {
          throw new HTTPException(400, {
            message:
              error instanceof Error
                ? error.message
                : "Invalid image upload request",
          });
        }
        const context = await findProjectWorkspaceContext(
          tx,
          identity,
          task.projectId,
        );
        if (!context)
          throw new HTTPException(404, { message: "Task not found" });
        await assertOrganisationStorageQuota(tx, {
          workspaceId: context.workspaceId,
          additionalBytes: size,
        });
        return createTaskImageUploadUrl({
          workspaceId: context.workspaceId,
          projectId: task.projectId,
          taskId: task.id,
          surface,
          filename,
          contentType,
          size,
          apiBaseUrl: requirePublicAppOrigin(c.get("appPublicOrigin")),
        });
      });

      return c.json(upload, 200);
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      throw new HTTPException(503, {
        message:
          error instanceof Error
            ? error.message
            : "Image uploads are not configured",
      });
    }
  })
  .openapi(finalizeTaskImageUploadRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { key, filename, contentType, size, surface } = c.req.valid("json");
    const userId = c.get("userId");
    const identity = await requireTaskIdentity(c);

    const normalizedKey = key.trim();
    const asset = await db.transaction(async (tx) => {
      const task = await lockTaskAndAssertProjectLiveForIdentity(
        tx,
        id,
        identity,
      );
      try {
        validateTaskAssetUploadInput(contentType, size);
      } catch (error) {
        throw new HTTPException(400, {
          message:
            error instanceof Error
              ? error.message
              : "Invalid image upload request",
        });
      }
      const context = await findProjectWorkspaceContext(
        tx,
        identity,
        task.projectId,
      );
      if (!context) throw new HTTPException(404, { message: "Task not found" });
      if (
        !assertTaskImageKeyMatchesContext(normalizedKey, {
          workspaceId: context.workspaceId,
          projectId: task.projectId,
          taskId: task.id,
          surface,
        })
      ) {
        throw new HTTPException(400, {
          message: "Image upload key does not match the task context.",
        });
      }

      const existingAsset = await findAssetIdByObjectKey(
        tx,
        identity,
        normalizedKey,
        task.id,
      );

      const { contentLength: storedSize } = await getObjectSizeAndHeader(
        normalizedKey,
        0,
      ).catch(() => {
        throw new HTTPException(400, {
          message:
            "Upload not found in storage -- the presigned URL was never used, or the upload never finished.",
        });
      });

      const maxImageBytes = getMaxImageUploadBytes();
      if (
        storedSize === undefined ||
        storedSize <= 0 ||
        storedSize > maxImageBytes
      ) {
        if (!existingAsset) {
          await deleteStorageObject(normalizedKey).catch(() => {});
        }
        throw new HTTPException(400, {
          message:
            storedSize !== undefined && storedSize > maxImageBytes
              ? `Upload exceeds the maximum upload size of ${Math.floor(maxImageBytes / (1024 * 1024))}MB.`
              : "Uploaded object has an invalid size.",
        });
      }

      try {
        await assertOrganisationStorageQuota(tx, {
          workspaceId: context.workspaceId,
          additionalBytes: storedSize,
          excludeAssetId: existingAsset?.id,
        });
      } catch (error) {
        if (!existingAsset) {
          await deleteStorageObject(normalizedKey).catch(() => {});
        }
        throw error;
      }

      const values = {
        workspaceId: context.workspaceId,
        projectId: task.projectId,
        taskId: task.id,
        filename,
        mimeType: contentType,
        size: storedSize,
        kind: isImageContentType(contentType)
          ? ("image" as const)
          : ("attachment" as const),
        surface,
        createdBy: userId || null,
        detachedAt: null,
      };
      const asset = existingAsset
        ? await updateAssetById(tx, identity, existingAsset.id, values)
        : await insertAsset(tx, identity, {
            ...values,
            objectKey: normalizedKey,
          });
      return asset;
    });

    if (!asset) {
      throw new HTTPException(500, {
        message: "Failed to save asset",
      });
    }

    const apiBaseUrl = normalizeApiServerUrl(
      requirePublicAppOrigin(c.get("appPublicOrigin")),
    );
    return c.json(
      {
        id: asset.id,
        url: `${apiBaseUrl}/asset/${asset.id}`,
      },
      200,
    );
  })
  .openapi(updateTaskDescriptionRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { description } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const task = await updateTaskDescription({
      identity: await requireTaskIdentity(c),
      apiKeyId: c.get("apiKey")?.id,
      id,
      description,
      currentUserId,
    });

    return c.json(task, 200);
  });

export const taskV2 = apiRouter<
  BaseVariables & { workspaceId: string }
>().openapi(updateTaskV2Route, async (c) => {
  const { id } = c.req.valid("param");
  const { "if-match": ifMatch } = c.req.valid("header");
  const {
    title,
    description,
    startDate,
    dueDate,
    priority,
    status,
    projectId,
    position,
    userId,
  } = c.req.valid("json");

  const result = await runFullTaskUpdate({
    identity: await requireTaskIdentity(c),
    id,
    assertedVersion: Number(ifMatch.slice(1, -1)),
    title,
    status,
    startDate,
    dueDate,
    projectId,
    description,
    priority,
    position,
    userId,
    currentUserId: c.get("userId"),
    apiKeyId: c.get("apiKey")?.id,
  });
  if ("conflict" in result) return c.json(result.conflict, 409);
  return c.json(result.task, 200);
});

export default task;
