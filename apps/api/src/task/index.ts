import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  assetTable,
  projectTable,
  taskTable,
  workspaceTable,
} from "../database/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import {
  markShadowLegacyAuthorizationUnknown,
  setShadowLegacyAuthorization,
} from "../permissions/shadow-context";
import {
  assertTaskImageKeyMatchesContext,
  createTaskImageUploadUrl,
  isImageContentType,
  validateTaskAssetUploadInput,
} from "../storage";
import { normalizeApiServerUrl } from "../utils/openapi-spec";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import {
  validateAndParseDate,
  validateDateRange,
} from "../utils/validate-dates";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import bulkUpdateTasks from "./controllers/bulk-update-tasks";
import createTask from "./controllers/create-task";
import deleteTask from "./controllers/delete-task";
import exportTasks from "./controllers/export-tasks";
import getTask from "./controllers/get-task";
import getTasks from "./controllers/get-tasks";
import importTasks from "./controllers/import-tasks";
import moveTask from "./controllers/move-task";
import {
  requireBulkTaskEntitlement,
  requireBulkTaskPermission,
  requireTaskAssigneePermission,
} from "./controllers/require-task-permission";
import updateTask from "./controllers/update-task";
import updateTaskAssignee from "./controllers/update-task-assignee";
import updateTaskDescription from "./controllers/update-task-description";
import updateTaskDueDate from "./controllers/update-task-due-date";
import updateTaskPriority from "./controllers/update-task-priority";
import updateTaskStatus from "./controllers/update-task-status";
import updateTaskTitle from "./controllers/update-task-title";
import {
  boardSchema,
  bulkResultSchema,
  finalizedAssetSchema,
  imageUploadSchema,
  moveTaskResultSchema,
  taskExportSchema,
  taskImportResultSchema,
  taskSchema,
  taskWithAssigneeSchema,
} from "./response";
import {
  bulkUpdateBody,
  createTaskBody,
  finalizeImageUploadBody,
  imageUploadBody,
  importTasksBody,
  listTasksQuery,
  moveTaskBody,
  projectIdParam,
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
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam, query: listTasksQuery },
  responses: {
    200: jsonResponse("The project board", boardSchema),
    // #290: an out-of-reach project now gets this identical 400 too, not the 403
    // `workspaceAccess.fromProject` used to answer for it (#202's own precedent).
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    // #202: a soft-deleted project's board is frozen; a nonexistent or
    // out-of-reach project answers the 400 above instead (`workspaceAccess.
    // fromProject` fails before the handler runs).
    404: errorResponse("Project not found"),
  },
});

const bulkUpdateTasksRoute = createRoute({
  method: "patch",
  operationId: "bulkUpdateTasks",
  path: "/bulk",
  tags: ["Tasks"],
  summary: "Bulk update tasks",
  description:
    "Apply one operation to many tasks at once. Every task must be in the same workspace.",
  middleware: [
    workspaceAccess.fromTasks(),
    requireBulkTaskPermission,
    requireBulkTaskEntitlement,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: bulkUpdateBody } },
    },
  },
  responses: {
    200: jsonResponse("Bulk operation result", bulkResultSchema),
    400: errorResponse(
      "Invalid body, or the tasks span more than one workspace",
    ),
    // S1 (Opus review of PR #307, delta round): restores `main`'s own membership
    // check on the resolved workspace, independent of the instance-admin bypass
    // every other check in this chain has -- an instance admin who isn't a member
    // of the tasks' workspace gets this same 403, not the permission-only one.
    403: errorResponse(
      "Missing the permission the operation needs, or no access to this workspace",
    ),
    // #290: an id set that resolves to no reachable task now answers this same 404
    // whether the ids don't exist at all or exist in a workspace the caller can't
    // reach (`workspaceAccess.fromTasks()`), never a distinguishing 403.
    404: errorResponse("No tasks found"),
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
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["create"] }),
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
    400: errorResponse("Invalid body, or unknown/unreachable project"),
    403: errorResponse("Missing task:create permission"),
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
  middleware: [workspaceAccess.fromTask()] as const,
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
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
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
    403: errorResponse("Missing task:update permission"),
    404: errorResponse("Task or destination project not found"),
  },
});

