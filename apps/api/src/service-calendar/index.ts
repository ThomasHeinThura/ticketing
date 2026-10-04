import {
  annualCoverMinutes,
  calendarHasCover,
  type ServiceCalendar,
  validateCalendar,
  weeklyCoverMinutes,
} from "@taskdesk/domain";
import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
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
import {
  createCalendar,
  getCalendar,
  listCalendars,
  ServiceCalendarVersionConflictError,
  updateCalendar,
} from "./repository";
import {
  calendarListSchema,
  calendarPreviewSchema,
  calendarSchema,
  calendarVersionConflictSchema,
} from "./response";
import {
  calendarDataSchema,
  calendarIdParam,
  createCalendarBody,
  optionalCalendarIfMatchHeader,
  previewQuery,
  updateCalendarBody,
  workspaceIdQuery,
} from "./schema";

async function calendarReach(c: Context, next: Next) {
  const id = c.req.param("id");
  if (!id)
    throw new HTTPException(400, { message: "Missing service calendar id" });
  rejectNulByte(id, "Service calendar id");
  const [calendar] = await db
    .select({ workspaceId: schema.serviceCalendarTable.workspaceId })
    .from(schema.serviceCalendarTable)
    .where(eq(schema.serviceCalendarTable.id, id))
    .limit(1);
  if (!calendar)
    throw new HTTPException(404, { message: "Service calendar not found" });
  try {
    await validateWorkspaceAccess(
      c.get("userId"),
      calendar.workspaceId,
      c.get("apiKey")?.id,
    );
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403)
      throw new HTTPException(404, { message: "Service calendar not found" });
    throw error;
  }
  c.set("workspaceId", calendar.workspaceId);
  c.set("workspaceIdSource", "row");
  await next();
}

function calendarValue(value: {
  timezone: string;
  windows: unknown;
  holidays: unknown;
}): ServiceCalendar {
  const parsed = calendarDataSchema.parse(value);
  const calendar = {
    timezone: parsed.timezone,
    windows: parsed.windows,
    holidays: parsed.holidays,
  } as ServiceCalendar;
  const result = validateCalendar(calendar);
  if (!result.valid)
    throw new HTTPException(400, { message: result.errors.join("; ") });
  return calendar;
}

