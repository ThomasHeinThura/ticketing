import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { rejectNulByte } from "../utils/reject-nul-byte";
import { requireApiKeyPermissionScope } from "../utils/require-api-key-permission-scope";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { customFieldActor } from "./index";
import {
  createSection,
  deleteSection,
  getSection,
  listSections,
  renameSection,
  reorderSections,
} from "./repository";
import {
  customFieldSectionListSchema,
  customFieldSectionSchema,
  okSchema,
} from "./response";
import {
  createSectionBody,
  idParam,
  reorderSectionsBody,
  updateSectionBody,
  workspaceIdQuery,
} from "./schema";

async function sectionReach(c: Context, next: Next) {
  const id = c.req.param("id");
  if (!id) throw new HTTPException(400, { message: "Missing section id" });
  rejectNulByte(id, "Section id");
  const section = await getSection(id);
  if (!section) throw new HTTPException(404, { message: "Section not found" });
  try {
    await validateWorkspaceAccess(
      c.get("userId"),
      section.workspaceId,
      c.get("apiKey")?.id,
    );
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403)
      throw new HTTPException(404, { message: "Section not found" });
    throw error;
  }
  c.set("workspaceId", section.workspaceId);
  c.set("workspaceIdSource", "row");
  await next();
}

const manage = [
  requireApiKeyPermissionScope({ custom_field: ["manage"] }),
  requireWorkspaceCapability("custom_field:manage"),
] as const;

const listRoute = createRoute({
  method: "get",
  path: "/",
  operationId: "listCustomFieldSections",
  tags: ["Custom fields"],
  summary: "List custom field sections",
  middleware: [
    workspaceAccess.fromQuery(),
    requireApiKeyPermissionScope({ workspace: ["read"] }),
    requireWorkspaceCapability("workspace:read"),
  ] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse(
      "Sections in position order",
      customFieldSectionListSchema,
    ),
    403: errorResponse("Missing workspace:read permission"),
  },
});
const createRouteDef = createRoute({
  method: "post",
  path: "/",
  operationId: "createCustomFieldSection",
  tags: ["Custom fields"],
  summary: "Create a section",
  middleware: [workspaceAccess.fromBody(), ...manage] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createSectionBody } },
    },
  },
  responses: {
    200: jsonResponse("Created section", customFieldSectionSchema),
    403: errorResponse("Missing custom_field:manage permission"),
    409: errorResponse("A section with that name exists"),
  },
});
const reorderRoute = createRoute({
  method: "post",
  path: "/reorder",
  operationId: "reorderCustomFieldSections",
  tags: ["Custom fields"],
  summary: "Reorder sections",
  middleware: [workspaceAccess.fromBody(), ...manage] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: reorderSectionsBody } },
    },
  },
  responses: {
    200: jsonResponse("Reordered", okSchema),
    400: errorResponse("The order must list every section once"),
    403: errorResponse("Missing custom_field:manage permission"),
  },
});
const updateRouteDef = createRoute({
  method: "patch",
  path: "/{id}",
  operationId: "updateCustomFieldSection",
  tags: ["Custom fields"],
  summary: "Rename a section",
  middleware: [sectionReach, ...manage] as const,
  request: {
    params: idParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateSectionBody } },
    },
  },
  responses: {
    200: jsonResponse("Renamed section", customFieldSectionSchema),
    403: errorResponse("Missing custom_field:manage permission"),
    404: errorResponse("Section not found"),
    409: errorResponse("A section with that name exists"),
  },
});
const deleteRouteDef = createRoute({
  method: "delete",
  path: "/{id}",
  operationId: "deleteCustomFieldSection",
  tags: ["Custom fields"],
  summary: "Delete an empty section",
  description:
    "Refused while any field (including a deleted one inside its restore window) still belongs to the section.",
  middleware: [sectionReach, ...manage] as const,
  request: { params: idParam },
  responses: {
    200: jsonResponse("Deleted", okSchema),
    403: errorResponse("Missing custom_field:manage permission"),
    404: errorResponse("Section not found"),
    409: errorResponse("The section still contains fields"),
  },
});

const router = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listRoute, async (c) =>
    c.json({ data: await listSections(c.req.valid("query").workspaceId) }, 200),
  )
  .openapi(createRouteDef, async (c) => {
    const body = c.req.valid("json");
    return c.json(
      await createSection(body.workspaceId, body.name, customFieldActor(c)),
      200,
    );
  })
  .openapi(reorderRoute, async (c) => {
    const body = c.req.valid("json");
    await reorderSections(body.workspaceId, body.sectionIds);
    return c.json({ ok: true as const }, 200);
  })
  .openapi(updateRouteDef, async (c) => {
    const updated = await renameSection(
      c.req.valid("param").id,
      c.get("workspaceId"),
      c.req.valid("json").name,
      customFieldActor(c),
    );
    if (!updated)
      throw new HTTPException(404, { message: "Section not found" });
    return c.json(updated, 200);
  })
  .openapi(deleteRouteDef, async (c) => {
    const removed = await deleteSection(
      c.req.valid("param").id,
      c.get("workspaceId"),
      customFieldActor(c),
    );
    if (!removed)
      throw new HTTPException(404, { message: "Section not found" });
    return c.json({ ok: true as const }, 200);
  });

export default router;
