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
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { TIME_ENTRY_DELETION_ROUTE } from "./deletion-target";
import {
  assertTrackingEnabledForProject,
  COST_TRACKING_FEATURE_KEY,
  TIME_TRACKING_FEATURE_KEY,
} from "./feature";
import {
  actorOf,
  canSeeRates,
  entryReach,
  holds,
  identityOf,
  requireCostTracking,
  requireEntryCapability,
  requireTimeTracking,
} from "./http";
import { costMinor, TIMER_CAP_MINUTES } from "./logic";
import {
  backdateLimitDays,
  callerClock,
  createActivity,
  createBudget,
  createEntry,
  createRate,
  type EntryRow,
  getEntriesByIds,
  getEntry,
  getTimer,
  getTimeSettings,
  listActivities,
  listBudgets,
  listEntries,
  listRatePeople,
  listRates,
  loadReachableProject,
  startTimer,
  stopTimerForPerson,
  summarise,
  updateActivity,
  updateEntry,
  updateTimeSettings,
} from "./repository";
import {
  activityListSchema,
  activitySchema,
  budgetResponseSchema,
  rateListSchema,
  rateSchema,
  summarySchema,
  timeEntryListSchema,
  timeEntrySchema,
  timerStateSchema,
  timerStopSchema,
  timeSettingsSchema,
} from "./response";
import {
  activityIdParam,
  createActivityBody,
  createBudgetBody,
  createEntryBody,
  createRateBody,
  entryIdParam,
  listActivitiesQuery,
  listEntriesQuery,
  listRatesQuery,
  projectIdParam,
  summaryQuery,
  timerStartBody,
  timerStopBody,
  timeSettingsQuery,
  updateActivityBody,
  updateEntryBody,
  updateTimeSettingsBody,
  workspaceIdQuery,
} from "./schema";

type Vars = BaseVariables & { workspaceId: string };

function entryDto(row: EntryRow, showRates: boolean) {
  const { rateMinor, currency, ...rest } = row;
  return {
    ...rest,
    ...(showRates
      ? {
          rate: {
            rateMinor,
            currency,
            costMinor: costMinor(row.minutes, rateMinor),
          },
        }
      : {}),
  };
}

const withTracking = [requireTimeTracking] as const;

const listEntriesRoute = createRoute({
  method: "get",
  path: "/time-entries",
  operationId: "listTimeEntries",
  tags: ["Time"],
  summary: "List time entries",
  description:
    "Own entries by default. Another person's entries (or `person=all`) need time_entry:read_any. Entries on projects the caller cannot reach are never returned. Rate and cost fields appear only for time_entry:manage_rates.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspaceCapability("time_entry:create"),
    ...withTracking,
    requireReachFilteredList,
  ] as const,
  request: { query: listEntriesQuery },
  responses: {
    200: jsonResponse("Entries", timeEntryListSchema),
    403: errorResponse("Missing time_entry:read_any for another person"),
    409: errorResponse("feature.time_tracking is off"),
  },
});

const createEntryRoute = createRoute({
  method: "post",
  path: "/time-entries",
  operationId: "createTimeEntryV2",
  tags: ["Time"],
  summary: "Log time against a work item",
  description:
    "TC-1..TC-4: integer minutes on a date, a required activity, billable defaulting from the project. A date more than the workspace backdating limit in the past needs time_entry:log_backdated; a future date is refused. The hourly rate effective on the entry's date is captured on the row.",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspaceCapability("time_entry:create"),
    ...withTracking,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createEntryBody } },
    },
  },
  responses: {
    201: jsonResponse("The created entry", timeEntrySchema),
    403: errorResponse("Logging for someone else needs time_entry:update_any"),
    404: errorResponse("Work item not found or out of reach"),
    409: errorResponse("feature.time_tracking is off"),
    422: errorResponse("Date outside the window, or unavailable activity"),
  },
});

const updateEntryRoute = createRoute({
  method: "patch",
  path: "/time-entries/{id}",
  operationId: "updateTimeEntryV2",
  tags: ["Time"],
  summary: "Edit a time entry",
  description:
    "Own entries need time_entry:update_own; anyone else's need time_entry:update_any. The captured rate stays with the entry unless its date or project changes.",
  middleware: [
    entryReach,
    requireEntryCapability("time_entry:update_any", "time_entry:update_own"),
    ...withTracking,
  ] as const,
  request: {
    params: entryIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateEntryBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated entry", timeEntrySchema),
    403: errorResponse("Not permitted to edit this entry"),
    404: errorResponse("Entry not found"),
    409: errorResponse("feature.time_tracking is off"),
    422: errorResponse("Date outside the window, or unavailable activity"),
  },
});

