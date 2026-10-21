import type { Capability, ResolvedIdentity } from "@taskdesk/permissions";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { resolveRequestIdentity } from "../permissions/resolve-request-identity";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  createProjectCatalogueLabel,
  editProjectCatalogueLabel,
  getProjectLabelCatalogue,
  removeProjectCatalogueLabel,
} from "./project-controller";
import { labelSchema } from "./response";

const projectParam = z.object({ projectId: z.string().min(1) });
const projectLabelParam = projectParam.extend({
  id: z
    .string()
    .min(1)
    .refine((value) => !value.includes("\0"), "Invalid label id"),
});
const values = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .refine((value) => !value.includes("\0"), "Invalid label name"),
  color: z
    .string()
    .min(1)
    .refine((value) => !value.includes("\0"), "Invalid label colour"),
});
const response = labelSchema
  .extend({ projectId: z.string().nullable() })
  .openapi("ProjectLabel");
const scope = (capability: Capability) => [
  workspaceAccess.fromProject("projectId", {
    requireProjectReach: true,
    deferCapability: true,
  }),
  requireWorkspaceCapability(capability),
];
const errors = {
  400: errorResponse("Invalid request"),
  403: errorResponse("Insufficient permissions"),
  404: errorResponse("Project or label not found"),
};
const list = createRoute({
  method: "get",
  path: "/project/{projectId}/catalogue",
  operationId: "listProjectLabels",
  tags: ["Labels"],
  summary: "List the project label catalogue",
  middleware: scope("workspace:read"),
  request: { params: projectParam },
  responses: {
    200: jsonResponse("Project labels", z.array(response)),
    ...errors,
  },
});
const create = createRoute({
  method: "post",
  path: "/project/{projectId}/catalogue",
  operationId: "createProjectLabel",
  tags: ["Labels"],
  summary: "Create a project catalogue label",
  middleware: scope("label:manage"),
  request: {
    params: projectParam,
    body: {
      required: true,
      content: { "application/json": { schema: values } },
    },
  },
  responses: {
    200: jsonResponse("Created or existing project label", response),
    ...errors,
  },
});
const update = createRoute({
  method: "patch",
  path: "/project/{projectId}/catalogue/{id}",
  operationId: "updateProjectLabel",
  tags: ["Labels"],
  summary: "Edit a project catalogue label",
  middleware: scope("label:manage"),
  request: {
    params: projectLabelParam,
    body: {
      required: true,
      content: { "application/json": { schema: values } },
    },
  },
  responses: {
    200: jsonResponse("Updated project label", response),
    409: errorResponse("Label name already exists in this project"),
    ...errors,
  },
});
const remove = createRoute({
  method: "delete",
  path: "/project/{projectId}/catalogue/{id}",
  operationId: "deleteProjectLabel",
  tags: ["Labels"],
  summary: "Delete a project label and journal its removed assignments",
  middleware: scope("label:manage"),
  request: { params: projectLabelParam },
  responses: {
    200: jsonResponse("Deleted project label", response),
    ...errors,
  },
});

async function identity(
  c: Context<{ Variables: BaseVariables }>,
): Promise<ResolvedIdentity> {
  const session = c.get("session") as { impersonatedBy?: string | null } | null;
  const resolved = await resolveRequestIdentity({
    userId: c.get("userId"),
    apiKey: c.get("apiKey"),
    impersonatedBy: session?.impersonatedBy,
  });
  if (!resolved) throw new HTTPException(403, { message: "Forbidden" });
  return resolved;
}

export const projectLabelRoutes = apiRouter()
  .openapi(list, async (c) =>
    c.json(
      await getProjectLabelCatalogue(
        await identity(c),
        c.req.valid("param").projectId,
      ),
      200,
    ),
  )
  .openapi(create, async (c) =>
    c.json(
      await createProjectCatalogueLabel(
        await identity(c),
        c.req.valid("param").projectId,
        c.req.valid("json"),
      ),
      200,
    ),
  )
  .openapi(update, async (c) => {
    const { projectId, id } = c.req.valid("param");
    return c.json(
      await editProjectCatalogueLabel(
        await identity(c),
        projectId,
        id,
        c.req.valid("json"),
      ),
      200,
    );
  })
  .openapi(remove, async (c) => {
    const { projectId, id } = c.req.valid("param");
    return c.json(
      await removeProjectCatalogueLabel(
        await identity(c),
        projectId,
        id,
        c.get("userId"),
      ),
      200,
    );
  });
