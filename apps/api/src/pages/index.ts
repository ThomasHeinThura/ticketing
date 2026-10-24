import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  type z,
} from "../openapi";
import {
  registeredDeletionRequestSchema,
  requestRegisteredDeletion,
} from "../pending-action/deletion-targets";
import { authorisePages, pagesProjectReach } from "./access";
import { PAGE_DELETION_ROUTE } from "./deletion-target";
import { snippetOf } from "./logic";
import {
  createPage,
  findPage,
  getVersion,
  listPages,
  listVersions,
  PageConflictError,
  type PageRow,
  personFor,
  restoreVersion,
  undeletePage,
  updatePage,
} from "./repository";
import {
  pageConflictSchema,
  pageListSchema,
  pageSchema,
  pageVersionListSchema,
  pageVersionSchema,
} from "./response";
import {
  createPageBody,
  pageParam,
  projectParam,
  restorePageBody,
  updatePageBody,
  versionParam,
} from "./schema";

/**
 * Project pages routes, mounted at `/` of the API router like agile (the paths hang off
 * `/projects/{projectId}`).
 */
type Vars = BaseVariables & { workspaceId: string; projectId: string };

const NOT_FOUND = "Not found";
const notFound = () => new HTTPException(404, { message: NOT_FOUND });

async function toPage(row: PageRow, canEdit: boolean) {
  const [updatedBy, createdBy] = await Promise.all([
    personFor(row.updatedBy),
    personFor(row.createdBy),
  ]);
  const { body, bodyText, ...rest } = row;
  return pageSchema.parse({
    id: rest.id,
    projectId: rest.projectId,
    parentId: rest.parentId,
    title: rest.title,
    snippet: snippetOf(bodyText),
    version: rest.version,
    updatedBy,
    createdBy,
    createdAt: rest.createdAt,
    updatedAt: rest.updatedAt,
    body,
    canEdit,
  });
}

async function conflictResponse(error: PageConflictError) {
  return pageConflictSchema.parse({
    message: "page_version_conflict",
    currentVersion: error.current.version,
    currentTitle: error.current.title,
    updatedAt: error.current.updatedAt,
    updatedBy: await personFor(error.current.updatedBy),
  });
}

const UNDELETE_MESSAGES = {
  not_deleted: "The page is not deleted",
  window_expired: "The 30 day restore window for this page has passed",
  parent_deleted: "Restore the parent page first",
} as const;

const tags = ["Pages"];
const staffOnly = errorResponse(
  "Not found: no such project or page, no reach to the project, or a customer session",
);

const listRoute = createRoute({
  method: "get",
  path: "/projects/{projectId}/pages",
  operationId: "listProjectPages",
  tags,
  summary: "List a project's live pages (tree via parentId)",
  middleware: [pagesProjectReach] as const,
  request: { params: projectParam },
  responses: {
    200: jsonResponse("Pages without bodies", pageListSchema),
    403: errorResponse("Missing project:read permission"),
    404: staffOnly,
  },
});
const createRouteDef = createRoute({
  method: "post",
  path: "/projects/{projectId}/pages",
  operationId: "createProjectPage",
  tags,
  summary: "Create a page",
  middleware: [pagesProjectReach] as const,
  request: {
    params: projectParam,
    body: {
      required: true,
      content: { "application/json": { schema: createPageBody } },
    },
  },
  responses: {
    201: jsonResponse("The page", pageSchema),
    403: errorResponse("Missing project:update permission"),
    404: staffOnly,
    422: errorResponse("Invalid body, or the parent is not allowed"),
  },
});
const getRoute = createRoute({
  method: "get",
  path: "/projects/{projectId}/pages/{id}",
  operationId: "getProjectPage",
  tags,
  summary: "Read a page",
  middleware: [pagesProjectReach] as const,
  request: { params: pageParam },
  responses: {
    200: jsonResponse("The page with its body", pageSchema),
    403: errorResponse("Missing project:read permission"),
    404: staffOnly,
  },
});
const updateRoute = createRoute({
  method: "patch",
  path: "/projects/{projectId}/pages/{id}",
  operationId: "updateProjectPage",
  tags,
  summary: "Save a page (expected version required)",
  description:
    "Every successful save writes an immutable version. A stale expectedVersion is a 409 naming the current version; nothing is written.",
  middleware: [pagesProjectReach] as const,
  request: {
    params: pageParam,
    body: {
      required: true,
      content: { "application/json": { schema: updatePageBody } },
    },
  },
  responses: {
    200: jsonResponse("The saved page", pageSchema),
    403: errorResponse("Missing project:update permission"),
    404: staffOnly,
    409: jsonResponse("Stale save", pageConflictSchema),
    422: errorResponse("Invalid body, or the parent is not allowed"),
  },
});
const versionsRoute = createRoute({
  method: "get",
  path: "/projects/{projectId}/pages/{id}/versions",
  operationId: "listProjectPageVersions",
  tags,
  summary: "A page's version history, newest first",
  middleware: [pagesProjectReach] as const,
  request: { params: pageParam },
  responses: {
    200: jsonResponse("Versions without bodies", pageVersionListSchema),
    403: errorResponse("Missing project:read permission"),
    404: staffOnly,
  },
});
const versionRoute = createRoute({
  method: "get",
  path: "/projects/{projectId}/pages/{id}/versions/{number}",
  operationId: "getProjectPageVersion",
  tags,
  summary: "One version of a page, with its body",
  middleware: [pagesProjectReach] as const,
  request: { params: versionParam },
  responses: {
    200: jsonResponse("The version", pageVersionSchema),
    403: errorResponse("Missing project:read permission"),
    404: staffOnly,
  },
});
const restoreRoute = createRoute({
  method: "post",
  path: "/projects/{projectId}/pages/{id}/restore",
  operationId: "restoreProjectPage",
  tags,
  summary: "Restore an earlier version as a new version",
  middleware: [pagesProjectReach] as const,
  request: {
    params: pageParam,
    body: {
      required: true,
      content: { "application/json": { schema: restorePageBody } },
    },
  },
  responses: {
    200: jsonResponse("The page after restore", pageSchema),
    403: errorResponse("Missing project:update permission"),
    404: staffOnly,
    409: jsonResponse("Stale save", pageConflictSchema),
  },
});
const undeleteRoute = createRoute({
  method: "post",
  path: "/projects/{projectId}/pages/{id}/undelete",
  operationId: "undeleteProjectPage",
  tags,
  summary: "Restore a deleted page inside its 30 day window",
  description:
    "Un-deletes the page with its versions and parent. 409 once the window has passed, when the page is not deleted, or while its parent page is still deleted (restore the parent first).",
  middleware: [pagesProjectReach] as const,
  request: { params: pageParam },
  responses: {
    200: jsonResponse("The restored page", pageSchema),
    403: errorResponse("Missing project:update permission"),
    404: staffOnly,
    409: errorResponse(
      "Not deleted, the restore window has passed, or the parent page is deleted",
    ),
  },
});
const deleteRoute = createRoute({
  method: "delete",
  path: "/projects/{projectId}/pages/{id}",
  operationId: "deleteProjectPage",
  tags,
  summary: "Request deletion of a page",
  description:
    "Returns a durable pending action (202); the page stays until the requester approves. A page with sub-pages is refused (409).",
  middleware: [pagesProjectReach] as const,
  request: { params: pageParam },
  responses: {
    202: jsonResponse("Pending deletion", registeredDeletionRequestSchema),
    403: errorResponse("Missing project:update permission"),
    404: staffOnly,
    409: errorResponse("The page still has sub-pages"),
  },
});

