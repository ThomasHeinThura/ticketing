import type { ResolvedIdentity } from "@taskdesk/permissions";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { BaseVariables } from "../openapi";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { resolveRequestIdentity } from "../permissions/resolve-request-identity";
import {
  capabilityCredential,
  requireWorkspaceCapability,
} from "../utils/require-workspace-capability";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  legacyEntryOwner,
  mutationIdentity,
  requireLegacyEntryCapability,
  requireLegacyTimeTracking,
  requireMutationIdentity,
} from "./authorization";
import createTimeEntry from "./controllers/create-time-entry";
import getTimeEntriesByTaskId from "./controllers/get-time-entries";
import getTimeEntry from "./controllers/get-time-entry";
import updateTimeEntry from "./controllers/update-time-entry";
import { timeEntryListSchema, timeEntrySchema } from "./response";
import {
  createTimeEntryBody,
  taskIdParam,
  timeEntryParam,
  updateTimeEntryBody,
} from "./schema";

async function requestIdentity(
  c: Context<{ Variables: BaseVariables }>,
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

const getTaskTimeEntriesRoute = createRoute({
  method: "get",
  operationId: "getTaskTimeEntries",
  path: "/task/{taskId}",
  tags: ["Time Entries"],
  summary: "Get task time entries",
  description: "Get every time entry logged against a task.",
  middleware: [
    workspaceAccess.fromTaskId("taskId", {
      requireProjectReach: true,
      deferCapability: true,
    }),
    requireWorkspaceCapability("time_entry:read_any"),
  ] as const,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse("List of time entries for the task", timeEntryListSchema),
    // #290: a task that doesn't exist and a task in a workspace the caller can't
    // reach both answer this same 404 now, via `workspaceAccess.fromTaskId()`.
    400: errorResponse("taskId must not contain a NUL (\\u0000) byte"),
    404: errorResponse("Task not found"),
  },
});

const getTimeEntryRoute = createRoute({
  method: "get",
  operationId: "getTimeEntry",
  path: "/{id}",
  tags: ["Time Entries"],
  summary: "Get time entry",
  description: "Get a single time entry by ID.",
  middleware: [
    workspaceAccess.fromTimeEntry("id", {
      requireProjectReach: true,
      deferCapability: true,
    }),
    requireWorkspaceCapability("time_entry:read_any"),
  ] as const,
  request: { params: timeEntryParam },
  responses: {
    200: jsonResponse("Time entry details", timeEntrySchema),
    // #290: a nonexistent entry and an entry in a workspace the caller can't reach
    // both answer this same 404 now, via `workspaceAccess.fromTimeEntry()`.
    400: errorResponse("id must not contain a NUL (\\u0000) byte"),
    404: errorResponse("Time entry not found"),
  },
});

const createTimeEntryRoute = createRoute({
  method: "post",
  operationId: "createTimeEntry",
  path: "/",
  tags: ["Time Entries"],
  summary: "Create time entry",
  description:
    "Log time against a task. Omit endTime to start a running entry that can be closed later with an update.",
  middleware: [
    workspaceAccess.fromTaskId("taskId", {
      requireProjectReach: true,
      deferCapability: true,
      requireLiveProjectForTask: true,
    }),
    requireMutationIdentity,
    requireWorkspaceCapability("time_entry:create"),
    requireLegacyTimeTracking,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createTimeEntryBody } },
    },
  },
  responses: {
    200: jsonResponse("The created time entry", timeEntrySchema),
    // #290: an unknown/out-of-reach task 404s via `workspaceAccess.fromTaskId()`
    // (below), before this route's own body validation runs.
    400: errorResponse("Invalid timestamps"),
    403: errorResponse("Missing time_entry:create permission"),
    404: errorResponse("Task not found"),
    409: errorResponse("feature.time_tracking is off"),
  },
});

const updateTimeEntryRoute = createRoute({
  method: "put",
  operationId: "updateTimeEntry",
  path: "/{id}",
  tags: ["Time Entries"],
  summary: "Update time entry",
  description:
    "Replace a time entry's start, end, and description. Setting endTime closes a running entry and fills in its duration.",
  middleware: [
    workspaceAccess.fromTimeEntry("id", {
      requireProjectReach: true,
      deferCapability: true,
      requireLiveProjectForTask: true,
    }),
    requireMutationIdentity,
    legacyEntryOwner,
    requireLegacyEntryCapability,
    requireLegacyTimeTracking,
  ] as const,
  request: {
    params: timeEntryParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateTimeEntryBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated time entry", timeEntrySchema),
    400: errorResponse("Invalid timestamps"),
    403: errorResponse(
      "Missing time_entry:update_own or update_any permission",
    ),
    404: errorResponse("Time entry not found"),
    409: errorResponse("feature.time_tracking is off"),
  },
});

const timeEntry = apiRouter()
  .openapi(getTaskTimeEntriesRoute, async (c) =>
    c.json(
      await getTimeEntriesByTaskId(
        await requestIdentity(c),
        c.req.valid("param").taskId,
      ),
      200,
    ),
  )
  .openapi(getTimeEntryRoute, async (c) =>
    c.json(
      await getTimeEntry(await requestIdentity(c), c.req.valid("param").id),
      200,
    ),
  )
  .openapi(createTimeEntryRoute, async (c) => {
    const { taskId, startTime, endTime, description } = c.req.valid("json");
    return c.json(
      await createTimeEntry({
        taskId,
        identity: await mutationIdentity(c),
        credential: capabilityCredential(c.get("apiKey")),
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : undefined,
        description,
        apiKeyId: c.get("apiKey")?.id,
      }),
      200,
    );
  })
  .openapi(updateTimeEntryRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { startTime, endTime, description } = c.req.valid("json");
    return c.json(
      await updateTimeEntry({
        identity: await mutationIdentity(c),
        credential: capabilityCredential(c.get("apiKey")),
        timeEntryId: id,
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : undefined,
        description,
      }),
      200,
    );
  });

export default timeEntry;