const updateTaskRoute = createRoute({
  method: "put",
  operationId: "updateTask",
  path: "/{id}",
  tags: ["Tasks"],
  summary: "Update task",
  description:
    "Replace every field of a task. Use the single-field routes for narrower edits.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
    requireTaskAssigneePermission,
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateTaskBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse("Missing task:update or task:assign permission"),
    404: errorResponse("Task not found"),
  },
});

const exportTasksRoute = createRoute({
  method: "get",
  operationId: "exportTasks",
  path: "/export/{projectId}",
  tags: ["Tasks"],
  summary: "Export tasks",
  description:
    "Export a project's tasks, with their labels, as a JSON document.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The exported project and tasks", taskExportSchema),
    // #290: an out-of-reach project now gets this identical 400 too, not the 403
    // `workspaceAccess.fromProject` used to answer for it (#202's own precedent).
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    404: errorResponse("Project not found"),
  },
});

const importTasksRoute = createRoute({
  method: "post",
  operationId: "importTasks",
  path: "/import/{projectId}",
  tags: ["Tasks"],
  summary: "Import tasks",
  description:
    "Import tasks into a project. Each task is reported individually, so a partial import still returns 200.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["create"] }),
  ] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: importTasksBody } },
    },
  },
  responses: {
    200: jsonResponse("Per-task import outcome", taskImportResultSchema),
    400: errorResponse("Invalid body, or unknown/unreachable project"),
    403: errorResponse("Missing task:create permission"),
    404: errorResponse("Project not found"),
  },
});

const deleteTaskRoute = createRoute({
  method: "delete",
  operationId: "deleteTask",
  path: "/{id}",
  tags: ["Tasks"],
  summary: "Delete task",
  description:
    "Permanently delete a task and its comments, labels, and time entries.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["delete"] }),
  ] as const,
  request: { params: taskParam },
  responses: {
    200: jsonResponse("The deleted task", taskSchema),
    400: errorResponse("id must not contain a NUL (\\u0000) byte"),
    403: errorResponse("Missing task:delete permission"),
    404: errorResponse("Task not found"),
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
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
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
    403: errorResponse("Missing task:update permission"),
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
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
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
    403: errorResponse("Missing task:update permission"),
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
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["assign"] }),
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
      "Missing task:assign permission, or the assignee is not a member of this workspace",
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
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
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
    403: errorResponse("Missing task:update permission"),
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
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
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
    403: errorResponse("Missing task:update permission"),
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
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
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
    403: errorResponse("Missing task:update permission"),
    404: errorResponse("Task not found"),
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
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
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
    403: errorResponse("Missing task:update permission"),
    404: errorResponse("Task not found"),
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
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
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
    403: errorResponse("Missing task:update permission"),
    404: errorResponse("Task not found"),
  },
});

