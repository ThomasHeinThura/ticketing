import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../../openapi";
import { requireReachFilteredList } from "../../utils/reach-filtered-list";
import { requireWorkspaceCapability } from "../../utils/require-workspace-capability";
import { workspaceAccess } from "../../utils/workspace-access-middleware";
import { resolveCallerPersonId } from "../../view/resolve-person-id";
import { workItemListResponseSchema } from "../../work-item/response";
import { staffQueueRowSchema } from "../response";
import {
  queueListQuery,
  queuePairBody,
  queuePairIdParam,
  queuePairPatchBody,
  queueRunQuery,
  queueWorkspaceQuery,
} from "./schema";
import {
  createIntakeQueue,
  getIntakeQueue,
  listIntakeQueues,
  runIntakeQueue,
  updateIntakeQueue,
} from "./service";

const queueSummarySchema = z.object({
  id: z.string().min(1).max(128),
  workspaceId: z.string(),
  name: z.string(),
  visibility: z.enum(["private", "team"]),
  sharedWithTeamId: z.string().nullable(),
  versions: z.object({
    submission: z.number().int().safe().min(1),
    workItem: z.number().int().safe().min(1),
  }),
});
const queuePairResponseSchema = queueSummarySchema.extend({
  createdBy: z.string(),
  submissionView: z.object({
    id: z.string(),
    query: z.unknown(),
    updatedAt: z.string().datetime(),
  }),
  workItemView: z.object({
    id: z.string(),
    query: z.unknown(),
    updatedAt: z.string().datetime(),
  }),
});
const submissionRunResultSchema = z.object({
  submissions: z.array(staffQueueRowSchema),
  page: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  meta: z.object({ total: z.number() }),
});
type QueueRunResponse = {
  queue: {
    id: string;
    name: string;
    visibility: "private" | "team";
    versions: { submission: number; workItem: number };
  };
  submissions: z.infer<typeof submissionRunResultSchema>;
  workItems: z.infer<typeof workItemListResponseSchema>;
};
const queueRunResponseSchema: z.ZodType<QueueRunResponse> = z.object({
  queue: z.object({
    id: z.string(),
    name: z.string(),
    visibility: z.enum(["private", "team"]),
    versions: z.object({
      submission: z.number().int().safe().min(1),
      workItem: z.number().int().safe().min(1),
    }),
  }),
  submissions: submissionRunResultSchema,
  workItems: workItemListResponseSchema,
});

const listQueuesRoute = createRoute({
  method: "get",
  operationId: "listIntakeQueues",
  path: "/queues",
  tags: ["Intake"],
  summary: "List reachable saved intake queues",
  description:
    "Lists two-view saved queues visible to the current triager: private queues they own and team queues for teams they belong to.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspaceCapability("intake:triage"),
    requireReachFilteredList,
  ] as const,
  request: { query: queueListQuery },
  responses: {
    200: jsonResponse(
      "Reachable saved intake queues",
      z.array(queueSummarySchema),
    ),
    400: errorResponse("workspaceId is required"),
    403: errorResponse("Missing intake:triage permission"),
  },
});

const createQueueRoute = createRoute({
  method: "post",
  operationId: "createIntakeQueue",
  path: "/queues",
  tags: ["Intake"],
  summary: "Create a paired saved intake queue",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspaceCapability("intake:triage"),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: queuePairBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "Created paired saved intake queue",
      queuePairResponseSchema,
    ),
    400: errorResponse("Invalid intake queue definition"),
    403: errorResponse(
      "Missing intake:triage or required team-share permission",
    ),
    422: errorResponse("Unsupported submission or work-item filter"),
  },
});

const getQueueRoute = createRoute({
  method: "get",
  operationId: "getIntakeQueue",
  path: "/queues/{id}",
  tags: ["Intake"],
  summary: "Get a saved intake queue",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspaceCapability("intake:triage"),
    requireReachFilteredList,
  ] as const,
  request: { params: queuePairIdParam, query: queueWorkspaceQuery },
  responses: {
    200: jsonResponse("Saved intake queue pair", queuePairResponseSchema),
    400: errorResponse("Invalid queue id or workspaceId"),
    403: errorResponse("Missing intake:triage permission"),
    404: errorResponse("Intake queue not found"),
  },
});