const deleteEntryRoute = createRoute({
  method: "delete",
  path: "/time-entries/{id}",
  operationId: "deleteTimeEntryV2",
  tags: ["Time"],
  summary: "Delete a time entry",
  description: "Request deletion (202 pending action, click approval).",
  middleware: [
    entryReach,
    requireEntryCapability("time_entry:delete_any", "time_entry:delete_own"),
    ...withTracking,
  ] as const,
  request: { params: entryIdParam },
  responses: {
    202: jsonResponse(
      "Deletion awaiting approval",
      registeredDeletionRequestSchema,
    ),
    403: errorResponse("Not permitted to delete this entry"),
    404: errorResponse("Entry not found"),
    409: errorResponse("feature.time_tracking is off"),
  },
});

const timerStateRoute = createRoute({
  method: "get",
  path: "/time-entries/timer",
  operationId: "getTimeEntryTimer",
  tags: ["Time"],
  summary: "The caller's running timer",
  description:
    "Survives a page reload: the timer lives on the server and carries its start instant.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspaceCapability("time_entry:create"),
    ...withTracking,
    requireReachFilteredList,
  ] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse("Timer state", timerStateSchema),
    409: errorResponse("feature.time_tracking is off"),
  },
});

const timerStartRoute = createRoute({
  method: "post",
  path: "/time-entries/timer/start",
  operationId: "startTimeEntryTimer",
  tags: ["Time"],
  summary: "Start the caller's timer",
  description: "One running timer per person; a second start is a 409.",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspaceCapability("time_entry:create"),
    ...withTracking,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: timerStartBody } },
    },
  },
  responses: {
    200: jsonResponse("Timer state", timerStateSchema),
    404: errorResponse("Work item not found or out of reach"),
    409: errorResponse("A timer is already running, or the feature is off"),
  },
});

const timerStopRoute = createRoute({
  method: "post",
  path: "/time-entries/timer/stop",
  operationId: "stopTimeEntryTimer",
  tags: ["Time"],
  summary: "Stop the caller's timer",
  description:
    "Records the elapsed time as entries. The server cuts the span at local midnight using the profile timezone, then the instance timezone, then UTC, and captures the rate effective on each piece's date. A span over 12 hours is capped and flagged for review.",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspaceCapability("time_entry:create"),
    ...withTracking,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: timerStopBody } },
    },
  },
  responses: {
    200: jsonResponse("The recorded entries", timerStopSchema),
    404: errorResponse("No running timer"),
    409: errorResponse("feature.time_tracking is off"),
  },
});

const summaryRoute = createRoute({
  method: "get",
  path: "/time-entries/summary",
  operationId: "summariseTimeEntries",
  tags: ["Time"],
  summary:
    "Time roll-up for a work item (with its descendants), a project, a cycle or a module",
  description:
    "Totals by activity and by person in minutes. Without time_entry:read_any every figure covers only the caller's own entries. Cost per currency (never summed across currencies) appears only for time_entry:manage_rates.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspaceCapability("time_entry:create"),
    ...withTracking,
    requireReachFilteredList,
  ] as const,
  request: { query: summaryQuery },
  responses: {
    200: jsonResponse("Roll-up", summarySchema),
    403: errorResponse("Missing time_entry:create"),
    409: errorResponse("feature.time_tracking is off"),
  },
});

const getSettingsRoute = createRoute({
  method: "get",
  path: "/time-settings",
  operationId: "getTimeSettings",
  tags: ["Time"],
  summary: "Time logging rules",
  description:
    "TC-4: the workspace's backdating limit. With `projectId`, TC-3: that project's billable default.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspaceCapability("time_entry:create"),
    ...withTracking,
  ] as const,
  request: { query: timeSettingsQuery },
  responses: {
    200: jsonResponse("Settings", timeSettingsSchema),
    409: errorResponse("feature.time_tracking is off"),
  },
});

