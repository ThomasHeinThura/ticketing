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
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { COST_ENTRY_DELETION_ROUTE } from "./cost-deletion-target";
import {
  type CostEntryRow,
  type CostTypeRow,
  costEntriesByCurrency,
  createAvailableHours,
  createCostEntry,
  createCostType,
  getCostEntry,
  listAvailableHours,
  listCapacityPeople,
  listCostEntries,
  listCostTypes,
  updateCostEntry,
  updateCostType,
} from "./cost-repository";
import {
  assertTrackingEnabledForProject,
  COST_TRACKING_FEATURE_KEY,
  TIME_TRACKING_FEATURE_KEY,
} from "./feature";
import {
  actorOf,
  canSeeRates,
  costEntryReach,
  holds,
  holdsAtProject,
  identityOf,
  requireCostTracking,
  requireTimeTracking,
} from "./http";
import {
  backdateLimitDays,
  callerClock,
  loadReachableProject,
} from "./repository";
import {
  availableHoursListSchema,
  availableHoursSchema,
  costEntrySchema,
  costTypeListSchema,
  costTypeSchema,
  projectCostsSchema,
} from "./response";
import {
  costEntryIdParam,
  costTypeIdParam,
  createAvailableHoursBody,
  createCostEntryBody,
  createCostTypeBody,
  listAvailableHoursQuery,
  listCostTypesQuery,
  projectCostsQuery,
  projectIdParam,
  updateCostEntryBody,
  updateCostTypeBody,
  workspaceIdQuery,
} from "./schema";

type Vars = BaseVariables & { workspaceId: string };

/** Rate and amount leave the server only for `time_entry:manage_rates` holders (TC-11). */
function costEntryDto(row: CostEntryRow, showAmounts: boolean) {
  const { rateMinor, amountMinor, ...rest } = row;
  return showAmounts ? { ...rest, rateMinor, amountMinor } : rest;
}

function costTypeDto(row: CostTypeRow) {
  return row;
}

const listCostTypesRoute = createRoute({
  method: "get",
  path: "/cost-types",
  operationId: "listCostTypes",
  tags: ["Time"],
  summary: "List cost types",
  description:
    "TC-12: the workspace's cost types (name, unit, default rate, currency, billable). time_entry:manage_rates.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspaceCapability("time_entry:manage_rates"),
    requireCostTracking,
  ] as const,
  request: { query: listCostTypesQuery },
  responses: {
    200: jsonResponse("Cost types", costTypeListSchema),
    403: errorResponse("Missing time_entry:manage_rates"),
    409: errorResponse("feature.cost_tracking is off"),
  },
});

const createCostTypeRoute = createRoute({
  method: "post",
  path: "/cost-types",
  operationId: "createCostType",
  tags: ["Time"],
  summary: "Add a cost type",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspaceCapability("time_entry:manage_rates"),
    requireCostTracking,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createCostTypeBody } },
    },
  },
  responses: {
    201: jsonResponse("Created", costTypeSchema),
    403: errorResponse("Missing time_entry:manage_rates"),
    409: errorResponse("Name taken, or the feature is off"),
  },
});

const updateCostTypeRoute = createRoute({
  method: "patch",
  path: "/cost-types/{id}",
  operationId: "updateCostType",
  tags: ["Time"],
  summary: "Edit or archive a cost type",
  description:
    "Changing the default rate never rewrites logged cost: each entry captured its own rate (TC-13). Archiving hides the type from new entries.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspaceCapability("time_entry:manage_rates"),
    requireCostTracking,
  ] as const,
  request: {
    params: costTypeIdParam,
    query: workspaceIdQuery,
    body: {
      required: true,
      content: { "application/json": { schema: updateCostTypeBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated", costTypeSchema),
    403: errorResponse("Missing time_entry:manage_rates"),
    404: errorResponse("Cost type not found"),
    409: errorResponse("Name taken, or the feature is off"),
  },
});

const listCostsRoute = createRoute({
  method: "get",
  path: "/projects/{projectId}/costs",
  operationId: "listProjectCosts",
  tags: ["Time"],
  summary: "A project's cost entries",
  description:
    "TC-14: cost entries on the project or any of its work items; with `workItemId`, that item and its sub-items. Rate, amount and totals appear only for time_entry:manage_rates; everyone with budget:read sees what was bought and when.",
  middleware: [
    workspaceAccess.fromProject("projectId", { requireProjectReach: true }),
    requireCostTracking,
  ] as const,
  request: { params: projectIdParam, query: projectCostsQuery },
  responses: {
    200: jsonResponse("Cost entries", projectCostsSchema),
    403: errorResponse("Missing budget:read"),
    404: errorResponse("Project not found or out of reach"),
    409: errorResponse("feature.cost_tracking is off"),
  },
});

const createCostRoute = createRoute({
  method: "post",
  path: "/projects/{projectId}/costs",
  operationId: "createProjectCost",
  tags: ["Time"],
  summary: "Log a cost entry",
  description:
    "TC-13/TC-14: units of a cost type on a date, on the project or one of its work items. The rate (default: the type's) is captured on the row. Dates follow the time-entry backdating window.",
  middleware: [
    workspaceAccess.fromProject("projectId", { requireProjectReach: true }),
    requireCostTracking,
  ] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createCostEntryBody } },
    },
  },
  responses: {
    201: jsonResponse("The created entry", costEntrySchema),
    403: errorResponse("Missing time_entry:manage_rates"),
    404: errorResponse("Project or work item not found or out of reach"),
    409: errorResponse("feature.cost_tracking is off"),
    422: errorResponse("Date outside the window, no rate, or unavailable type"),
  },
});

