import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import {
  listReachOf,
  requireReachFilteredList,
} from "../utils/reach-filtered-list";
import {
  assertCallerHasCapability,
  capabilityCredential,
  requireWorkspaceCapability,
} from "../utils/require-workspace-capability";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { resolveWorkItemSearchAccessForIdentity } from "../work-item/search/repository";
import globalSearch from "./controllers/global-search";
import { searchResponseSchema } from "./response";
import { searchQuery } from "./schema";

export const stopAbortedSearch: MiddlewareHandler = async (c, next) => {
  if (c.req.raw.signal.aborted) {
    return c.json({ results: [], totalCount: 0, searchQuery: "" }, 200);
  }
  return next();
};

const globalSearchRoute = createRoute({
  method: "get",
  operationId: "globalSearch",
  path: "/",
  tags: ["Search"],
  summary: "Global search",
  description:
    "Search across work items, people, saved views, knowledge base articles, projects, workspaces, comments, and activities in one workspace (legacy tasks stay available under `type=tasks`). Results are ranked by relevance and returned as a single flat list, each entry tagged with its `type`.",
  middleware: [
    stopAbortedSearch,
    workspaceAccess.fromQuery(),
    stopAbortedSearch,
    requireWorkspaceCapability("workspace:read"),
    stopAbortedSearch,
    requireReachFilteredList,
    stopAbortedSearch,
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
  const reach = listReachOf(c);
  const identity = reach.identity;
  if (!identity)
    return c.json({ results: [], totalCount: 0, searchQuery: q }, 200);

  return c.json(
    await globalSearch({
      query: q,
      identity,
      signal: c.req.raw.signal,
      type,
      workspaceId,
      projectId,
      limit,
      workItemAccess: async (searchWorkspaceId) => {
        try {
          const access = await resolveWorkItemSearchAccessForIdentity({
            userId: c.get("userId"),
            identity,
            workspaceId: searchWorkspaceId,
            query: { entity: "work_item" },
            projectFacts: await reach.projectFactsFor([searchWorkspaceId]),
          });
          return { personId: access.personId, projectIds: access.projectIds };
        } catch (error) {
          // No person row / no work_item:read: a search just has nothing canonical to show.
          if (error instanceof HTTPException && error.status === 403)
            return null;
          throw error;
        }
      },
      kbArticleAccess: async (searchWorkspaceId) => {
        try {
          await assertCallerHasCapability(
            searchWorkspaceId,
            c.get("userId"),
            "kb_article:read",
            capabilityCredential(c.get("apiKey")),
          );
          return true;
        } catch (error) {
          if (error instanceof HTTPException && error.status === 403)
            return false;
          throw error;
        }
      },
      reachableProjectIds: (workspaceIds) =>
        reach.reachableProjectIds(workspaceIds),
    }),
    200,
  );
});

export default search;