const updateSettingsRoute = createRoute({
  method: "patch",
  path: "/time-settings",
  operationId: "updateTimeSettings",
  tags: ["Time"],
  summary: "Change the backdating limit or a project's billable default",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspaceCapability("workspace:manage_settings"),
    ...withTracking,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: updateTimeSettingsBody } },
    },
  },
  responses: {
    200: jsonResponse("Settings", timeSettingsSchema),
    403: errorResponse("Missing workspace:manage_settings"),
    404: errorResponse("Project not found or out of reach"),
    409: errorResponse("feature.time_tracking is off"),
  },
});

const listActivitiesRoute = createRoute({
  method: "get",
  path: "/time-activities",
  operationId: "listTimeActivities",
  tags: ["Time"],
  summary: "List activity types",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspaceCapability("time_entry:create"),
    ...withTracking,
  ] as const,
  request: { query: listActivitiesQuery },
  responses: {
    200: jsonResponse("Activities", activityListSchema),
    409: errorResponse("feature.time_tracking is off"),
  },
});

const createActivityRoute = createRoute({
  method: "post",
  path: "/time-activities",
  operationId: "createTimeActivity",
  tags: ["Time"],
  summary: "Add an activity type",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspaceCapability("workspace:manage_settings"),
    ...withTracking,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createActivityBody } },
    },
  },
  responses: {
    201: jsonResponse("Created", activitySchema),
    403: errorResponse("Missing workspace:manage_settings"),
    409: errorResponse("Name taken, or the feature is off"),
  },
});

const updateActivityRoute = createRoute({
  method: "patch",
  path: "/time-activities/{id}",
  operationId: "updateTimeActivity",
  tags: ["Time"],
  summary: "Rename, reorder or archive an activity type",
  description:
    "Archiving hides the type from new entries; logged time keeps it.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspaceCapability("workspace:manage_settings"),
    ...withTracking,
  ] as const,
  request: {
    params: activityIdParam,
    query: workspaceIdQuery,
    body: {
      required: true,
      content: { "application/json": { schema: updateActivityBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated", activitySchema),
    403: errorResponse("Missing workspace:manage_settings"),
    404: errorResponse("Activity not found"),
    409: errorResponse("Name taken, or the feature is off"),
  },
});

const listRatesRoute = createRoute({
  method: "get",
  path: "/rates",
  operationId: "listHourlyRates",
  tags: ["Time"],
  summary: "List hourly rates",
  description: "TC-11: only time_entry:manage_rates sees rates.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspaceCapability("time_entry:manage_rates"),
    requireCostTracking,
  ] as const,
  request: { query: listRatesQuery },
  responses: {
    200: jsonResponse("Rates", rateListSchema),
    403: errorResponse("Missing time_entry:manage_rates"),
    409: errorResponse("feature.cost_tracking is off"),
  },
});

const createRateRoute = createRoute({
  method: "post",
  path: "/rates",
  operationId: "createHourlyRate",
  tags: ["Time"],
  summary: "Add an hourly rate effective from a date",
  description:
    "Rates are append-only history. A new rate prices entries created or timers stopped from now on; entries already logged keep the rate captured when they were created.",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspaceCapability("time_entry:manage_rates"),
    requireCostTracking,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createRateBody } },
    },
  },
  responses: {
    201: jsonResponse("Created", rateSchema),
    403: errorResponse("Missing time_entry:manage_rates"),
    404: errorResponse("Person or project not found"),
    409: errorResponse("A rate already starts on that date"),
  },
});

const getBudgetRoute = createRoute({
  method: "get",
  path: "/projects/{projectId}/budget",
  operationId: "getProjectBudget",
  tags: ["Time"],
  summary: "A project's budgets: planned versus actual",
  description:
    "Actuals are time entries valued at the rate captured on each entry, per currency inside the budget period; other currencies are reported separately, never converted. Per-person figures are minutes only.",
  middleware: [
    workspaceAccess.fromProject("projectId", { requireProjectReach: true }),
    requireCostTracking,
  ] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Budgets", budgetResponseSchema),
    403: errorResponse("Missing budget:read"),
    404: errorResponse("Project not found or out of reach"),
    409: errorResponse("feature.cost_tracking is off"),
  },
});

const createBudgetRoute = createRoute({
  method: "post",
  path: "/projects/{projectId}/budgets",
  operationId: "createProjectBudget",
  tags: ["Time"],
  summary: "Create a project budget",
  middleware: [
    workspaceAccess.fromProject("projectId", { requireProjectReach: true }),
    requireCostTracking,
  ] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createBudgetBody } },
    },
  },
  responses: {
    201: jsonResponse("Created", budgetResponseSchema),
    403: errorResponse("Missing budget:manage"),
    404: errorResponse("Project not found or out of reach"),
    409: errorResponse("feature.cost_tracking is off"),
  },
});

