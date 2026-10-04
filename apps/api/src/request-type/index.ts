import { createId } from "@paralleldrive/cuid2";
import {
  type FormSchema,
  validateFormSchema,
  validatePublishableFormSchema,
} from "@taskdesk/domain";
import { and, eq, isNull } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { requireFeatureEnabled } from "../feature-flags/runtime";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { assertAssignableUser } from "../utils/assert-assignable-user";
import { rejectNulByte } from "../utils/reject-nul-byte";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { requestTypeListSchema, requestTypeSchema } from "./response";
import {
  createRequestTypeBody,
  requestTypeIdParam,
  updateRequestTypeBody,
  workspaceRequestTypeQuery,
} from "./schema";

const apiError = { message: "Request type unavailable" };
const nativeFields = new Set(["title", "description", "priority", "due_date"]);

async function requestTypeReach(c: Context, next: Next) {
  const id = c.req.param("id");
  if (!id) throw new HTTPException(400, { message: "Missing request type id" });
  rejectNulByte(id, "Request type id");
  const [row] = await db
    .select({
      id: schema.requestTypeTable.id,
      workspaceId: schema.requestTypeTable.workspaceId,
    })
    .from(schema.requestTypeTable)
    .where(eq(schema.requestTypeTable.id, id))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Request type not found" });
  try {
    await validateWorkspaceAccess(
      c.get("userId"),
      row.workspaceId,
      c.get("apiKey")?.id,
    );
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403)
      throw new HTTPException(404, { message: "Request type not found" });
    throw error;
  }
  c.set("workspaceId", row.workspaceId);
  c.set("workspaceIdSource", "row");
  await next();
}

const listRoute = createRoute({
  method: "get",
  path: "/",
  operationId: "listRequestTypes",
  tags: ["Request types"],
  summary: "List request types in a workspace",
  middleware: [
    workspaceAccess.fromQuery(),
    requireFeatureEnabled("feature.intake", (c) => ({
      workspaceId: c.get("workspaceId"),
    })),
    requireWorkspaceCapability("request_type:read"),
  ] as const,
  request: { query: workspaceRequestTypeQuery },
  responses: {
    200: jsonResponse("Request types", requestTypeListSchema),
    403: errorResponse("Forbidden"),
    404: errorResponse("Feature or workspace not found"),
  },
});

const createRouteDef = createRoute({
  method: "post",
  path: "/",
  operationId: "createRequestType",
  tags: ["Request types"],
  summary: "Create a request type draft",
  middleware: [
    workspaceAccess.fromBody(),
    requireFeatureEnabled("feature.intake", (c) => ({
      workspaceId: c.get("workspaceId"),
    })),
    requireWorkspaceCapability("request_type:manage"),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createRequestTypeBody } },
    },
  },
  responses: {
    200: jsonResponse("Created request type", requestTypeSchema),
    400: errorResponse("Invalid request type"),
    403: errorResponse("Forbidden"),
    404: errorResponse("Feature or workspace not found"),
  },
});

const updateRoute = createRoute({
  method: "patch",
  path: "/{id}",
  operationId: "updateRequestType",
  tags: ["Request types"],
  summary: "Update a request type",
  middleware: [
    requestTypeReach,
    requireFeatureEnabled("feature.intake", (c) => ({
      workspaceId: c.get("workspaceId"),
    })),
    requireWorkspaceCapability("request_type:manage"),
  ] as const,
  request: {
    params: requestTypeIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateRequestTypeBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated request type", requestTypeSchema),
    400: errorResponse("Invalid request type"),
    403: errorResponse("Forbidden"),
    404: errorResponse("Request type not found"),
  },
});

const publishRoute = createRoute({
  method: "post",
  path: "/{id}/publish",
  operationId: "publishRequestType",
  tags: ["Request types"],
  summary: "Publish a request type version",
  middleware: [
    requestTypeReach,
    requireFeatureEnabled("feature.intake", (c) => ({
      workspaceId: c.get("workspaceId"),
    })),
    requireWorkspaceCapability("request_type:manage"),
  ] as const,
  request: { params: requestTypeIdParam },
  responses: {
    200: jsonResponse("Published request type", requestTypeSchema),
    400: errorResponse("Form schema or reference is invalid"),
    403: errorResponse("Forbidden"),
    404: errorResponse("Request type not found"),
  },
});