const updateCostEntryRoute = createRoute({
  method: "patch",
  path: "/cost-entries/{id}",
  operationId: "updateCostEntry",
  tags: ["Time"],
  summary: "Edit a cost entry",
  description:
    "The captured rate stays with the entry unless the request sets a new one.",
  middleware: [
    costEntryReach,
    requireWorkspaceCapability("time_entry:manage_rates"),
    requireCostTracking,
  ] as const,
  request: {
    params: costEntryIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateCostEntryBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated entry", costEntrySchema),
    403: errorResponse("Missing time_entry:manage_rates"),
    404: errorResponse("Cost entry not found"),
    409: errorResponse("feature.cost_tracking is off"),
    422: errorResponse("Date outside the window, or unavailable type"),
  },
});

const deleteCostEntryRoute = createRoute({
  method: "delete",
  path: "/cost-entries/{id}",
  operationId: "deleteCostEntry",
  tags: ["Time"],
  summary: "Delete a cost entry",
  description: "Request deletion (202 pending action, click approval).",
  middleware: [
    costEntryReach,
    requireWorkspaceCapability("time_entry:manage_rates"),
    requireCostTracking,
  ] as const,
  request: { params: costEntryIdParam },
  responses: {
    202: jsonResponse(
      "Deletion awaiting approval",
      registeredDeletionRequestSchema,
    ),
    403: errorResponse("Missing time_entry:manage_rates"),
    404: errorResponse("Cost entry not found"),
    409: errorResponse("feature.cost_tracking is off"),
  },
});

const listAvailableHoursRoute = createRoute({
  method: "get",
  path: "/available-hours",
  operationId: "listAvailableHours",
  tags: ["Time"],
  summary: "Per-person available hours",
  description:
    "TC-20: a person's capacity in minutes per week with effective dates. Your own rows with time_entry:create; everyone's with workspace:manage_settings or time_entry:read_any.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspaceCapability("time_entry:create"),
    requireTimeTracking,
  ] as const,
  request: { query: listAvailableHoursQuery },
  responses: {
    200: jsonResponse("Available hours", availableHoursListSchema),
    403: errorResponse("Another person's hours need time_entry:read_any"),
    409: errorResponse("feature.time_tracking is off"),
  },
});

const createAvailableHoursRoute = createRoute({
  method: "post",
  path: "/available-hours",
  operationId: "createAvailableHours",
  tags: ["Time"],
  summary: "Set a person's available hours from a date",
  description:
    "Append-only history: the latest row on or before a day applies to that day. Capacity feeds the utilisation and capacity reports only; nothing assigns work from it (TC-22).",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspaceCapability("workspace:manage_settings"),
    requireTimeTracking,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createAvailableHoursBody } },
    },
  },
  responses: {
    201: jsonResponse("Created", availableHoursSchema),
    403: errorResponse("Missing workspace:manage_settings"),
    404: errorResponse("Person not found"),
    409: errorResponse(
      "A row already starts on that date, or the feature is off",
    ),
  },
});

async function projectOrThrow(
  identity: Awaited<ReturnType<typeof identityOf>>,
  workspaceId: string,
  projectId: string,
) {
  const project = await loadReachableProject(db, identity, projectId);
  if (!project || project.workspaceId !== workspaceId)
    throw new HTTPException(404, { message: "Project not found" });
  // Project-level switches count: a project can turn cost tracking off inside a workspace that has it on.
  await assertTrackingEnabledForProject(
    workspaceId,
    projectId,
    TIME_TRACKING_FEATURE_KEY,
    COST_TRACKING_FEATURE_KEY,
  );
  return project;
}

