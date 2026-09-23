import { eq } from "drizzle-orm";
import db from "../database";
import { externalLinkTable } from "../database/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { externalLinkListSchema } from "./response";
import { taskIdParam } from "./schema";

const getExternalLinksByTaskRoute = createRoute({
  method: "get",
  operationId: "getExternalLinksByTask",
  path: "/task/{taskId}",
  tags: ["External Links"],
  summary: "Get task external links",
  description:
    "Get all links from a task to resources in connected integrations, such as GitHub or Gitea issues.",
  middleware: [workspaceAccess.fromTaskId("taskId")] as const,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse("External links for the task", externalLinkListSchema),
    // #290: a task that doesn't exist and a task in a workspace the caller can't
    // reach both answer this same 404 now, via `workspaceAccess.fromTaskId()`.
    400: errorResponse("taskId must not contain a NUL (\\u0000) byte"),
    404: errorResponse("Task not found"),
  },
});

const externalLink = apiRouter<
  BaseVariables & { workspaceId: string }
>().openapi(getExternalLinksByTaskRoute, async (c) => {
  const { taskId } = c.req.valid("param");

  const links = await db.query.externalLinkTable.findMany({
    where: eq(externalLinkTable.taskId, taskId),
  });

  return c.json(
    links.map((link) => ({
      ...link,
      metadata: link.metadata ? JSON.parse(link.metadata) : null,
    })),
    200,
  );
});

export default externalLink;