const task = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listTasksRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const filters = c.req.valid("query") || {};

    const tasks = await getTasks(projectId, filters);

    return c.json(tasks, 200);
  })
  .openapi(bulkUpdateTasksRoute, async (c) => {
    const { taskIds, operation, value } = c.req.valid("json");
    const userId = c.get("userId");

    if (!userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    if (
      operation !== "delete" &&
      operation !== "updateDueDate" &&
      value === undefined
    ) {
      throw new HTTPException(400, {
        message: "Value is required for this operation",
      });
    }

    markShadowLegacyAuthorizationUnknown(c);
    let result: Awaited<ReturnType<typeof bulkUpdateTasks>>;
    try {
      result = await bulkUpdateTasks({
        taskIds,
        operation,
        value,
        userId,
        workspaceId: c.get("workspaceId"),
      });
    } catch (error) {
      if (error instanceof HTTPException && error.status === 403) {
        setShadowLegacyAuthorization(c, "denied");
      }
      throw error;
    }
    setShadowLegacyAuthorization(c, "allowed");

    return c.json(result, 200);
  })
  .openapi(createTaskRoute, async (c) => {
    const { projectId } = c.req.param();
    const { title, description, startDate, dueDate, priority, status, userId } =
      c.req.valid("json");

    const parsedStartDate =
      startDate !== undefined
        ? validateAndParseDate(startDate, "startDate")
        : undefined;
    const parsedDueDate =
      dueDate !== undefined
        ? validateAndParseDate(dueDate, "dueDate")
        : undefined;

    validateDateRange(parsedStartDate, parsedDueDate);

    const task = await createTask({
      projectId,
      currentUserId: c.get("userId"),
      userId: userId,
      title,
      description,
      startDate: parsedStartDate,
      dueDate: parsedDueDate,
      priority,
      status,
    });

    return c.json(task, 200);
  })
  .openapi(getTaskRoute, async (c) => {
    const { id } = c.req.valid("param");

    const task = await getTask(id);

    return c.json(task, 200);
  })
  .openapi(moveTaskRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { destinationProjectId, destinationStatus } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const result = await moveTask({
      taskId: id,
      destinationProjectId,
      destinationStatus,
      currentUserId,
    });

    return c.json(result, 200);
  })
  .openapi(updateTaskRoute, async (c) => {
    const { id } = c.req.valid("param");
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

    const parsedStartDate =
      startDate !== undefined
        ? validateAndParseDate(startDate, "startDate")
        : undefined;
    const parsedDueDate =
      dueDate !== undefined
        ? validateAndParseDate(dueDate, "dueDate")
        : undefined;

    validateDateRange(parsedStartDate, parsedDueDate);

    const task = await updateTask(
      id,
      title,
      status,
      parsedStartDate,
      parsedDueDate,
      projectId,
      description,
      priority,
      position,
      userId,
      currentUserId,
    );

    return c.json(task, 200);
  })
  .openapi(exportTasksRoute, async (c) => {
    const { projectId } = c.req.valid("param");

    const exportData = await exportTasks(projectId);

    return c.json(exportData, 200);
  })
  .openapi(importTasksRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const { tasks } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const result = await importTasks(projectId, tasks, currentUserId);

    return c.json(result, 200);
  })
  .openapi(deleteTaskRoute, async (c) => {
    const { id } = c.req.valid("param");

    const currentUserId = c.get("userId");
    const task = await deleteTask(id, currentUserId);

    return c.json(task, 200);
  })
  .openapi(updateTaskStatusRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { status } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const task = await updateTaskStatus({ id, status, currentUserId });

    return c.json(task, 200);
  })
  .openapi(updateTaskPriorityRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { priority } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const task = await updateTaskPriority({ id, priority, currentUserId });

    return c.json(task, 200);
  })
  .openapi(updateTaskAssigneeRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { userId } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const task = await updateTaskAssignee({ id, userId, currentUserId });

    return c.json(task, 200);
  })
  .openapi(updateTaskDueDateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { dueDate = null } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const task = await updateTaskDueDate({
      id,
      dueDate: dueDate ? validateAndParseDate(dueDate, "dueDate") : null,
      currentUserId,
    });

    return c.json(task, 200);
  })
  .openapi(updateTaskTitleRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { title } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const task = await updateTaskTitle({ id, title, currentUserId });

    return c.json(task, 200);
  })
  .openapi(createTaskImageUploadRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { filename, contentType, size, surface } = c.req.valid("json");

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

    const [taskContext] = await db
      .select({
        taskId: taskTable.id,
        projectId: taskTable.projectId,
        workspaceId: workspaceTable.id,
      })
      .from(taskTable)
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .innerJoin(
        workspaceTable,
        eq(projectTable.workspaceId, workspaceTable.id),
      )
      .where(
        and(
          eq(taskTable.id, id),
          // #202: a task inside a soft-deleted project is frozen for its project's
          // 30-day recovery window (#187, PR-16), so no upload URL may be minted for
          // it either. `getProjectWorkspaceId`, which the other task routes use, is
          // not reachable here -- this handler needs the project and workspace ids
          // in the same row -- so the exclusion is applied directly.
          isNull(projectTable.deletedAt),
        ),
      )
      .limit(1);

    if (!taskContext) {
      throw new HTTPException(404, { message: "Task not found" });
    }

    try {
      const upload = await createTaskImageUploadUrl({
        workspaceId: taskContext.workspaceId,
        projectId: taskContext.projectId,
        taskId: taskContext.taskId,
        surface,
        filename,
        contentType,
        // Only meaningful to the filesystem driver, whose "presigned URL" is a route on this
        // API process itself rather than a separate storage endpoint — see
        // storage/filesystem.ts, which normalizes this itself (via the same
        // normalizeApiServerUrl used below for the finalize response), so the raw origin is
        // passed here rather than pre-normalizing it. s3.ts ignores this field entirely.
        apiBaseUrl: process.env.KANEO_API_URL || new URL(c.req.url).origin,
      });

      return c.json(upload, 200);
    } catch (error) {
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

    const [taskContext] = await db
      .select({
        taskId: taskTable.id,
        projectId: taskTable.projectId,
        workspaceId: workspaceTable.id,
      })
      .from(taskTable)
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .innerJoin(
        workspaceTable,
        eq(projectTable.workspaceId, workspaceTable.id),
      )
      .where(
        and(
          eq(taskTable.id, id),
          // #202: same exclusion as the create-upload handler above, and for the same
          // reason -- without it, an already-uploaded key could still be finalized
          // into a stored asset belonging to a soft-deleted project's task.
          isNull(projectTable.deletedAt),
        ),
      )
      .limit(1);

    if (!taskContext) {
      throw new HTTPException(404, { message: "Task not found" });
    }

    const normalizedKey = key.trim();
    if (
      !assertTaskImageKeyMatchesContext(normalizedKey, {
        workspaceId: taskContext.workspaceId,
        projectId: taskContext.projectId,
        taskId: taskContext.taskId,
        surface,
      })
    ) {
      throw new HTTPException(400, {
        message: "Image upload key does not match the task context.",
      });
    }

    const [existingAsset] = await db
      .select({ id: assetTable.id })
      .from(assetTable)
      .where(eq(assetTable.objectKey, normalizedKey))
      .limit(1);

    const [asset] = existingAsset
      ? await db
          .update(assetTable)
          .set({
            workspaceId: taskContext.workspaceId,
            projectId: taskContext.projectId,
            taskId: taskContext.taskId,
            filename,
            mimeType: contentType,
            size,
            kind: isImageContentType(contentType) ? "image" : "attachment",
            surface,
            createdBy: userId || null,
          })
          .where(eq(assetTable.id, existingAsset.id))
          .returning({
            id: assetTable.id,
          })
      : await db
          .insert(assetTable)
          .values({
            workspaceId: taskContext.workspaceId,
            projectId: taskContext.projectId,
            taskId: taskContext.taskId,
            objectKey: normalizedKey,
            filename,
            mimeType: contentType,
            size,
            kind: isImageContentType(contentType) ? "image" : "attachment",
            surface,
            createdBy: userId || null,
          })
          .returning({
            id: assetTable.id,
          });

    if (!asset) {
      throw new HTTPException(500, {
        message: "Failed to save asset",
      });
    }

    const apiBaseUrl = normalizeApiServerUrl(
      process.env.KANEO_API_URL || new URL(c.req.url).origin,
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
      id,
      description,
      currentUserId,
    });

    return c.json(task, 200);
  });

export default task;
