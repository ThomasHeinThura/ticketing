import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { commentIdParam } from "./comment-schema";
import { listCommentVersions } from "./controllers/list-comment-versions";
import { requireWorkItemReach } from "./require-work-item-reach";
import { commentVersionPageResponseSchema } from "./response";
import { listCommentVersionsQuery, workItemKeyParam } from "./schema";

const listWorkItemCommentVersionsRoute = createRoute({
  method: "get",
  operationId: "listWorkItemCommentVersions",
  path: "/work-items/{key}/comments/{id}/versions",
  tags: ["Comments"],
  summary: "List comment edit history",
  description:
    "Returns a bounded cursor page of a live comment's CA-17 versions in ascending " +
    "(number, id) order. The comment must belong to the addressed work item. Uses the " +
    "same work_item:read, project reach, and immutable comment visibility as activity; " +
    "tombstones and unavailable parents return 404. This agent-side route is not exposed " +
    "through the portal router.",
  middleware: [
    requireWorkItemReach("key", { requireProjectReach: true }),
  ] as const,
  request: {
    params: z.object({ ...workItemKeyParam.shape, ...commentIdParam.shape }),
    query: listCommentVersionsQuery,
  },
  responses: {
    200: jsonResponse(
      "A bounded page of comment versions",
      commentVersionPageResponseSchema,
    ),
    400: errorResponse("Invalid comment-version cursor or limit"),
    403: errorResponse(
      "No workspace access, or missing work_item:read permission",
    ),
    404: errorResponse("Work item or comment not found"),
  },
});

const commentVersionRouter = apiRouter<
  BaseVariables & { workspaceId: string; workItemId: string }
>().openapi(listWorkItemCommentVersionsRoute, async (c) => {
  const { key, id } = c.req.valid("param");
  const { cursor, limit } = c.req.valid("query");
  const versions = await listCommentVersions(key, c.get("workItemId"), id, {
    cursor,
    limit,
  });
  return c.json(
    versions as unknown as z.infer<typeof commentVersionPageResponseSchema>,
    200,
  );
});

export default commentVersionRouter;
