import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import {
  registeredDeletionRequestSchema,
  requestRegisteredDeletion,
} from "../pending-action/deletion-targets";
import {
  listReachOf,
  requireReachFilteredList,
} from "../utils/reach-filtered-list";
import { rejectNulByte } from "../utils/reject-nul-byte";
import { requireApiKeyPermissionScope } from "../utils/require-api-key-permission-scope";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { CUSTOM_FIELD_DELETION_ROUTE } from "./deletion-target";
import { FIELD_COUNT_WARNING_THRESHOLD } from "./logic";
import {
  type CustomFieldActor,
  createField,
  dependentFieldKeys,
  fieldUsageCounts,
  getField,
  getFieldWorkspace,
  listFields,
  nonCompliantItems,
  reorderFields,
  restoreField,
  setFieldVisibility,
  updateField,
} from "./repository";
import {
  customFieldListSchema,
  customFieldSchema,
  nonCompliantItemsSchema,
  okSchema,
} from "./response";
import {
  createFieldBody,
  idParam,
  nonCompliantQuery,
  reorderFieldsBody,
  setVisibilityBody,
  updateFieldBody,
  workspaceIdQuery,
} from "./schema";

export function customFieldActor(c: Context): CustomFieldActor {
  const apiKey = c.get("apiKey") as { id: string } | undefined;
  return {
    userId: c.get("userId") as string,
    actorType: apiKey ? "api_key" : "person",
    apiKeyId: apiKey?.id ?? null,
  };
}

/** Resolve the field's workspace from the row and require access; a foreign row is a 404. */
async function fieldReach(c: Context, next: Next) {
  const id = c.req.param("id");
  if (!id) throw new HTTPException(400, { message: "Missing custom field id" });
  rejectNulByte(id, "Custom field id");
  const field = await getFieldWorkspace(id);
  if (!field)
    throw new HTTPException(404, { message: "Custom field not found" });
  try {
    await validateWorkspaceAccess(
      c.get("userId"),
      field.workspaceId,
      c.get("apiKey")?.id,
    );
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403)
      throw new HTTPException(404, { message: "Custom field not found" });
    throw error;
  }
  c.set("workspaceId", field.workspaceId);
  c.set("workspaceIdSource", "row");
  await next();
}

const manage = [
  requireApiKeyPermissionScope({ custom_field: ["manage"] }),
  requireWorkspaceCapability("custom_field:manage"),
] as const;
const read = [
  requireApiKeyPermissionScope({ workspace: ["read"] }),
  requireWorkspaceCapability("workspace:read"),
] as const;

