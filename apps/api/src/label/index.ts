import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import assignLabelToTask from "./controllers/assign-label-to-task";
import createLabel from "./controllers/create-label";
import deleteLabel from "./controllers/delete-label";
import getLabel from "./controllers/get-label";
import getLabelsByTaskId from "./controllers/get-labels-by-task-id";
import getLabelsByWorkspaceId from "./controllers/get-labels-by-workspace-id";
import unassignLabelFromTask from "./controllers/unassign-label-from-task";
import updateLabel from "./controllers/update-label";
import { labelListSchema, labelSchema } from "./response";
import {
  attachLabelBody,
  createLabelBody,
  labelParam,
  taskIdParam,
  updateLabelBody,
  workspaceIdParam,
} from "./schema";

const getTaskLabelsRoute = createRoute({
  method: "get",
  operationId: "getTaskLabels",
  path: "/task/{taskId}",
  tags: ["Labels"],
  summary: "Get task labels",
  description: "Get all labels assigned to a specific task",
  middleware: [workspaceAccess.fromTaskId()] as const,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse("List of labels for the task", labelListSchema),
    // #290: a task that doesn't exist and a task in a workspace the caller can't
    // reach both answer this same 404 now, via `workspaceAccess.fromTaskId()` -- see
    // `workspace-access-middleware.ts`. Only a NUL byte in `taskId` reaches 400.
    400: errorResponse("taskId must not contain a NUL (\\u0000) byte"),
    404: errorResponse("Task not found"),
  },
});

const getWorkspaceLabelsRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceLabels",
  path: "/workspace/{workspaceId}",
  tags: ["Labels"],
  summary: "Get workspace labels",
  description: "Get all labels for a specific workspace",
  middleware: [workspaceAccess.fromParam()] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("List of labels in the workspace", labelListSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("No access to the workspace"),
  },
});

const createLabelRoute = createRoute({
  method: "post",
  operationId: "createLabel",
  path: "/",
  tags: ["Labels"],
  summary: "Create label",
  description: "Create a new label in a workspace",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspacePermission({ label: ["create"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createLabelBody } },
    },
  },
  responses: {
    200: jsonResponse("Label created successfully", labelSchema),
    400: errorResponse("Invalid body, or workspace ID could not be determined"),
    403: errorResponse(
      "No workspace access, or missing label:create permission",
    ),
    404: errorResponse("Task not found"),
  },
});

const getLabelRoute = createRoute({
  method: "get",
  operationId: "getLabel",
  path: "/{id}",
  tags: ["Labels"],
  summary: "Get label",
  description: "Get a specific label by ID",
  middleware: [workspaceAccess.fromLabel()] as const,
  request: { params: labelParam },
  responses: {
    200: jsonResponse("Label details", labelSchema),
    // #290: a nonexistent label and a label in a workspace the caller can't reach
    // both answer this same 404 now, via `workspaceAccess.fromLabel()`. Only a NUL
    // byte in `id` reaches 400.
    400: errorResponse("id must not contain a NUL (\\u0000) byte"),
    404: errorResponse("Label not found"),
  },
});

const attachLabelToTaskRoute = createRoute({
  method: "put",
  operationId: "attachLabelToTask",
  path: "/{id}/task",
  tags: ["Labels"],
  summary: "Attach label to task",
  description: "Attach an existing label to a task",
  middleware: [
    workspaceAccess.fromLabel(),
    requireWorkspacePermission({ label: ["update"] }),
  ] as const,
  request: {
    params: labelParam,
    body: {
      required: true,
      content: { "application/json": { schema: attachLabelBody } },
    },
  },
  responses: {
    200: jsonResponse("Label attached to task successfully", labelSchema),
    // S2 (Opus review of PR #307, delta round): an out-of-reach OR nonexistent
    // taskId now both 404 `Task not found` -- `assign-label-to-task.ts` scopes its
    // task lookup to the label's own already-reach-checked workspace, so a foreign
    // task simply doesn't match. This 400 remains only for a NUL byte in `taskId`
    // and an internal same-transaction race guard, never a distinguishing signal.
    400: errorResponse("taskId must not contain a NUL (\\u0000) byte"),
    403: errorResponse("Missing label:update permission"),
    404: errorResponse("Label or task not found"),
  },
});

const detachLabelFromTaskRoute = createRoute({
  method: "delete",
  operationId: "detachLabelFromTask",
  path: "/{id}/task",
  tags: ["Labels"],
  summary: "Detach label from task",
  description: "Detach a label from its current task",
  middleware: [
    workspaceAccess.fromLabel(),
    requireWorkspacePermission({ label: ["update"] }),
  ] as const,
  request: { params: labelParam },
  responses: {
    200: jsonResponse("Label detached from task successfully", labelSchema),
    400: errorResponse("Label is not assigned to a task"),
    403: errorResponse("Missing label:update permission"),
    404: errorResponse("Label or task not found"),
  },
});

const updateLabelRoute = createRoute({
  method: "put",
  operationId: "updateLabel",
  path: "/{id}",
  tags: ["Labels"],
  summary: "Update label",
  description: "Update an existing label",
  middleware: [
    workspaceAccess.fromLabel(),
    requireWorkspacePermission({ label: ["update"] }),
  ] as const,
  request: {
    params: labelParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateLabelBody } },
    },
  },
  responses: {
    200: jsonResponse("Label updated successfully", labelSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse("Missing label:update permission"),
    404: errorResponse("Label not found"),
  },
});

const deleteLabelRoute = createRoute({
  method: "delete",
  operationId: "deleteLabel",
  path: "/{id}",
  tags: ["Labels"],
  summary: "Delete label",
  description: "Delete a label by ID",
  middleware: [
    workspaceAccess.fromLabel(),
    requireWorkspacePermission({ label: ["delete"] }),
  ] as const,
  request: { params: labelParam },
  responses: {
    200: jsonResponse("Label deleted successfully", labelSchema),
    400: errorResponse("id must not contain a NUL (\\u0000) byte"),
    403: errorResponse("Missing label:delete permission"),
    404: errorResponse("Label not found, or its task no longer exists"),
  },
});

const label = apiRouter()
  .openapi(getTaskLabelsRoute, async (c) => {
    const { taskId } = c.req.valid("param");
    return c.json(await getLabelsByTaskId(taskId), 200);
  })
  .openapi(getWorkspaceLabelsRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    return c.json(await getLabelsByWorkspaceId(workspaceId), 200);
  })
  .openapi(createLabelRoute, async (c) => {
    const { name, color, workspaceId, taskId } = c.req.valid("json");
    const userId = c.get("userId");
    return c.json(
      await createLabel(name, color, taskId, workspaceId, userId),
      200,
    );
  })
  .openapi(getLabelRoute, async (c) => {
    const { id } = c.req.valid("param");
    return c.json(await getLabel(id), 200);
  })
  .openapi(attachLabelToTaskRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { taskId } = c.req.valid("json");
    const userId = c.get("userId");
    return c.json(await assignLabelToTask(id, taskId, userId), 200);
  })
  .openapi(detachLabelFromTaskRoute, async (c) => {
    const { id } = c.req.valid("param");
    const userId = c.get("userId");
    return c.json(await unassignLabelFromTask(id, userId), 200);
  })
  .openapi(updateLabelRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { name, color } = c.req.valid("json");
    return c.json(await updateLabel(id, name, color), 200);
  })
  .openapi(deleteLabelRoute, async (c) => {
    const { id } = c.req.valid("param");
    const userId = c.get("userId");
    return c.json(await deleteLabel(id, userId), 200);
  });

export default label;
