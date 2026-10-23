import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { resolveCallerIdentity } from "../utils/has-project-reach";
import {
  listReachOf,
  requireReachFilteredList,
} from "../utils/reach-filtered-list";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { resolveWorkItemSearchAccess } from "../work-item/search/repository";
import globalSearch from "./controllers/global-search";
import { searchResponseSchema } from "./response";
import { searchQuery } from "./schema";

const globalSearchRoute = createRoute({
  method: "get",
  operationId: "globalSearch",
  path: "/",
  tags: ["Search"],
  summary: "Global search",
  description:
    "Search across work items, people, saved views, projects, workspaces, comments, and activities in one workspace (legacy tasks stay available under `type=tasks`). Results are ranked by relevance and returned as a single flat list, each entry tagged with its `type`.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspaceCapability("workspace:read"),
    requireReachFilteredList,
  ] as const,
  request: { query: searchQuery },
  responses: {
    200: jsonResponse("Ranked search results", searchResponseSchema),
    400: errorResponse(
      "Invalid query, or workspace ID could not be determined",
    ),
    403: errorResponse("No access to the workspace"),
  },
});

const search = apiRouter().openapi(globalSearchRoute, async (c) => {
  const { q, type, workspaceId, projectId, limit } = c.req.valid("query");
  const identity = await resolveCallerIdentity(c, c.get("userId"));
  const session = c.get("session") as
    | { impersonatedBy?: string | null }
    | null
    | undefined;
  if (!identity)
    return c.json({ results: [], totalCount: 0, searchQuery: q }, 200);

  return c.json(
    await globalSearch({
      query: q,
      identity,
      type,
      workspaceId,
      projectId,
      limit,
      workItemAccess: async (searchWorkspaceId) => {
        try {
          const access = await resolveWorkItemSearchAccess({
            userId: c.get("userId"),
            apiKey: c.get("apiKey"),
            impersonatedBy: session?.impersonatedBy,
            workspaceId: searchWorkspaceId,
            query: { entity: "work_item" },
          });
          return { personId: access.personId, projectIds: access.projectIds };
        } catch (error) {
          // No person row / no work_item:read: a search just has nothing canonical to show.
          if (error instanceof HTTPException && error.status === 403)
            return null;
          throw error;
        }
      },
      reachableProjectIds: (workspaceIds) =>
        listReachOf(c).reachableProjectIds(workspaceIds),
    }),
    200,
  );
});

export default search;