const listRoute = createRoute({
  method: "get",
  path: "/",
  operationId: "listCustomFields",
  tags: ["Custom fields"],
  summary: "List custom fields",
  description:
    "Active fields in the workspace (or including soft-deleted ones), in section and position order, with per-type visibility and a usage count.",
  middleware: [workspaceAccess.fromQuery(), ...read] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse("Custom fields", customFieldListSchema),
    403: errorResponse("Missing workspace:read permission"),
  },
});
const createRouteDef = createRoute({
  method: "post",
  path: "/",
  operationId: "createCustomField",
  tags: ["Custom fields"],
  summary: "Create a custom field",
  middleware: [workspaceAccess.fromBody(), ...manage] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createFieldBody } },
    },
  },
  responses: {
    200: jsonResponse("Created field", customFieldSchema),
    400: errorResponse("Invalid field definition"),
    403: errorResponse("Missing custom_field:manage permission"),
    409: errorResponse("A field with that key already exists"),
  },
});
const reorderRoute = createRoute({
  method: "post",
  path: "/reorder",
  operationId: "reorderCustomFields",
  tags: ["Custom fields"],
  summary: "Reorder fields and move them between sections",
  middleware: [workspaceAccess.fromBody(), ...manage] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: reorderFieldsBody } },
    },
  },
  responses: {
    200: jsonResponse("Reordered", okSchema),
    400: errorResponse("The layout must list every active field once"),
    403: errorResponse("Missing custom_field:manage permission"),
  },
});
const updateRouteDef = createRoute({
  method: "patch",
  path: "/{id}",
  operationId: "updateCustomField",
  tags: ["Custom fields"],
  summary: "Edit a custom field",
  description:
    "Name, section, options, default, help text, customer visibility and the visibility condition. A format change is refused (CF-9); removing an option in use is refused (CF-7).",
  middleware: [fieldReach, ...manage] as const,
  request: {
    params: idParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateFieldBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated field", customFieldSchema),
    400: errorResponse("Invalid field definition"),
    403: errorResponse("Missing custom_field:manage permission"),
    404: errorResponse("Custom field not found"),
    409: errorResponse("Format change or option in use"),
  },
});
const deleteRoute = createRoute({
  method: "delete",
  path: "/{id}",
  operationId: "deleteCustomField",
  tags: ["Custom fields"],
  summary: "Delete a custom field",
  description:
    "Request deletion (202 pending action, click approval). The field is soft-deleted and restorable for 30 days (CF-8).",
  middleware: [fieldReach, ...manage] as const,
  request: { params: idParam },
  responses: {
    202: jsonResponse(
      "Deletion awaiting approval",
      registeredDeletionRequestSchema,
    ),
    403: errorResponse("Missing custom_field:manage permission"),
    404: errorResponse("Custom field not found"),
    409: errorResponse("Other fields' conditions reference this field"),
  },
});
const restoreRoute = createRoute({
  method: "post",
  path: "/{id}/restore",
  operationId: "restoreCustomField",
  tags: ["Custom fields"],
  summary: "Restore a deleted custom field",
  middleware: [fieldReach, ...manage] as const,
  request: { params: idParam },
  responses: {
    200: jsonResponse("Restored field", customFieldSchema),
    403: errorResponse("Missing custom_field:manage permission"),
    404: errorResponse("No deleted field with that id"),
    409: errorResponse("The 30 day restore window has passed"),
  },
});
const visibilityRoute = createRoute({
  method: "put",
  path: "/{id}/visibility",
  operationId: "setCustomFieldVisibility",
  tags: ["Custom fields"],
  summary: "Set per-type visibility and requiredness",
  description:
    "Replaces the types x (hidden / visible / required) grid for this field (CF-2).",
  middleware: [fieldReach, ...manage] as const,
  request: {
    params: idParam,
    body: {
      required: true,
      content: { "application/json": { schema: setVisibilityBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated field", customFieldSchema),
    400: errorResponse("Invalid visibility grid"),
    403: errorResponse("Missing custom_field:manage permission"),
    404: errorResponse("Custom field not found"),
  },
});
const nonCompliantRoute = createRoute({
  method: "get",
  path: "/{id}/non-compliant-items",
  operationId: "listCustomFieldNonCompliantItems",
  tags: ["Custom fields"],
  summary: "Work items missing a required field",
  description:
    "Items of types where the field is required that have no value, limited to the projects the caller reaches.",
  middleware: [fieldReach, ...read, requireReachFilteredList] as const,
  request: { params: idParam, query: nonCompliantQuery },
  responses: {
    200: jsonResponse("Non-compliant items", nonCompliantItemsSchema),
    403: errorResponse("Missing workspace:read permission"),
    404: errorResponse("Custom field not found"),
  },
});

const router = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listRoute, async (c) => {
    const { workspaceId, includeDeleted } = c.req.valid("query");
    const fields = await listFields(workspaceId, { includeDeleted });
    const usage = await fieldUsageCounts(fields.map((field) => field.id));
    const active = fields.filter((field) => field.deletedAt === null).length;
    return c.json(
      {
        data: fields.map((field) => ({
          ...field,
          entityType: "work_item" as const,
          usageCount: usage.get(field.id) ?? 0,
        })),
        meta: {
          total: fields.length,
          manyFieldsWarning: active >= FIELD_COUNT_WARNING_THRESHOLD,
        },
      },
      200,
    );
  })
  .openapi(createRouteDef, async (c) => {
    const body = c.req.valid("json");
    const created = await createField({
      ...body,
      options: body.options,
      actor: customFieldActor(c),
    });
    return c.json({ ...created, entityType: "work_item" as const }, 200);
  })
  .openapi(reorderRoute, async (c) => {
    const body = c.req.valid("json");
    await reorderFields(body.workspaceId, body.sections);
    return c.json({ ok: true as const }, 200);
  })
  .openapi(updateRouteDef, async (c) => {
    const updated = await updateField(
      c.req.valid("param").id,
      c.get("workspaceId"),
      c.req.valid("json"),
      customFieldActor(c),
    );
    if (!updated)
      throw new HTTPException(404, { message: "Custom field not found" });
    return c.json({ ...updated, entityType: "work_item" as const }, 200);
  })
  .openapi(deleteRoute, async (c) => {
    const id = c.req.valid("param").id;
    const field = await getField(id, c.get("workspaceId"));
    if (!field || field.deletedAt !== null)
      throw new HTTPException(404, { message: "Custom field not found" });
    const dependents = await dependentFieldKeys(
      db,
      c.get("workspaceId"),
      field,
    );
    if (dependents.length > 0)
      throw new HTTPException(409, {
        message: `Fields whose visibility depends on "${field.key}": ${dependents.join(", ")}. Remove those conditions first.`,
      });
    const pending = await requestRegisteredDeletion(c, {
      routeKey: CUSTOM_FIELD_DELETION_ROUTE,
      targetType: "custom_field",
      id,
      workspaceId: c.get("workspaceId"),
    });
    return c.json(pending, 202);
  })
  .openapi(restoreRoute, async (c) => {
    const restored = await restoreField(
      c.req.valid("param").id,
      c.get("workspaceId"),
      customFieldActor(c),
    );
    if (!restored)
      throw new HTTPException(404, { message: "Custom field not found" });
    return c.json({ ...restored, entityType: "work_item" as const }, 200);
  })
  .openapi(visibilityRoute, async (c) => {
    const updated = await setFieldVisibility(
      c.req.valid("param").id,
      c.get("workspaceId"),
      c.req.valid("json").visibility,
      customFieldActor(c),
    );
    if (!updated)
      throw new HTTPException(404, { message: "Custom field not found" });
    return c.json({ ...updated, entityType: "work_item" as const }, 200);
  })
  .openapi(nonCompliantRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    const field = await getField(c.req.valid("param").id, workspaceId);
    if (!field)
      throw new HTTPException(404, { message: "Custom field not found" });
    const projectIds = await listReachOf(c).reachableProjectIds([workspaceId]);
    return c.json(
      {
        data: await nonCompliantItems(
          field,
          workspaceId,
          projectIds,
          c.req.valid("query").limit,
        ),
      },
      200,
    );
  });

export default router;
