import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import {
  listReachOf,
  requireReachFilteredList,
} from "../utils/reach-filtered-list";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { adaptCombinedWorkItemListQuery } from "./combined-list-query";
import {
  type CombinedWorkItemListResponse,
  combinedWorkItemListResponseSchema,
} from "./combined-response";
import { listCombinedWorkItems } from "./controllers/list-combined-work-items";
import { listWorkItemsQuery, projectIdParam } from "./schema";
import { searchBodyLimit, validateWorkItemSearchQuery } from "./search/query";
import { workItemSearchRequestSchema } from "./search/request-schema";

const combinedBoardMiddleware = [
  workspaceAccess.fromProject("projectId", { requireProjectReach: true }),
  requireReachFilteredList,
] as const;
const listCombinedWorkItemsRoute = createRoute({
  method: "get",
  operationId: "listCombinedProjectWorkItems",
  path: "/projects/{projectId}/work-items/combined",
  tags: ["Work items"],
  summary: "List visible work in a project and its live descendants",
  middleware: [...combinedBoardMiddleware],
  request: { params: projectIdParam, query: listWorkItemsQuery },
  responses: {
    200: jsonResponse(
      "Combined project board",
      combinedWorkItemListResponseSchema,
    ),
    400: errorResponse("Invalid filters or cursor"),
    403: errorResponse("Missing work_item:read permission"),
    404: errorResponse("Project not found or unreachable"),
    422: errorResponse("Unavailable filter field"),
  },
});
const searchCombinedWorkItemsRoute = createRoute({
  method: "post",
  operationId: "searchCombinedProjectWorkItems",
  path: "/projects/{projectId}/work-items/combined",
  tags: ["Work items"],
  summary: "Filter visible work in a project and its live descendants",
  middleware: [searchBodyLimit(), ...combinedBoardMiddleware] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: workItemSearchRequestSchema.omit({ workspaceId: true }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Combined filtered project board",
      combinedWorkItemListResponseSchema,
    ),
    400: errorResponse("Invalid search document or cursor"),
    403: errorResponse("Missing work_item:read permission"),
    404: errorResponse("Project not found or unreachable"),
    422: errorResponse("Unavailable filter field"),
  },
});

export const combinedWorkItemRouter = apiRouter<
  BaseVariables & { workspaceId: string }
>()
  .openapi(listCombinedWorkItemsRoute, async (c) => {
    const request = c.req.valid("query");
    const adapted = adaptCombinedWorkItemListQuery(request);
    const workspaceId = c.get("workspaceId");
    const result: CombinedWorkItemListResponse = await listCombinedWorkItems({
      projectId: c.req.valid("param").projectId,
      workspaceId,
      userId: c.get("userId"),
      reachableProjectIds: await listReachOf(c).reachableProjectIds([
        workspaceId,
      ]),
      ...adapted,
      limit: request.limit ?? 50,
      cursor: request.cursor,
      apiKey: c.get("apiKey"),
      impersonatedBy: (c.get("session") as { impersonatedBy?: string } | null)
        ?.impersonatedBy,
    });
    return c.json(result, 200);
  })
  .openapi(searchCombinedWorkItemsRoute, async (c) => {
    const body = c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    const result: CombinedWorkItemListResponse = await listCombinedWorkItems({
      projectId: c.req.valid("param").projectId,
      workspaceId,
      userId: c.get("userId"),
      reachableProjectIds: await listReachOf(c).reachableProjectIds([
        workspaceId,
      ]),
      query: validateWorkItemSearchQuery(body.query),
      limit: body.limit ?? 50,
      cursor: body.cursor ?? undefined,
      apiKey: c.get("apiKey"),
      impersonatedBy: (c.get("session") as { impersonatedBy?: string } | null)
        ?.impersonatedBy,
    });
    return c.json(result, 200);
  });