const router = apiRouter<Vars>()
  .openapi(listRoute, async (c) => {
    const { scope, canEdit } = await authorisePages(c, "project:read");
    return c.json(
      pageListSchema.parse({ pages: await listPages(scope), canEdit }),
      200,
    );
  })
  .openapi(createRouteDef, async (c) => {
    const { scope, actor } = await authorisePages(c, "project:update");
    const row = await createPage(scope, c.req.valid("json"), actor);
    return c.json(await toPage(row, true), 201);
  })
  .openapi(getRoute, async (c) => {
    const { scope, canEdit } = await authorisePages(c, "project:read");
    const row = await findPage(scope, c.req.valid("param").id);
    if (!row) throw notFound();
    return c.json(await toPage(row, canEdit), 200);
  })
  .openapi(updateRoute, async (c) => {
    const { scope, actor } = await authorisePages(c, "project:update");
    try {
      const row = await updatePage(
        scope,
        c.req.valid("param").id,
        c.req.valid("json"),
        actor,
      );
      if (!row) throw notFound();
      return c.json(await toPage(row, true), 200);
    } catch (error) {
      if (error instanceof PageConflictError)
        return c.json(await conflictResponse(error), 409);
      throw error;
    }
  })
  .openapi(versionsRoute, async (c) => {
    const { scope } = await authorisePages(c, "project:read");
    const page = await findPage(scope, c.req.valid("param").id);
    if (!page) throw notFound();
    return c.json(
      pageVersionListSchema.parse({ versions: await listVersions(page.id) }),
      200,
    );
  })
  .openapi(versionRoute, async (c) => {
    const { scope } = await authorisePages(c, "project:read");
    const params = c.req.valid("param");
    const page = await findPage(scope, params.id);
    if (!page) throw notFound();
    const version = await getVersion(page.id, params.number);
    if (!version) throw notFound();
    const [summary] = (await listVersions(page.id)).filter(
      (entry) => entry.number === version.number,
    );
    if (!summary) throw notFound();
    return c.json(
      pageVersionSchema.parse({ ...summary, body: version.body }),
      200,
    );
  })
  .openapi(restoreRoute, async (c) => {
    const { scope, actor } = await authorisePages(c, "project:update");
    try {
      const result = await restoreVersion(
        scope,
        c.req.valid("param").id,
        c.req.valid("json"),
        actor,
      );
      if (!result || result === "version_missing") throw notFound();
      return c.json(await toPage(result, true), 200);
    } catch (error) {
      if (error instanceof PageConflictError)
        return c.json(await conflictResponse(error), 409);
      throw error;
    }
  })
  .openapi(undeleteRoute, async (c) => {
    const { scope, actor } = await authorisePages(c, "project:update");
    const result = await undeletePage(scope, c.req.valid("param").id, actor);
    if (result === undefined) throw notFound();
    if (typeof result === "string")
      throw new HTTPException(409, { message: UNDELETE_MESSAGES[result] });
    return c.json(await toPage(result, true), 200);
  })
  .openapi(deleteRoute, async (c) => {
    const { scope } = await authorisePages(c, "project:update");
    const id = c.req.valid("param").id;
    if (!(await findPage(scope, id))) throw notFound();
    const pending = await requestRegisteredDeletion(c, {
      routeKey: PAGE_DELETION_ROUTE,
      targetType: "project_page",
      id,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
    });
    return c.json(pending, 202);
  });

export type PagesBodyType = z.infer<typeof pageSchema>;
export default router;