const updateQueueRoute = createRoute({
  method: "patch",
  operationId: "updateIntakeQueue",
  path: "/queues/{id}",
  tags: ["Intake"],
  summary: "Update both saved views in an intake queue",
  description:
    "Updates both queue views atomically and requires the current version of each view.",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspaceCapability("intake:triage"),
  ] as const,
  request: {
    params: queuePairIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: queuePairPatchBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "Updated saved intake queue pair",
      queuePairResponseSchema,
    ),
    400: errorResponse("Invalid intake queue update"),
    403: errorResponse("Missing queue-edit or team-share permission"),
    404: errorResponse("Intake queue not found"),
    409: errorResponse("Queue version conflict; reload before saving"),
    422: errorResponse("Queue entities cannot be changed"),
  },
});

const runQueueRoute = createRoute({
  method: "get",
  operationId: "runIntakeQueue",
  path: "/queues/{id}/run",
  tags: ["Intake"],
  summary: "Run both saved views in an intake queue",
  description:
    "Runs the submission and work-item saved views independently with current triage, reach, and field permissions.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspaceCapability("intake:triage"),
    requireReachFilteredList,
  ] as const,
  request: { params: queuePairIdParam, query: queueRunQuery },
  responses: {
    200: jsonResponse(
      "Submission and work-item queue pages",
      queueRunResponseSchema,
    ),
    400: errorResponse("Invalid queue run query"),
    403: errorResponse("Missing intake:triage permission"),
    404: errorResponse("Intake queue not found or intake disabled"),
    422: errorResponse("Unsupported saved-view or URL filter"),
  },
});

export const intakeQueueReadRouter = apiRouter()
  .openapi(listQueuesRoute, async (c) => {
    const { workspaceId } = c.req.valid("query");
    const personId = await resolveCallerPersonId(c.get("userId"));
    return c.json(
      await listIntakeQueues({
        workspaceId,
        personId,
        userId: c.get("userId"),
      }),
      200,
    );
  })
  .openapi(getQueueRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { workspaceId } = c.req.valid("query");
    const userId = c.get("userId");
    const personId = await resolveCallerPersonId(userId);
    return c.json(
      await getIntakeQueue({ workspaceId, id, personId, userId }),
      200,
    );
  });

export const intakeQueueRunRouter = apiRouter().openapi(
  runQueueRoute,
  async (c) => {
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");
    const userId = c.get("userId");
    const personId = await resolveCallerPersonId(userId);
    const session = c.get("session") as {
      impersonatedBy?: string | null;
    } | null;
    const apiKey = c.get("apiKey");
    const result: QueueRunResponse = await runIntakeQueue({
      id,
      workspaceId: query.workspaceId,
      personId,
      userId,
      apiKey,
      impersonatedBy: session?.impersonatedBy,
      limit: query.limit,
      submissionCursor: query.submissionCursor,
      workItemCursor: query.workItemCursor,
      overrides: {
        ...(query.state ? { state: query.state } : {}),
        ...(query.requestTypeKey
          ? { requestTypeKey: query.requestTypeKey }
          : {}),
        ...(query.assignee ? { assignee: query.assignee } : {}),
        ...(query.olderThanDays === undefined
          ? {}
          : { olderThanDays: query.olderThanDays }),
      },
      workItemFilter: query.workItemFilter,
      workItemSorts: query.workItemSorts,
      workItemColumns: query.workItemColumns,
    });
    return c.json(result, 200);
  },
);

export const intakeQueueWriteRouter = apiRouter()
  .openapi(createQueueRoute, async (c) => {
    const body = c.req.valid("json");
    const userId = c.get("userId");
    const personId = await resolveCallerPersonId(userId);
    const apiKey = c.get("apiKey");
    return c.json(
      await createIntakeQueue(body, {
        personId,
        userId,
        apiKey,
        auditActor: {
          actorId: userId,
          actorType: apiKey ? "api_key" : "person",
          apiKeyId: apiKey?.id ?? null,
        },
      }),
      200,
    );
  })
  .openapi(updateQueueRoute, async (c) => {
    const { id } = c.req.valid("param");
    const patch = c.req.valid("json");
    const userId = c.get("userId");
    const personId = await resolveCallerPersonId(userId);
    const apiKey = c.get("apiKey");
    return c.json(
      await updateIntakeQueue({
        id,
        workspaceId: patch.workspaceId,
        patch,
        actor: {
          personId,
          userId,
          apiKey,
          auditActor: {
            actorId: userId,
            actorType: apiKey ? "api_key" : "person",
            apiKeyId: apiKey?.id ?? null,
          },
        },
      }),
      200,
    );
  });