/**
 * `canSeeItem` decides whether the work item's key and title may be shown: a timer that keeps
 * running after its owner lost reach to the project must not keep naming the item.
 */
async function timerState(
  personId: string,
  canSeeItem: (timer: {
    workspaceId: string;
    projectId: string;
  }) => Promise<boolean> = async () => true,
) {
  const timer = await getTimer(personId);
  const visible = timer ? await canSeeItem(timer) : true;
  return {
    timer: timer
      ? {
          workspaceId: timer.workspaceId,
          projectId: timer.projectId,
          workItemId: timer.workItemId,
          workItemKey: visible ? timer.workItemKey : null,
          workItemTitle: visible ? timer.workItemTitle : null,
          activityId: timer.activityId,
          activityName: timer.activityName,
          description: timer.description,
          billable: timer.billable,
          startedAt: timer.startedAt,
        }
      : null,
    serverNow: new Date(),
    capMinutes: TIMER_CAP_MINUTES,
  };
}

async function oneEntry(
  c: Parameters<typeof canSeeRates>[0],
  identity: Awaited<ReturnType<typeof identityOf>>,
  id: string,
) {
  const row = await getEntry(identity, id);
  if (!row) throw new HTTPException(404, { message: "Time entry not found" });
  return entryDto(row, await canSeeRates(c));
}