const router = apiRouter<Vars>()
  .openapi(listCostTypesRoute, async (c) => {
    const query = c.req.valid("query");
    return c.json(
      {
        data: (
          await listCostTypes(query.workspaceId, query.includeArchived)
        ).map(costTypeDto),
      },
      200,
    );
  })
  .openapi(createCostTypeRoute, async (c) => {
    const body = c.req.valid("json");
    const row = await createCostType({
      workspaceId: body.workspaceId,
      name: body.name,
      unit: body.unit,
      defaultRateMinor: body.defaultRateMinor,
      currency: body.currency,
      billable: body.billable,
      actor: actorOf(c),
    });
    return c.json(costTypeDto(row), 201);
  })
  .openapi(updateCostTypeRoute, async (c) => {
    const updated = await updateCostType(
      c.req.valid("param").id,
      c.req.valid("query").workspaceId,
      c.req.valid("json"),
      actorOf(c),
    );
    if (!updated)
      throw new HTTPException(404, { message: "Cost type not found" });
    return c.json(costTypeDto(updated), 200);
  })
  .openapi(listCostsRoute, async (c) => {
    const identity = await identityOf(c);
    const { projectId } = c.req.valid("param");
    const query = c.req.valid("query");
    const workspaceId = c.get("workspaceId");
    await projectOrThrow(identity, workspaceId, projectId);
    const showAmounts = await canSeeRates(c);
    // Writes are decided at the project (a project role may override the workspace role there).
    const canWrite =
      showAmounts &&
      (await holdsAtProject(
        identity,
        "time_entry:manage_rates",
        workspaceId,
        projectId,
      ));
    const rows = await listCostEntries(identity, {
      workspaceId,
      projectId,
      workItemId: query.workItemId,
      from: query.from,
      to: query.to,
    });
    const clock = await callerClock(db, identity.personId);
    return c.json(
      {
        data: rows.map((row) => costEntryDto(row, showAmounts)),
        canManage: canWrite,
        ...(canWrite
          ? {
              costTypes: (await listCostTypes(workspaceId, false)).map(
                costTypeDto,
              ),
            }
          : {}),
        ...(showAmounts
          ? {
              totals: await costEntriesByCurrency(
                {
                  workspaceId,
                  projectId,
                  workItemId: query.workItemId,
                  from: query.from,
                  to: query.to,
                },
                identity,
              ),
            }
          : {}),
        entryCount: rows.length,
        canLogBackdated: await holds(c, "time_entry:log_backdated"),
        backdateLimitDays: await backdateLimitDays(db, workspaceId),
        callerPersonId: identity.personId,
        today: clock.today,
      },
      200,
    );
  })
  .openapi(createCostRoute, async (c) => {
    const identity = await identityOf(c);
    const { projectId } = c.req.valid("param");
    const body = c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    const id = await createCostEntry({
      identity,
      actor: actorOf(c),
      workspaceId,
      projectId,
      workItemId: body.workItemId,
      costTypeId: body.costTypeId,
      personId: body.personId ?? identity.personId,
      date: body.date,
      units: body.units,
      rateMinor: body.rateMinor,
      currency: body.currency,
      billable: body.billable,
      note: body.note,
      canLogBackdated: await holds(c, "time_entry:log_backdated"),
    });
    const row = await getCostEntry(identity, id);
    if (!row) throw new HTTPException(404, { message: "Cost entry not found" });
    return c.json(costEntryDto(row, await canSeeRates(c)), 201);
  })
  .openapi(updateCostEntryRoute, async (c) => {
    const identity = await identityOf(c);
    const id = c.req.valid("param").id;
    const updated = await updateCostEntry({
      identity,
      actor: actorOf(c),
      id,
      workspaceId: c.get("workspaceId"),
      changes: c.req.valid("json"),
      canLogBackdated: await holds(c, "time_entry:log_backdated"),
    });
    if (!updated)
      throw new HTTPException(404, { message: "Cost entry not found" });
    const row = await getCostEntry(identity, updated);
    if (!row) throw new HTTPException(404, { message: "Cost entry not found" });
    return c.json(costEntryDto(row, await canSeeRates(c)), 200);
  })
  .openapi(deleteCostEntryRoute, async (c) => {
    const id = c.req.valid("param").id;
    const identity = await identityOf(c);
    if (!(await getCostEntry(identity, id)))
      throw new HTTPException(404, { message: "Cost entry not found" });
    const pending = await requestRegisteredDeletion(c, {
      routeKey: COST_ENTRY_DELETION_ROUTE,
      targetType: "cost_entry",
      id,
      workspaceId: c.get("workspaceId"),
    });
    return c.json(pending, 202);
  })
  .openapi(listAvailableHoursRoute, async (c) => {
    const identity = await identityOf(c);
    const query = c.req.valid("query");
    const canManage = await holds(c, "workspace:manage_settings");
    const canReadAny = canManage || (await holds(c, "time_entry:read_any"));
    if (query.personId && query.personId !== identity.personId && !canReadAny)
      throw new HTTPException(403, { message: "Insufficient permissions" });
    const personIds = query.personId
      ? [query.personId]
      : canManage
        ? null
        : [identity.personId];
    return c.json(
      {
        data: await listAvailableHours(query.workspaceId, personIds),
        canManage,
        people: canManage ? await listCapacityPeople(query.workspaceId) : [],
        callerPersonId: identity.personId,
      },
      200,
    );
  })
  .openapi(createAvailableHoursRoute, async (c) => {
    const body = c.req.valid("json");
    return c.json(
      await createAvailableHours({ ...body, actor: actorOf(c) }),
      201,
    );
  });

export default router;