const unpublishRoute = createRoute({
  method: "post",
  path: "/{id}/unpublish",
  operationId: "unpublishRequestType",
  tags: ["Request types"],
  summary: "Unpublish a request type",
  middleware: [
    requestTypeReach,
    requireFeatureEnabled("feature.intake", (c) => ({
      workspaceId: c.get("workspaceId"),
    })),
    requireWorkspaceCapability("request_type:manage"),
  ] as const,
  request: { params: requestTypeIdParam },
  responses: {
    200: jsonResponse("Unpublished request type", requestTypeSchema),
    403: errorResponse("Forbidden"),
    404: errorResponse("Request type not found"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/{id}",
  operationId: "deleteRequestType",
  tags: ["Request types"],
  summary: "Delete an unpublished request type",
  middleware: [
    requestTypeReach,
    requireFeatureEnabled("feature.intake", (c) => ({
      workspaceId: c.get("workspaceId"),
    })),
    requireWorkspaceCapability("request_type:manage"),
  ] as const,
  request: { params: requestTypeIdParam },
  responses: {
    200: jsonResponse("Deleted request type", requestTypeSchema),
    400: errorResponse(
      "Published or referenced request types cannot be deleted",
    ),
    403: errorResponse("Forbidden"),
    404: errorResponse("Request type not found"),
  },
});

const routes = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listRoute, async (c) => {
    const { workspaceId } = c.req.valid("query");
    const rows = await db
      .select()
      .from(schema.requestTypeTable)
      .where(eq(schema.requestTypeTable.workspaceId, workspaceId))
      .orderBy(
        schema.requestTypeTable.group,
        schema.requestTypeTable.position,
        schema.requestTypeTable.name,
      );
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      { items: rows.map((row) => requestTypeSchema.parse(row)) },
      200,
    );
  })
  .openapi(createRouteDef, async (c) => {
    const body = c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    if (!workspaceId || body.workspaceId !== workspaceId)
      throw new HTTPException(400, { message: "Invalid workspace" });
    const defects = validateFormSchema(
      body.formSchema as FormSchema,
      nativeFields,
    );
    if (defects.length)
      throw new HTTPException(400, { message: "Form schema is invalid" });
    if (body.defaultProjectId) {
      const [project] = await db
        .select({ id: schema.projectTable.id })
        .from(schema.projectTable)
        .where(
          and(
            eq(schema.projectTable.id, body.defaultProjectId),
            eq(schema.projectTable.workspaceId, workspaceId),
            isNull(schema.projectTable.deletedAt),
          ),
        )
        .limit(1);
      if (!project)
        throw new HTTPException(400, {
          message: "Default project must belong to this workspace",
        });
    }
    const id = createId();
    const [row] = await db
      .insert(schema.requestTypeTable)
      .values({ ...body, id, key: createId(), workspaceId, published: false })
      .returning();
    if (!row) throw new HTTPException(503, apiError);
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(requestTypeSchema.parse(row), 200);
  })
  .openapi(updateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    if (body.formSchema) {
      const defects = validateFormSchema(
        body.formSchema as FormSchema,
        nativeFields,
      );
      if (defects.length)
        throw new HTTPException(400, { message: "Form schema is invalid" });
    }
    const workspaceId = c.get("workspaceId");
    const [currentType] = await db
      .select({
        defaultProjectId: schema.requestTypeTable.defaultProjectId,
        autoAccept: schema.requestTypeTable.autoAccept,
      })
      .from(schema.requestTypeTable)
      .where(
        and(
          eq(schema.requestTypeTable.id, id),
          eq(schema.requestTypeTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    const proposedProjectId =
      body.defaultProjectId === undefined
        ? currentType?.defaultProjectId
        : body.defaultProjectId;
    if ((body.autoAccept ?? currentType?.autoAccept) && !proposedProjectId) {
      throw new HTTPException(400, {
        message: "Auto-accept requires a default project",
      });
    }
    if (proposedProjectId) {
      const [project] = await db
        .select({ id: schema.projectTable.id })
        .from(schema.projectTable)
        .where(
          and(
            eq(schema.projectTable.id, proposedProjectId),
            eq(schema.projectTable.workspaceId, workspaceId),
            isNull(schema.projectTable.deletedAt),
          ),
        )
        .limit(1);
      if (!project)
        throw new HTTPException(400, {
          message: "Default project must belong to this workspace",
        });
    }
    const [row] = await db
      .update(schema.requestTypeTable)
      .set(body)
      .where(
        and(
          eq(schema.requestTypeTable.id, id),
          eq(schema.requestTypeTable.workspaceId, c.get("workspaceId")),
        ),
      )
      .returning();
    if (!row)
      throw new HTTPException(404, { message: "Request type not found" });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(requestTypeSchema.parse(row), 200);
  })
  .openapi(publishRoute, async (c) => {
    const { id } = c.req.valid("param");
    const row = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(schema.requestTypeTable)
        .where(
          and(
            eq(schema.requestTypeTable.id, id),
            eq(schema.requestTypeTable.workspaceId, c.get("workspaceId")),
          ),
        )
        .for("update")
        .limit(1);
      if (!current)
        throw new HTTPException(404, { message: "Request type not found" });
      const [mappedType] = await tx
        .select({ id: schema.workItemTypeTable.id })
        .from(schema.workItemTypeTable)
        .where(
          and(
            eq(schema.workItemTypeTable.id, current.workItemTypeId),
            eq(schema.workItemTypeTable.workspaceId, current.workspaceId),
          ),
        )
        .limit(1);
      if (!mappedType)
        throw new HTTPException(400, {
          message: "Work item type must belong to this workspace",
        });
      const customFields = await tx
        .select({
          key: schema.customFieldTable.key,
          format: schema.customFieldTable.format,
          options: schema.customFieldTable.options,
          customerVisible: schema.customFieldTable.customerVisible,
          condition: schema.customFieldTable.visibilityCondition,
          visible: schema.customFieldTypeVisibilityTable.visible,
        })
        .from(schema.customFieldTable)
        .innerJoin(
          schema.customFieldTypeVisibilityTable,
          eq(
            schema.customFieldTypeVisibilityTable.customFieldId,
            schema.customFieldTable.id,
          ),
        )
        .where(
          and(
            eq(schema.customFieldTable.workspaceId, current.workspaceId),
            eq(schema.customFieldTable.entityType, "work_item"),
            isNull(schema.customFieldTable.deletedAt),
            eq(
              schema.customFieldTypeVisibilityTable.workItemTypeId,
              current.workItemTypeId,
            ),
            eq(schema.customFieldTypeVisibilityTable.visible, true),
          ),
        );
      const customTargets = new Set(
        customFields
          .filter((field) => field.customerVisible)
          .map((field) => `cf.${field.key}`),
      );
      const validTargets = new Set([...nativeFields, ...customTargets]);
      const defects = validatePublishableFormSchema(
        current.formSchema as FormSchema,
        validTargets,
      );
      if (defects.length)
        throw new HTTPException(400, { message: "Form schema is invalid" });
      const fieldByTarget = new Map(
        customFields.map((field) => [`cf.${field.key}`, field]),
      );
      const fieldByKey = new Map(
        customFields.map((field) => [field.key, field]),
      );
      for (const definition of customFields) {
        if (definition.condition == null) continue;
        if (
          typeof definition.condition !== "object" ||
          Array.isArray(definition.condition)
        )
          throw new HTTPException(400, {
            message: "Custom-field visibility is invalid",
          });
        const condition = definition.condition as {
          field_key?: unknown;
          op?: unknown;
          value?: unknown;
        };
        const controller =
          typeof condition.field_key === "string"
            ? fieldByKey.get(condition.field_key)
            : undefined;
        if (
          !controller ||
          controller.condition != null ||
          !["eq", "neq", "in", "is_set"].includes(String(condition.op)) ||
          (condition.op === "in" && !Array.isArray(condition.value))
        ) {
          throw new HTTPException(400, {
            message: "Custom-field visibility is invalid",
          });
        }
      }
      const seenCustomTargets = new Set<string>();
      for (const field of (current.formSchema as FormSchema).fields) {
        const target = field.mapsTo?.field;
        if (!target?.startsWith("cf.")) continue;
        const definition = fieldByTarget.get(target);
        if (!definition || !definition.customerVisible)
          throw new HTTPException(400, {
            message:
              "Custom-field mapping must target a customer-visible field",
          });
        if (seenCustomTargets.has(target))
          throw new HTTPException(400, {
            message: "A custom field may be mapped only once",
          });
        seenCustomTargets.add(target);
        const compatible =
          ((definition.format === "text" ||
            definition.format === "long_text" ||
            definition.format === "url" ||
            definition.format === "email") &&
            (field.type === "text" || field.type === "textarea")) ||
          (definition.format === "date" && field.type === "date") ||
          (definition.format === "boolean" && field.type === "checkbox") ||
          (definition.format === "number" && field.type === "number") ||
          ((definition.format === "select" ||
            definition.format === "multi_select") &&
            (field.type === "select" || field.type === "combobox") &&
            (definition.format === "multi_select") ===
              (field.multiple === true));
        if (!compatible)
          throw new HTTPException(400, {
            message:
              "Custom-field form control does not match its value format",
          });
        if (
          definition.format === "select" ||
          definition.format === "multi_select"
        ) {
          const validOptions = new Set(
            Array.isArray(definition.options)
              ? definition.options.flatMap((option) =>
                  typeof option === "object" &&
                  option !== null &&
                  "key" in option &&
                  typeof option.key === "string" &&
                  (!("active" in option) || option.active !== false)
                    ? [option.key]
                    : [],
                )
              : [],
          );
          for (const option of field.options ?? []) {
            const mapped =
              field.mapsTo?.map && Object.hasOwn(field.mapsTo.map, option)
                ? field.mapsTo.map[option]
                : option;
            if (!validOptions.has(mapped))
              throw new HTTPException(400, {
                message: "Custom-field option mapping is unavailable",
              });
          }
        }
      }
      if (current.slaPolicyId) {
        const [policy] = await tx
          .select({ id: schema.slaPolicyTable.id })
          .from(schema.slaPolicyTable)
          .where(
            and(
              eq(schema.slaPolicyTable.id, current.slaPolicyId),
              eq(schema.slaPolicyTable.workspaceId, current.workspaceId),
            ),
          )
          .limit(1);
        if (!policy)
          throw new HTTPException(400, {
            message: "SLA policy must belong to this workspace",
          });
      }
      if (current.defaultAssigneeId) {
        const [assignee] = await tx
          .select({ userId: schema.personTable.userId })
          .from(schema.personTable)
          .where(
            and(
              eq(schema.personTable.id, current.defaultAssigneeId),
              eq(schema.personTable.side, "staff"),
              eq(schema.personTable.active, true),
            ),
          )
          .limit(1);
        if (!assignee)
          throw new HTTPException(400, {
            message: "Default assignee must be an active staff member",
          });
        if (!assignee.userId)
          throw new HTTPException(400, {
            message: "Default assignee has no staff account",
          });
        await assertAssignableUser(assignee.userId, current.workspaceId, tx);
      }
      if (current.autoAccept && !current.defaultProjectId) {
        throw new HTTPException(400, {
          message: "Auto-accept requires a default project",
        });
      }
      if (current.defaultProjectId) {
        const [project] = await tx
          .select({ id: schema.projectTable.id })
          .from(schema.projectTable)
          .where(
            and(
              eq(schema.projectTable.id, current.defaultProjectId),
              eq(schema.projectTable.workspaceId, current.workspaceId),
              isNull(schema.projectTable.deletedAt),
              isNull(schema.projectTable.archivedAt),
            ),
          )
          .limit(1);
        if (!project)
          throw new HTTPException(400, {
            message: "Default project must belong to this workspace",
          });
      }
      const number = current.version + 1;
      await tx.insert(schema.requestTypeVersionTable).values({
        workspaceId: current.workspaceId,
        requestTypeId: current.id,
        number,
        formSchema: current.formSchema,
        workItemTypeId: current.workItemTypeId,
        defaultProjectId: current.defaultProjectId,
        autoAccept: current.autoAccept,
        slaPolicyId: current.slaPolicyId,
        defaultAssigneeId: current.defaultAssigneeId,
      });
      const [updated] = await tx
        .update(schema.requestTypeTable)
        .set({ version: number, published: true, updatedAt: new Date() })
        .where(eq(schema.requestTypeTable.id, current.id))
        .returning();
      if (!updated) throw new HTTPException(503, apiError);
      return updated;
    });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(requestTypeSchema.parse(row), 200);
  })
  .openapi(unpublishRoute, async (c) => {
    const { id } = c.req.valid("param");
    const [row] = await db
      .update(schema.requestTypeTable)
      .set({ published: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.requestTypeTable.id, id),
          eq(schema.requestTypeTable.workspaceId, c.get("workspaceId")),
        ),
      )
      .returning();
    if (!row)
      throw new HTTPException(404, { message: "Request type not found" });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(requestTypeSchema.parse(row), 200);
  })
  .openapi(deleteRoute, async (c) => {
    const { id } = c.req.valid("param");
    const deleted = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(schema.requestTypeTable)
        .where(
          and(
            eq(schema.requestTypeTable.id, id),
            eq(schema.requestTypeTable.workspaceId, c.get("workspaceId")),
          ),
        )
        .for("update")
        .limit(1);
      if (!current)
        throw new HTTPException(404, { message: "Request type not found" });
      if (current.published)
        throw new HTTPException(400, {
          message: "Unpublish the request type first",
        });
      const [submission] = await tx
        .select({ id: schema.submissionTable.id })
        .from(schema.submissionTable)
        .where(eq(schema.submissionTable.requestTypeId, id))
        .limit(1);
      if (submission)
        throw new HTTPException(400, {
          message: "Request type has submissions",
        });
      await tx
        .delete(schema.organisationRequestTypeTable)
        .where(eq(schema.organisationRequestTypeTable.requestTypeId, id));
      await tx
        .delete(schema.requestTypeVersionTable)
        .where(eq(schema.requestTypeVersionTable.requestTypeId, id));
      const [result] = await tx
        .delete(schema.requestTypeTable)
        .where(eq(schema.requestTypeTable.id, id))
        .returning();
      return result;
    });
    if (!deleted) throw new HTTPException(503, apiError);
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(requestTypeSchema.parse(deleted), 200);
  });

export default routes;