const router = apiRouter<Vars>()
  .openapi(listEntriesRoute, async (c) => {
    const identity = await identityOf(c);
    const query = c.req.valid("query");
    const canReadAny = await holds(c, "time_entry:read_any");
    const requested = query.person ?? identity.personId;
    const everyone = requested === "all";
    if ((everyone || requested !== identity.personId) && !canReadAny)
      throw new HTTPException(403, { message: "Insufficient permissions" });
    const rows = await listEntries(identity, {
      workspaceId: query.workspaceId,
      personId: everyone ? undefined : requested,
      from: query.from,
      to: query.to,
      workItemId: query.workItemId,
      projectId: query.projectId,
      needsReview: query.needsReview,
    });
    const showRates = await canSeeRates(c);
    const clock = await callerClock(db, identity.personId);
    return c.json(
      {
        data: rows.map((row) => entryDto(row, showRates)),
        totalMinutes: rows.reduce((sum, row) => sum + row.minutes, 0),
        callerPersonId: identity.personId,
        canReadAny,
        canUpdateAny: await holds(c, "time_entry:update_any"),
        canDeleteAny: await holds(c, "time_entry:delete_any"),
        canLogBackdated: await holds(c, "time_entry:log_backdated"),
        backdateLimitDays: await backdateLimitDays(db, query.workspaceId),
        timeZone: clock.timeZone,
        today: clock.today,
      },
      200,
    );
  })
  .openapi(createEntryRoute, async (c) => {
    const identity = await identityOf(c);
    const body = c.req.valid("json");
    const personId = body.personId ?? identity.personId;
    if (
      personId !== identity.personId &&
      !(await holds(c, "time_entry:update_any"))
    )
      throw new HTTPException(403, { message: "Insufficient permissions" });
    const id = await createEntry({
      identity,
      actor: actorOf(c),
      workspaceId: body.workspaceId,
      workItemId: body.workItemId,
      date: body.date,
      minutes: body.minutes,
      activityId: body.activityId,
      description: body.description,
      billable: body.billable,
      personId,
      canLogBackdated: await holds(c, "time_entry:log_backdated"),
    });
    return c.json(await oneEntry(c, identity, id), 201);
  })
  .openapi(updateEntryRoute, async (c) => {
    const identity = await identityOf(c);
    const id = c.req.valid("param").id;
    const updated = await updateEntry({
      identity,
      actor: actorOf(c),
      id,
      workspaceId: c.get("workspaceId"),
      changes: c.req.valid("json"),
      canLogBackdated: await holds(c, "time_entry:log_backdated"),
    });
    if (!updated)
      throw new HTTPException(404, { message: "Time entry not found" });
    return c.json(await oneEntry(c, identity, updated), 200);
  })
  .openapi(deleteEntryRoute, async (c) => {
    const id = c.req.valid("param").id;
    const identity = await identityOf(c);
    if (!(await getEntry(identity, id)))
      throw new HTTPException(404, { message: "Time entry not found" });
    const pending = await requestRegisteredDeletion(c, {
      routeKey: TIME_ENTRY_DELETION_ROUTE,
      targetType: "time_entry",
      id,
      workspaceId: c.get("workspaceId"),
    });
    return c.json(pending, 202);
  })
  .openapi(timerStateRoute, async (c) => {
    const reach = listReachOf(c);
    return c.json(
      await timerState((await identityOf(c)).personId, (timer) =>
        reach.reaches({
          projectId: timer.projectId,
          workspaceId: timer.workspaceId,
        }),
      ),
      200,
    );
  })
  .openapi(timerStartRoute, async (c) => {
    const identity = await identityOf(c);
    const body = c.req.valid("json");
    await startTimer({
      identity,
      actor: actorOf(c),
      workspaceId: body.workspaceId,
      workItemId: body.workItemId,
      activityId: body.activityId,
      description: body.description,
      billable: body.billable,
    });
    return c.json(await timerState(identity.personId), 200);
  })
  .openapi(timerStopRoute, async (c) => {
    const identity = await identityOf(c);
    const body = c.req.valid("json");
    const stopped = await stopTimerForPerson({
      personId: identity.personId,
      workspaceId: body.workspaceId,
      actor: actorOf(c),
      description: body.description,
      activityId: body.activityId,
    });
    if (!stopped) throw new HTTPException(404, { message: "No running timer" });
    const rows = await getEntriesByIds(identity, stopped.entryIds);
    const showRates = await canSeeRates(c);
    return c.json(
      {
        entries: rows.map((row) => entryDto(row, showRates)),
        capped: stopped.capped,
      },
      200,
    );
  })
  .openapi(summaryRoute, async (c) => {
    const identity = await identityOf(c);
    const query = c.req.valid("query");
    // Without time_entry:read_any every figure is the caller's own: totals, breakdowns and cost
    // never cover another person's minutes (matches the list route and the reports).
    const canReadAny = await holds(c, "time_entry:read_any");
    const summary = await summarise(identity, {
      ...query,
      ...(canReadAny ? {} : { personId: identity.personId }),
    });
    const showRates = await canSeeRates(c);
    return c.json(
      {
        scope: query.workItemId
          ? ("work_item" as const)
          : query.cycleId
            ? ("cycle" as const)
            : query.moduleId
              ? ("module" as const)
              : ("project" as const),
        from: query.from ?? null,
        to: query.to ?? null,
        totalMinutes: summary.totalMinutes,
        billableMinutes: summary.billableMinutes,
        entryCount: summary.entryCount,
        byActivity: summary.byActivity,
        byPerson: summary.byPerson,
        ...(showRates
          ? {
              cost: {
                byCurrency: summary.byCurrency,
                unpricedMinutes: summary.unpricedMinutes,
              },
            }
          : {}),
      },
      200,
    );
  })
  .openapi(getSettingsRoute, async (c) => {
    const identity = await identityOf(c);
    const query = c.req.valid("query");
    const settings = await getTimeSettings(
      identity,
      query.workspaceId,
      query.projectId,
    );
    return c.json(
      { ...settings, canManage: await holds(c, "workspace:manage_settings") },
      200,
    );
  })
  .openapi(updateSettingsRoute, async (c) => {
    const identity = await identityOf(c);
    const body = c.req.valid("json");
    await updateTimeSettings({
      identity,
      workspaceId: body.workspaceId,
      backdateLimitDays: body.backdateLimitDays,
      project: body.project,
      actor: actorOf(c),
    });
    const settings = await getTimeSettings(
      identity,
      body.workspaceId,
      body.project?.id,
    );
    return c.json({ ...settings, canManage: true }, 200);
  })
  .openapi(listActivitiesRoute, async (c) => {
    const query = c.req.valid("query");
    return c.json(
      { data: await listActivities(query.workspaceId, query.includeArchived) },
      200,
    );
  })
  .openapi(createActivityRoute, async (c) => {
    const body = c.req.valid("json");
    return c.json(await createActivity({ ...body, actor: actorOf(c) }), 201);
  })
  .openapi(updateActivityRoute, async (c) => {
    const updated = await updateActivity(
      c.req.valid("param").id,
      c.req.valid("query").workspaceId,
      c.req.valid("json"),
      actorOf(c),
    );
    if (!updated)
      throw new HTTPException(404, { message: "Activity not found" });
    return c.json(updated, 200);
  })
  .openapi(listRatesRoute, async (c) => {
    const query = c.req.valid("query");
    return c.json(
      {
        data: await listRates(query.workspaceId, query.personId),
        people: await listRatePeople(query.workspaceId),
      },
      200,
    );
  })
  .openapi(createRateRoute, async (c) => {
    const body = c.req.valid("json");
    const row = await createRate({
      workspaceId: body.workspaceId,
      personId: body.personId,
      projectId: body.projectId ?? null,
      rateMinor: body.rateMinor,
      currency: body.currency,
      effectiveFrom: body.effectiveFrom,
      actor: actorOf(c),
    });
    const named = (await listRates(body.workspaceId, body.personId)).find(
      (entry) => entry.id === row.id,
    );
    if (!named) throw new HTTPException(500, { message: "Rate not found" });
    return c.json(named, 201);
  })
  .openapi(getBudgetRoute, async (c) => {
    const identity = await identityOf(c);
    const { projectId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const project = await loadReachableProject(db, identity, projectId);
    if (!project)
      throw new HTTPException(404, { message: "Project not found" });
    // Project-level switches count: a project can turn cost tracking off inside a workspace that has it on.
    await assertTrackingEnabledForProject(
      workspaceId,
      projectId,
      TIME_TRACKING_FEATURE_KEY,
      COST_TRACKING_FEATURE_KEY,
    );
    return c.json(
      await budgetResponse(
        identity,
        workspaceId,
        projectId,
        await canSeeRates(c),
        await holds(c, "budget:manage"),
      ),
      200,
    );
  })
  .openapi(createBudgetRoute, async (c) => {
    const identity = await identityOf(c);
    const { projectId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const project = await loadReachableProject(db, identity, projectId);
    if (!project)
      throw new HTTPException(404, { message: "Project not found" });
    // Project-level switches count: a project can turn cost tracking off inside a workspace that has it on.
    await assertTrackingEnabledForProject(
      workspaceId,
      projectId,
      TIME_TRACKING_FEATURE_KEY,
      COST_TRACKING_FEATURE_KEY,
    );
    await createBudget({
      workspaceId,
      projectId,
      ...c.req.valid("json"),
      actor: actorOf(c),
    });
    return c.json(
      await budgetResponse(
        identity,
        workspaceId,
        projectId,
        await canSeeRates(c),
        await holds(c, "budget:manage"),
      ),
      201,
    );
  });

async function budgetResponse(
  identity: Awaited<ReturnType<typeof identityOf>>,
  workspaceId: string,
  projectId: string,
  showBreakdown: boolean,
  canManage: boolean,
) {
  // Without time_entry:manage_rates no figure derived from priced time leaves the server:
  // actual, remaining, other-currency cost, unpriced minutes and the threshold all move with a
  // colleague's entry, so polling them would reveal that person's rate (TC-11). The planned
  // amount is the budget's own setting, not rate data, and stays.
  const budgets = await listBudgets(
    identity,
    workspaceId,
    projectId,
    db,
    showBreakdown,
  );
  const summary = showBreakdown
    ? await summarise(identity, { workspaceId, projectId })
    : null;
  return {
    canManage,
    data: budgets.map(({ budget, actuals }) => ({
      id: budget.id,
      projectId: budget.projectId,
      name: budget.name,
      currency: budget.currency,
      periodStart: budget.periodStart,
      periodEnd: budget.periodEnd,
      plannedAmountMinor: budget.plannedAmountMinor,
      figuresHidden: actuals === null,
      ...(actuals
        ? {
            actualMinor: actuals.actualMinor,
            remainingMinor: budget.plannedAmountMinor - actuals.actualMinor,
            thresholdReached: actuals.threshold,
            otherCurrencies: actuals.otherCurrencies,
            unpricedMinutes: actuals.unpricedMinutes,
          }
        : {}),
      committedMinor: null,
      createdAt: budget.createdAt,
    })),
    // Minutes next to a cost total let a reader divide out a rate (TC-11), so the breakdowns are
    // shown only to callers who may see rates anyway.
    byActivity: summary?.byActivity ?? [],
    byPerson: summary?.byPerson ?? [],
  };
}

export default router;