const listRoute = createRoute({
  method: "get",
  path: "/",
  operationId: "listServiceCalendars",
  tags: ["Service calendars"],
  summary: "List service calendars",
  middleware: [
    workspaceAccess.fromQuery(),
    requireApiKeyPermissionScope({ sla_policy: ["read"] }),
    requireWorkspaceCapability("sla_policy:read"),
  ] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse("Calendars in the workspace", calendarListSchema),
    400: errorResponse("Invalid calendar list query or cursor"),
    403: errorResponse("Missing sla_policy:read permission"),
  },
});
const createRouteDef = createRoute({
  method: "post",
  path: "/",
  operationId: "createServiceCalendar",
  tags: ["Service calendars"],
  summary: "Create service calendar",
  middleware: [
    workspaceAccess.fromBody(),
    requireApiKeyPermissionScope({ sla_policy: ["manage"] }),
    requireWorkspaceCapability("sla_policy:manage"),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createCalendarBody } },
    },
  },
  responses: {
    200: jsonResponse("Created calendar", calendarSchema),
    400: errorResponse("Invalid calendar data"),
    403: errorResponse("Missing sla_policy:manage permission"),
  },
});
const detailRoute = createRoute({
  method: "get",
  path: "/{id}",
  operationId: "getServiceCalendar",
  tags: ["Service calendars"],
  summary: "Get service calendar",
  middleware: [
    calendarReach,
    requireApiKeyPermissionScope({ sla_policy: ["read"] }),
    requireWorkspaceCapability("sla_policy:read"),
  ] as const,
  request: { params: calendarIdParam },
  responses: {
    200: jsonResponse("Calendar details", calendarSchema),
    403: errorResponse("Missing sla_policy:read permission"),
    404: errorResponse("Service calendar not found"),
  },
});
const updateRouteDef = createRoute({
  method: "patch",
  path: "/{id}",
  operationId: "updateServiceCalendar",
  tags: ["Service calendars"],
  summary: "Update service calendar",
  description:
    "If-Match may contain the current quoted version. A mismatch returns 409 with asserted/current versions.",
  middleware: [
    calendarReach,
    requireApiKeyPermissionScope({ sla_policy: ["manage"] }),
    requireWorkspaceCapability("sla_policy:manage"),
  ] as const,
  request: {
    params: calendarIdParam,
    headers: optionalCalendarIfMatchHeader,
    body: {
      required: true,
      content: { "application/json": { schema: updateCalendarBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated calendar", calendarSchema),
    400: errorResponse("Invalid calendar data"),
    403: errorResponse("Missing sla_policy:manage permission"),
    404: errorResponse("Service calendar not found"),
    409: jsonResponse(
      "Calendar version conflict",
      calendarVersionConflictSchema,
    ),
  },
});
const previewRoute = createRoute({
  method: "get",
  path: "/{id}/preview",
  operationId: "previewServiceCalendar",
  tags: ["Service calendars"],
  summary: "Preview calendar cover",
  middleware: [
    calendarReach,
    requireApiKeyPermissionScope({ sla_policy: ["read"] }),
    requireWorkspaceCapability("sla_policy:read"),
  ] as const,
  request: { params: calendarIdParam, query: previewQuery },
  responses: {
    200: jsonResponse("Calendar cover totals", calendarPreviewSchema),
    403: errorResponse("Missing sla_policy:read permission"),
    404: errorResponse("Service calendar not found"),
  },
});

const router = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listRoute, async (c) =>
    c.json(
      calendarListSchema.parse(
        await listCalendars(
          c.req.valid("query").workspaceId,
          c.req.valid("query"),
        ),
      ),
      200,
    ),
  )
  .openapi(createRouteDef, async (c) => {
    const { workspaceId, name, ...data } = c.req.valid("json");
    calendarValue(data);
    const apiKey = c.get("apiKey");
    const created = await createCalendar({
      workspaceId,
      name,
      ...data,
      actor: {
        actorId: c.get("userId"),
        actorType: apiKey ? "api_key" : "person",
        apiKeyId: apiKey?.id ?? null,
      },
    });
    return c.json(calendarSchema.parse(created), 200);
  })
  .openapi(detailRoute, async (c) => {
    const row = await getCalendar(
      c.req.valid("param").id,
      c.get("workspaceId"),
    );
    if (!row)
      throw new HTTPException(404, { message: "Service calendar not found" });
    return c.json(calendarSchema.parse(row), 200);
  })
  .openapi(updateRouteDef, async (c) => {
    const id = c.req.valid("param").id;
    const input = c.req.valid("json");
    const ifMatch = c.req.valid("header")["if-match"];
    const assertedVersion =
      ifMatch === undefined ? undefined : Number(ifMatch.slice(1, -1));
    const existing = await getCalendar(id, c.get("workspaceId"));
    if (!existing)
      throw new HTTPException(404, { message: "Service calendar not found" });
    const next = {
      timezone: input.timezone ?? existing.timezone,
      windows: input.windows ?? existing.windows,
      holidays: input.holidays ?? existing.holidays,
    };
    calendarValue(next);
    const apiKey = c.get("apiKey");
    let result: Awaited<ReturnType<typeof updateCalendar>> | undefined;
    try {
      result = await updateCalendar(
        id,
        c.get("workspaceId"),
        input,
        assertedVersion,
        {
          actorId: c.get("userId"),
          actorType: apiKey ? "api_key" : "person",
          apiKeyId: apiKey?.id ?? null,
        },
      );
    } catch (error) {
      if (error instanceof ServiceCalendarVersionConflictError) {
        return c.json(
          {
            message: error.message,
            assertedVersion: error.assertedVersion,
            currentVersion: error.currentVersion,
          },
          409,
        );
      }
      throw error;
    }
    if (!result)
      throw new HTTPException(404, { message: "Service calendar not found" });
    return c.json(calendarSchema.parse(result.row), 200);
  })
  .openapi(previewRoute, async (c) => {
    const row = await getCalendar(
      c.req.valid("param").id,
      c.get("workspaceId"),
    );
    if (!row)
      throw new HTTPException(404, { message: "Service calendar not found" });
    const calendar = calendarValue(row);
    const year = c.req.valid("query").year;
    return c.json(
      {
        calendarId: row.id,
        year,
        weeklyCoverMinutes: weeklyCoverMinutes(calendar),
        annualCoverMinutes: annualCoverMinutes(calendar, year),
        hasCover: calendarHasCover(calendar),
      },
      200,
    );
  });

export default router;
