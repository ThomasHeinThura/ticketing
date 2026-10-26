import type { Context } from "hono";
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
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { requireWorkItemReach } from "../work-item/require-work-item-reach";
import {
  authoriseProject,
  cycleRowReach,
  holds,
  moduleRowReach,
  projectFromKeyParam,
} from "./access";
import {
  addItemsToCycle,
  type CycleOverlapError,
  completeCycle,
  createCycle,
  cycleBurndown,
  cycleDetail,
  getCycleById,
  listCycles,
  CycleOverlapError as OverlapError,
  removeItemFromCycle,
  setItemCycle,
  updateCycle,
} from "./cycle.repository";
import { CYCLE_DELETION_ROUTE, MODULE_DELETION_ROUTE } from "./deletion-target";
import {
  applyEstimateChange,
  type EstimateChangePreview,
  EstimateConfirmationError,
  getEstimateAndSettings,
  getProjectAgileSettings,
  getWorkItemEstimateFor,
  previewEstimateChange,
  setAgileSettings,
  setWorkItemEstimate,
  VersionConflictError,
} from "./estimate.repository";
import { requireAgileFeature } from "./feature";
import { DEFAULT_SCALES } from "./logic";
import {
  addItemsToModule,
  createModule,
  getModuleById,
  leadCandidatesFor,
  listModules,
  type ModuleView,
  moduleView,
  removeItemFromModule,
  setItemModule,
  updateModule,
} from "./module.repository";
import { listProjectDependencies } from "./relations.repository";
import {
  agileSettingsSchema,
  burndownSchema,
  completeCycleResponseSchema,
  cycleDetailSchema,
  cycleItemsResultSchema,
  cycleListSchema,
  cycleOverlapSchema,
  cycleSchema,
  dependenciesSchema,
  estimateConfirmationSchema,
  estimateSchema,
  moduleDetailSchema,
  moduleListSchema,
  moduleSchema,
  updateEstimatesResponseSchema,
  versionConflictSchema,
  wipLimitSchema,
  wipLimitsSchema,
  workItemEstimateSchema,
} from "./response";
import {
  completeCycleBody,
  createCycleBody,
  createModuleBody,
  cycleItemParam,
  dependenciesQuery,
  idParam,
  projectKeyParam,
  setCycleBody,
  setEstimateBody,
  setModuleBody,
  setWipLimitBody,
  updateAgileSettingsBody,
  updateCycleBody,
  updateEstimatesBody,
  updateModuleBody,
  wipLimitParam,
  workItemKeyParam,
  workItemKeysBody,
} from "./schema";
import { listWipLimits, setWipLimit } from "./wip.repository";

/**
 * Cycles, modules and estimates routes. Mounted at `/` of the API router (like automation and
 * the work-item router), because the paths span several prefixes.
 */

type Vars = BaseVariables & { workspaceId: string; projectId: string };

function scopeOf(c: Context) {
  return {
    workspaceId: c.get("workspaceId") as string,
    projectId: c.get("projectId") as string,
  };
}

type CycleView = Awaited<ReturnType<typeof listCycles>>["cycles"][number];

function toCycle(view: Pick<CycleView, "row" | "status" | "summary">) {
  const { row } = view;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    status: view.status,
    completedAt: row.completedAt,
    version: row.version,
    summary: view.summary,
  };
}

function toModule(view: ModuleView) {
  return {
    id: view.row.id,
    workspaceId: view.row.workspaceId,
    projectId: view.row.projectId,
    name: view.row.name,
    description: view.row.description,
    lead: view.lead,
    state: view.row.state as z.infer<typeof moduleSchema>["state"],
    targetDate: view.row.targetDate,
    version: view.row.version,
    progress: view.progress,
    forecast: view.forecast,
  };
}

function overlapBody(error: CycleOverlapError) {
  return cycleOverlapSchema.parse({
    message: "cycle_overlap",
    conflictingCycle: {
      id: error.conflicting.id,
      name: error.conflicting.name,
      startDate: error.conflicting.startDate,
      endDate: error.conflicting.endDate,
    },
  });
}

function conflictBody(error: VersionConflictError) {
  return versionConflictSchema.parse({
    message: error.message,
    currentVersion: error.currentVersion,
  });
}

function previewBody(preview: EstimateChangePreview) {
  return {
    fromSystem: preview.fromSystem,
    toSystem: preview.toSystem,
    mapping: preview.plan.mapping,
    mappedItems: preview.plan.mappedItems,
    clearedItems: preview.plan.clearedItems,
    activeCycles: preview.activeCycles,
  };
}

async function estimateView(
  c: Context,
  scope: { workspaceId: string; projectId: string },
  canManage: boolean,
) {
  void c;
  const { estimate, settings } = await getEstimateAndSettings(scope.projectId);
  return estimateSchema.parse({
    system: estimate?.system ?? null,
    estimateId: estimate?.id ?? null,
    points: estimate?.points ?? [],
    defaults: {
      points: DEFAULT_SCALES.points.map((point) => point.value),
      categories: DEFAULT_SCALES.categories.map((point) => point.value),
      time: DEFAULT_SCALES.time.map((point) => point.value),
    },
    incompletePolicy: settings.incompletePolicy,
    canManage,
  });
}

// ---------------------------------------------------------------------------------------------
// Route definitions
// ---------------------------------------------------------------------------------------------

const listCyclesRoute = createRoute({
  method: "get",
  path: "/projects/{key}/cycles",
  operationId: "listCycles",
  tags: ["Cycles"],
  summary: "List a project's cycles with scope summary and velocity",
  middleware: [projectFromKeyParam] as const,
  request: { params: projectKeyParam },
  responses: {
    200: jsonResponse("Cycles, newest first", cycleListSchema),
    403: errorResponse("Missing project:read permission"),
    404: errorResponse("Project not found, or feature.cycles is off"),
  },
});
const createCycleRoute = createRoute({
  method: "post",
  path: "/projects/{key}/cycles",
  operationId: "createCycle",
  tags: ["Cycles"],
  summary: "Create a cycle",
  description:
    "Cycles may not overlap within a project (CY-2): an overlap is a 409 naming the conflicting cycle.",
  middleware: [projectFromKeyParam] as const,
  request: {
    params: projectKeyParam,
    body: {
      required: true,
      content: { "application/json": { schema: createCycleBody } },
    },
  },
  responses: {
    201: jsonResponse("The cycle", cycleSchema),
    403: errorResponse("Missing project:manage_settings permission"),
    404: errorResponse("Project not found, or feature.cycles is off"),
    409: jsonResponse("Overlaps another cycle", cycleOverlapSchema),
    422: errorResponse("Invalid dates"),
  },
});
const getCycleRoute = createRoute({
  method: "get",
  path: "/cycles/{id}",
  operationId: "getCycle",
  tags: ["Cycles"],
  summary:
    "Get a cycle with its scope summary, scope changes and completion preview",
  middleware: [cycleRowReach] as const,
  request: { params: idParam },
  responses: {
    200: jsonResponse("The cycle", cycleDetailSchema),
    403: errorResponse("Missing project:read permission"),
    404: errorResponse("Cycle not found, or feature.cycles is off"),
  },
});
const updateCycleRoute = createRoute({
  method: "patch",
  path: "/cycles/{id}",
  operationId: "updateCycle",
  tags: ["Cycles"],
  summary: "Rename a cycle or move its dates",
  description:
    "Status is derived and cannot be set. Dates of a completed cycle are frozen (409 cycle_completed).",
  middleware: [cycleRowReach] as const,
  request: {
    params: idParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateCycleBody } },
    },
  },
  responses: {
    200: jsonResponse("The cycle", cycleSchema),
    403: errorResponse("Missing project:manage_settings permission"),
    404: errorResponse("Cycle not found, or feature.cycles is off"),
    409: jsonResponse("Overlap or version conflict", cycleOverlapSchema),
    422: errorResponse("Invalid dates"),
  },
});
const deleteCycleRoute = createRoute({
  method: "delete",
  path: "/cycles/{id}",
  operationId: "requestCycleDeletion",
  tags: ["Cycles"],
  summary: "Request deletion of a cycle",
  description:
    "Opens a pending action (202, click approval). Items stay and lose their cycle; the scope log and snapshots go with the cycle.",
  middleware: [cycleRowReach] as const,
  request: { params: idParam },
  responses: {
    202: jsonResponse("Pending deletion", registeredDeletionRequestSchema),
    403: errorResponse("Missing project:manage_settings permission"),
    404: errorResponse("Cycle not found, or feature.cycles is off"),
  },
});
const completeCycleRoute = createRoute({
  method: "post",
  path: "/cycles/{id}/complete",
  operationId: "completeCycle",
  tags: ["Cycles"],
  summary: "Complete a cycle, handling its incomplete items",
  description:
    "Incomplete items move to the next cycle, move to the backlog, or stay, per the chosen policy (default: the project's setting). `dryRun` previews without changing anything. `next_cycle` with no next cycle is a 409 no_next_cycle.",
  middleware: [cycleRowReach] as const,
  request: {
    params: idParam,
    body: {
      required: true,
      content: { "application/json": { schema: completeCycleBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The completed (or previewed) cycle",
      completeCycleResponseSchema,
    ),
    403: errorResponse("Missing project:manage_settings permission"),
    404: errorResponse("Cycle not found, or feature.cycles is off"),
    409: errorResponse("Already completed, or no next cycle"),
  },
});
const addCycleItemsRoute = createRoute({
  method: "post",
  path: "/cycles/{id}/work-items",
  operationId: "addCycleWorkItems",
  tags: ["Cycles"],
  summary: "Add work items to a cycle (bulk)",
  description:
    "A work item belongs to at most one cycle (CY-4): an item in another cycle is moved here. Items outside the cycle's project are refused as not_found. Adding after the cycle ended is allowed and logged as retrospective.",
  middleware: [cycleRowReach] as const,
  request: {
    params: idParam,
    body: {
      required: true,
      content: { "application/json": { schema: workItemKeysBody } },
    },
  },
  responses: {
    200: jsonResponse("Per-item outcome", cycleItemsResultSchema),
    403: errorResponse("Missing work_item:update permission"),
    404: errorResponse("Cycle not found, or feature.cycles is off"),
  },
});
const removeCycleItemRoute = createRoute({
  method: "delete",
  path: "/cycles/{id}/work-items/{workItemKey}",
  operationId: "removeCycleWorkItem",
  tags: ["Cycles"],
  summary: "Remove a work item from a cycle",
  middleware: [cycleRowReach] as const,
  request: { params: cycleItemParam },
  responses: {
    200: jsonResponse("Removed", cycleItemsResultSchema),
    403: errorResponse("Missing work_item:update permission"),
    404: errorResponse("Cycle or item not found, or feature.cycles is off"),
  },
});
const burndownRoute = createRoute({
  method: "get",
  path: "/cycles/{id}/burndown",
  operationId: "getCycleBurndown",
  tags: ["Cycles"],
  summary: "Burndown series for a cycle",
  middleware: [cycleRowReach] as const,
  request: { params: idParam },
  responses: {
    200: jsonResponse("The burndown", burndownSchema),
    403: errorResponse("Missing project:read permission"),
    404: errorResponse("Cycle not found, or feature.cycles is off"),
  },
});

const listModulesRoute = createRoute({
  method: "get",
  path: "/projects/{key}/modules",
  operationId: "listModules",
  tags: ["Modules"],
  summary: "List a project's modules with progress and forecast",
  middleware: [projectFromKeyParam] as const,
  request: { params: projectKeyParam },
  responses: {
    200: jsonResponse("Modules", moduleListSchema),
    403: errorResponse("Missing project:read permission"),
    404: errorResponse("Project not found, or feature.modules is off"),
  },
});
const createModuleRoute = createRoute({
  method: "post",
  path: "/projects/{key}/modules",
  operationId: "createModule",
  tags: ["Modules"],
  summary: "Create a module",
  middleware: [projectFromKeyParam] as const,
  request: {
    params: projectKeyParam,
    body: {
      required: true,
      content: { "application/json": { schema: createModuleBody } },
    },
  },
  responses: {
    201: jsonResponse("The module", moduleSchema),
    403: errorResponse("Missing project:manage_settings permission"),
    404: errorResponse("Project not found, or feature.modules is off"),
    422: errorResponse("Invalid lead"),
  },
});
const getModuleRoute = createRoute({
  method: "get",
  path: "/modules/{id}",
  operationId: "getModule",
  tags: ["Modules"],
  summary: "Get a module",
  middleware: [moduleRowReach] as const,
  request: { params: idParam },
  responses: {
    200: jsonResponse("The module", moduleDetailSchema),
    403: errorResponse("Missing project:read permission"),
    404: errorResponse("Module not found, or feature.modules is off"),
  },
});
const updateModuleRoute = createRoute({
  method: "patch",
  path: "/modules/{id}",
  operationId: "updateModule",
  tags: ["Modules"],
  summary: "Edit a module",
  middleware: [moduleRowReach] as const,
  request: {
    params: idParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateModuleBody } },
    },
  },
  responses: {
    200: jsonResponse("The module", moduleSchema),
    403: errorResponse("Missing project:manage_settings permission"),
    404: errorResponse("Module not found, or feature.modules is off"),
    409: jsonResponse("Version conflict", versionConflictSchema),
    422: errorResponse("Invalid lead"),
  },
});
const deleteModuleRoute = createRoute({
  method: "delete",
  path: "/modules/{id}",
  operationId: "requestModuleDeletion",
  tags: ["Modules"],
  summary: "Request deletion of a module",
  description:
    "Opens a pending action (202, click approval). Items stay and lose their module.",
  middleware: [moduleRowReach] as const,
  request: { params: idParam },
  responses: {
    202: jsonResponse("Pending deletion", registeredDeletionRequestSchema),
    403: errorResponse("Missing project:manage_settings permission"),
    404: errorResponse("Module not found, or feature.modules is off"),
  },
});
const moduleItemsResultSchema = cycleItemsResultSchema
  .omit({ alreadyInCycle: true, movedFromOtherCycle: true })
  .extend({
    alreadyInModule: cycleItemsResultSchema.shape.added,
    movedFromOtherModule: cycleItemsResultSchema.shape.added,
  });
const addModuleItemsRoute = createRoute({
  method: "post",
  path: "/modules/{id}/work-items",
  operationId: "addModuleWorkItems",
  tags: ["Modules"],
  summary: "Add work items to a module (bulk)",
  description:
    "A work item belongs to at most one module (MO-2); modules and cycles are independent (MO-3).",
  middleware: [moduleRowReach] as const,
  request: {
    params: idParam,
    body: {
      required: true,
      content: { "application/json": { schema: workItemKeysBody } },
    },
  },
  responses: {
    200: jsonResponse("Per-item outcome", moduleItemsResultSchema),
    403: errorResponse("Missing work_item:update permission"),
    404: errorResponse("Module not found, or feature.modules is off"),
  },
});
const removeModuleItemRoute = createRoute({
  method: "delete",
  path: "/modules/{id}/work-items/{workItemKey}",
  operationId: "removeModuleWorkItem",
  tags: ["Modules"],
  summary: "Remove a work item from a module",
  middleware: [moduleRowReach] as const,
  request: { params: cycleItemParam },
  responses: {
    200: jsonResponse("Removed", moduleItemsResultSchema),
    403: errorResponse("Missing work_item:update permission"),
    404: errorResponse("Module or item not found, or feature.modules is off"),
  },
});

const getEstimatesRoute = createRoute({
  method: "get",
  path: "/projects/{key}/estimates",
  operationId: "getProjectEstimates",
  tags: ["Estimates"],
  summary: "The project's estimate system and scale",
  middleware: [projectFromKeyParam] as const,
  request: { params: projectKeyParam },
  responses: {
    200: jsonResponse("The estimate configuration", estimateSchema),
    403: errorResponse("Missing project:read permission"),
    404: errorResponse("Project not found, or feature.estimates is off"),
  },
});
const updateEstimatesRoute = createRoute({
  method: "patch",
  path: "/projects/{key}/estimates",
  operationId: "updateProjectEstimates",
  tags: ["Estimates"],
  summary: "Choose the estimate system or edit its scale",
  description:
    "At most one system per project (ES-1). Changing the system maps estimates where an equivalent exists and clears the rest (ES-3). `dryRun` returns the preview and changes nothing; applying a change that clears estimates needs `confirmClear: true`, otherwise 409 with the preview.",
  middleware: [projectFromKeyParam] as const,
  request: {
    params: projectKeyParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateEstimatesBody } },
    },
  },
  responses: {
    200: jsonResponse("Applied or previewed", updateEstimatesResponseSchema),
    403: errorResponse("Missing project:manage_settings permission"),
    404: errorResponse("Project not found, or feature.estimates is off"),
    409: jsonResponse("Clears estimates; confirm", estimateConfirmationSchema),
    422: errorResponse("Invalid scale"),
  },
});
const getSettingsRoute = createRoute({
  method: "get",
  path: "/projects/{key}/agile-settings",
  operationId: "getAgileSettings",
  tags: ["Cycles"],
  summary: "The project's cycle completion default",
  middleware: [projectFromKeyParam] as const,
  request: { params: projectKeyParam },
  responses: {
    200: jsonResponse("Settings", agileSettingsSchema),
    403: errorResponse("Missing project:read permission"),
    404: errorResponse("Project not found, or feature.cycles is off"),
  },
});
const updateSettingsRoute = createRoute({
  method: "patch",
  path: "/projects/{key}/agile-settings",
  operationId: "updateAgileSettings",
  tags: ["Cycles"],
  summary: "Set the project's incomplete-item default for cycle completion",
  middleware: [projectFromKeyParam] as const,
  request: {
    params: projectKeyParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateAgileSettingsBody } },
    },
  },
  responses: {
    200: jsonResponse("Settings", agileSettingsSchema),
    403: errorResponse("Missing project:manage_settings permission"),
    404: errorResponse("Project not found, or feature.cycles is off"),
    409: jsonResponse("Version conflict", versionConflictSchema),
  },
});

const dependenciesRoute = createRoute({
  method: "get",
  path: "/projects/{key}/dependencies",
  operationId: "listProjectDependencies",
  tags: ["Views"],
  summary:
    "Dependency edges (blocks, precedes) between a project's work items (VW-28)",
  middleware: [projectFromKeyParam] as const,
  request: { params: projectKeyParam, query: dependenciesQuery },
  responses: {
    200: jsonResponse("Edges, oldest first (at most 2000)", dependenciesSchema),
    403: errorResponse("Missing work_item:read permission"),
    404: errorResponse("Project not found"),
  },
});
const listWipRoute = createRoute({
  method: "get",
  path: "/projects/{key}/wip-limits",
  operationId: "listWipLimits",
  tags: ["Views"],
  summary: "Board column work-in-progress limits (VW-12)",
  description:
    "Columns map to states; a state with no row has no limit. Not behind a feature flag: it is part of the board.",
  middleware: [projectFromKeyParam] as const,
  request: { params: projectKeyParam },
  responses: {
    200: jsonResponse("Limits by state", wipLimitsSchema),
    403: errorResponse("Missing project:read permission"),
    404: errorResponse("Project not found"),
  },
});
const setWipRoute = createRoute({
  method: "put",
  path: "/projects/{key}/wip-limits/{stateId}",
  operationId: "setWipLimit",
  tags: ["Views"],
  summary: "Set or clear a board column's work-in-progress limit",
  middleware: [projectFromKeyParam] as const,
  request: {
    params: wipLimitParam,
    body: {
      required: true,
      content: { "application/json": { schema: setWipLimitBody } },
    },
  },
  responses: {
    200: jsonResponse("The limit", wipLimitSchema),
    403: errorResponse("Missing project:manage_settings permission"),
    404: errorResponse("Project or state not found"),
  },
});
const getItemEstimateRoute = createRoute({
  method: "get",
  path: "/work-items/{key}/estimate",
  operationId: "getWorkItemEstimate",
  tags: ["Estimates"],
  summary: "A work item's estimate with its roll-up",
  middleware: [
    requireWorkItemReach("key", { allowArchivedForRead: true }),
    requireWorkspaceCapability("work_item:read"),
  ] as const,
  request: { params: workItemKeyParam },
  responses: {
    200: jsonResponse("The estimate", workItemEstimateSchema),
    403: errorResponse("Missing work_item:read permission"),
    404: errorResponse("Work item not found, or feature.estimates is off"),
  },
});
const setItemEstimateRoute = createRoute({
  method: "put",
  path: "/work-items/{key}/estimate",
  operationId: "setWorkItemEstimate",
  tags: ["Estimates"],
  summary: "Set or clear a work item's estimate",
  middleware: [
    requireWorkItemReach("key", { deferApiKeyCapability: true }),
    requireWorkspaceCapability("work_item:update"),
  ] as const,
  request: {
    params: workItemKeyParam,
    body: {
      required: true,
      content: { "application/json": { schema: setEstimateBody } },
    },
  },
  responses: {
    200: jsonResponse("The estimate", workItemEstimateSchema),
    403: errorResponse("Missing work_item:update permission"),
    404: errorResponse("Work item not found, or feature.estimates is off"),
    422: errorResponse("The point is not in the project's scale"),
  },
});
const setItemCycleRoute = createRoute({
  method: "put",
  path: "/work-items/{key}/cycle",
  operationId: "setWorkItemCycle",
  tags: ["Cycles"],
  summary: "Move a work item into a cycle, or out of its cycle",
  middleware: [
    requireWorkItemReach("key", { deferApiKeyCapability: true }),
    requireWorkspaceCapability("work_item:update"),
  ] as const,
  request: {
    params: workItemKeyParam,
    body: {
      required: true,
      content: { "application/json": { schema: setCycleBody } },
    },
  },
  responses: {
    200: jsonResponse("Applied", cycleItemsResultSchema.pick({ added: true })),
    403: errorResponse("Missing work_item:update permission"),
    404: errorResponse(
      "Work item or cycle not found, or feature.cycles is off",
    ),
  },
});
const setItemModuleRoute = createRoute({
  method: "put",
  path: "/work-items/{key}/module",
  operationId: "setWorkItemModule",
  tags: ["Modules"],
  summary: "Move a work item into a module, or out of its module",
  middleware: [
    requireWorkItemReach("key", { deferApiKeyCapability: true }),
    requireWorkspaceCapability("work_item:update"),
  ] as const,
  request: {
    params: workItemKeyParam,
    body: {
      required: true,
      content: { "application/json": { schema: setModuleBody } },
    },
  },
  responses: {
    200: jsonResponse("Applied", cycleItemsResultSchema.pick({ added: true })),
    403: errorResponse("Missing work_item:update permission"),
    404: errorResponse(
      "Work item or module not found, or feature.modules is off",
    ),
  },
});

// ---------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------

async function cycleContext(
  c: Context,
  capability: "project:read" | "project:manage_settings" | "work_item:update",
) {
  const scope = scopeOf(c);
  const auth = await authoriseProject(c, scope, capability);
  await requireAgileFeature(
    "feature.cycles",
    scope.workspaceId,
    scope.projectId,
  );
  return { scope, ...auth };
}

async function moduleContext(
  c: Context,
  capability: "project:read" | "project:manage_settings" | "work_item:update",
) {
  const scope = scopeOf(c);
  const auth = await authoriseProject(c, scope, capability);
  await requireAgileFeature(
    "feature.modules",
    scope.workspaceId,
    scope.projectId,
  );
  return { scope, ...auth };
}

async function estimateContext(
  c: Context,
  capability: "project:read" | "project:manage_settings" | "work_item:update",
) {
  const scope = scopeOf(c);
  const auth = await authoriseProject(c, scope, capability);
  await requireAgileFeature(
    "feature.estimates",
    scope.workspaceId,
    scope.projectId,
  );
  return { scope, ...auth };
}

const router = apiRouter<Vars>()
  .openapi(listCyclesRoute, async (c) => {
    const { scope, identity, facts } = await cycleContext(c, "project:read");
    const result = await listCycles(scope, new Date());
    return c.json(
      cycleListSchema.parse({
        data: result.cycles.map(toCycle),
        meta: {
          unit: result.unit,
          velocity: result.velocity,
          incompletePolicy: result.incompletePolicy,
          canManage: holds(identity, facts, "project:manage_settings"),
          today: result.today,
        },
      }),
      200,
    );
  })
  .openapi(createCycleRoute, async (c) => {
    const { scope, actor } = await cycleContext(c, "project:manage_settings");
    try {
      const row = await createCycle(scope, c.req.valid("json"), actor);
      const detail = await cycleDetail(row, new Date());
      return c.json(cycleSchema.parse(toCycle(detail)), 201);
    } catch (error) {
      if (error instanceof OverlapError) return c.json(overlapBody(error), 409);
      throw error;
    }
  })
  .openapi(getCycleRoute, async (c) => {
    const { identity, facts } = await cycleContext(c, "project:read");
    const row = await getCycleById(c.req.valid("param").id);
    if (!row) throw new HTTPException(404, { message: "Cycle not found" });
    const detail = await cycleDetail(row, new Date());
    return c.json(
      cycleDetailSchema.parse({
        ...toCycle(detail),
        scopeChanges: detail.scopeChanges,
        completionPreview: detail.completionPreview,
        velocity: detail.velocity,
        discontinuities: detail.discontinuities,
        canManage: holds(identity, facts, "project:manage_settings"),
        canEditItems: holds(identity, facts, "work_item:update"),
      }),
      200,
    );
  })
  .openapi(updateCycleRoute, async (c) => {
    const { actor } = await cycleContext(c, "project:manage_settings");
    try {
      const row = await updateCycle(
        c.req.valid("param").id,
        c.req.valid("json"),
        actor,
      );
      if (!row) throw new HTTPException(404, { message: "Cycle not found" });
      return c.json(
        cycleSchema.parse(toCycle(await cycleDetail(row, new Date()))),
        200,
      );
    } catch (error) {
      if (error instanceof OverlapError) return c.json(overlapBody(error), 409);
      if (error instanceof VersionConflictError)
        return c.json(conflictBody(error) as never, 409);
      throw error;
    }
  })
  .openapi(deleteCycleRoute, async (c) => {
    const { scope } = await cycleContext(c, "project:manage_settings");
    const pending = await requestRegisteredDeletion(c, {
      routeKey: CYCLE_DELETION_ROUTE,
      targetType: "cycle",
      id: c.req.valid("param").id,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
    });
    return c.json(pending, 202);
  })
  .openapi(completeCycleRoute, async (c) => {
    const { actor } = await cycleContext(c, "project:manage_settings");
    const body = c.req.valid("json");
    const result = await completeCycle(
      c.req.valid("param").id,
      {
        policy: body.incompletePolicy,
        dryRun: body.dryRun === true,
        now: new Date(),
      },
      actor,
    );
    if (!result) throw new HTTPException(404, { message: "Cycle not found" });
    const now = new Date();
    const detail = await cycleDetail(result.row, now);
    return c.json(
      completeCycleResponseSchema.parse({
        dryRun: body.dryRun === true,
        cycle: toCycle({
          row: result.row,
          status: body.dryRun === true ? detail.status : "completed",
          summary: detail.summary,
        }),
        policy: result.policy,
        destinationCycle: result.destination
          ? {
              id: result.destination.id,
              name: result.destination.name,
              startDate: result.destination.startDate,
              endDate: result.destination.endDate,
            }
          : null,
        movedCount: result.movedCount,
        leftCount: result.leftCount,
      }),
      200,
    );
  })
  .openapi(addCycleItemsRoute, async (c) => {
    const { actor } = await cycleContext(c, "work_item:update");
    const result = await addItemsToCycle(
      c.req.valid("param").id,
      c.req.valid("json").workItemKeys,
      actor,
      new Date(),
    );
    if (!result) throw new HTTPException(404, { message: "Cycle not found" });
    return c.json(cycleItemsResultSchema.parse(result), 200);
  })
  .openapi(removeCycleItemRoute, async (c) => {
    const { actor } = await cycleContext(c, "work_item:update");
    const { id, workItemKey } = c.req.valid("param");
    const outcome = await removeItemFromCycle(
      id,
      workItemKey,
      actor,
      new Date(),
    );
    if (!outcome || outcome === "not_in_cycle")
      throw new HTTPException(404, { message: "Work item not in this cycle" });
    return c.json(
      cycleItemsResultSchema.parse({
        added: [],
        alreadyInCycle: [],
        movedFromOtherCycle: [],
        refused: [],
      }),
      200,
    );
  })
  .openapi(burndownRoute, async (c) => {
    await cycleContext(c, "project:read");
    const row = await getCycleById(c.req.valid("param").id);
    if (!row) throw new HTTPException(404, { message: "Cycle not found" });
    return c.json(
      burndownSchema.parse(await cycleBurndown(row, new Date())),
      200,
    );
  })
  .openapi(listModulesRoute, async (c) => {
    const { scope, identity, facts } = await moduleContext(c, "project:read");
    const canManage = holds(identity, facts, "project:manage_settings");
    const views = await listModules(scope, new Date());
    return c.json(
      moduleListSchema.parse({
        data: views.map(toModule),
        meta: {
          canManage,
          leadCandidates: canManage
            ? await leadCandidatesFor(scope.workspaceId)
            : [],
        },
      }),
      200,
    );
  })
  .openapi(createModuleRoute, async (c) => {
    const { scope, actor } = await moduleContext(c, "project:manage_settings");
    const row = await createModule(scope, c.req.valid("json"), actor);
    return c.json(
      moduleSchema.parse(toModule(await moduleView(row, new Date()))),
      201,
    );
  })
  .openapi(getModuleRoute, async (c) => {
    const { scope, identity, facts } = await moduleContext(c, "project:read");
    const row = await getModuleById(c.req.valid("param").id);
    if (!row) throw new HTTPException(404, { message: "Module not found" });
    const canManage = holds(identity, facts, "project:manage_settings");
    return c.json(
      moduleDetailSchema.parse({
        ...toModule(await moduleView(row, new Date())),
        canManage,
        canEditItems: holds(identity, facts, "work_item:update"),
        leadCandidates: canManage
          ? await leadCandidatesFor(scope.workspaceId)
          : [],
      }),
      200,
    );
  })
  .openapi(updateModuleRoute, async (c) => {
    const { actor } = await moduleContext(c, "project:manage_settings");
    try {
      const row = await updateModule(
        c.req.valid("param").id,
        c.req.valid("json"),
        actor,
      );
      if (!row) throw new HTTPException(404, { message: "Module not found" });
      return c.json(
        moduleSchema.parse(toModule(await moduleView(row, new Date()))),
        200,
      );
    } catch (error) {
      if (error instanceof VersionConflictError)
        return c.json(conflictBody(error) as never, 409);
      throw error;
    }
  })
  .openapi(deleteModuleRoute, async (c) => {
    const { scope } = await moduleContext(c, "project:manage_settings");
    const pending = await requestRegisteredDeletion(c, {
      routeKey: MODULE_DELETION_ROUTE,
      targetType: "module",
      id: c.req.valid("param").id,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
    });
    return c.json(pending, 202);
  })
  .openapi(addModuleItemsRoute, async (c) => {
    const { actor } = await moduleContext(c, "work_item:update");
    const result = await addItemsToModule(
      c.req.valid("param").id,
      c.req.valid("json").workItemKeys,
      actor,
      new Date(),
    );
    if (!result) throw new HTTPException(404, { message: "Module not found" });
    return c.json(moduleItemsResultSchema.parse(result), 200);
  })
  .openapi(removeModuleItemRoute, async (c) => {
    const { actor } = await moduleContext(c, "work_item:update");
    const { id, workItemKey } = c.req.valid("param");
    const outcome = await removeItemFromModule(
      id,
      workItemKey,
      actor,
      new Date(),
    );
    if (!outcome || outcome === "not_in_module")
      throw new HTTPException(404, { message: "Work item not in this module" });
    return c.json(
      moduleItemsResultSchema.parse({
        added: [],
        alreadyInModule: [],
        movedFromOtherModule: [],
        refused: [],
      }),
      200,
    );
  })
  .openapi(getEstimatesRoute, async (c) => {
    const { scope, identity, facts } = await estimateContext(c, "project:read");
    return c.json(
      await estimateView(
        c,
        scope,
        holds(identity, facts, "project:manage_settings"),
      ),
      200,
    );
  })
  .openapi(updateEstimatesRoute, async (c) => {
    const { scope, actor, identity, facts } = await estimateContext(
      c,
      "project:manage_settings",
    );
    const body = c.req.valid("json");
    const input = { system: body.system, points: body.points };
    try {
      if (body.dryRun === true) {
        const preview = await previewEstimateChange(scope, input, new Date());
        return c.json(
          updateEstimatesResponseSchema.parse({
            applied: false,
            preview: previewBody(preview),
            estimate: await estimateView(c, scope, true),
          }),
          200,
        );
      }
      const result = await applyEstimateChange(
        scope,
        input,
        { confirmClear: body.confirmClear === true, now: new Date() },
        actor,
      );
      return c.json(
        updateEstimatesResponseSchema.parse({
          applied: result.applied,
          preview: previewBody(result.preview),
          estimate: await estimateView(
            c,
            scope,
            holds(identity, facts, "project:manage_settings"),
          ),
        }),
        200,
      );
    } catch (error) {
      if (error instanceof EstimateConfirmationError)
        return c.json(
          estimateConfirmationSchema.parse({
            message: "estimate_change_requires_confirmation",
            preview: previewBody(error.preview),
          }),
          409,
        );
      throw error;
    }
  })
  .openapi(getSettingsRoute, async (c) => {
    const { scope } = await cycleContext(c, "project:read");
    return c.json(
      agileSettingsSchema.parse(await getProjectAgileSettings(scope.projectId)),
      200,
    );
  })
  .openapi(updateSettingsRoute, async (c) => {
    const { scope, actor } = await cycleContext(c, "project:manage_settings");
    const body = c.req.valid("json");
    try {
      return c.json(
        agileSettingsSchema.parse(await setAgileSettings(scope, body, actor)),
        200,
      );
    } catch (error) {
      if (error instanceof VersionConflictError)
        return c.json(conflictBody(error) as never, 409);
      throw error;
    }
  })
  .openapi(dependenciesRoute, async (c) => {
    const scope = scopeOf(c);
    await authoriseProject(c, scope, "work_item:read");
    const requested = c.req.valid("query").types;
    return c.json(
      dependenciesSchema.parse({
        data: await listProjectDependencies(
          scope.projectId,
          requested.length ? requested : ["blocks", "precedes"],
        ),
      }),
      200,
    );
  })
  .openapi(listWipRoute, async (c) => {
    const scope = scopeOf(c);
    const { identity, facts } = await authoriseProject(
      c,
      scope,
      "project:read",
    );
    return c.json(
      wipLimitsSchema.parse({
        data: await listWipLimits(scope.projectId),
        canManage: holds(identity, facts, "project:manage_settings"),
      }),
      200,
    );
  })
  .openapi(setWipRoute, async (c) => {
    const scope = scopeOf(c);
    const { actor } = await authoriseProject(
      c,
      scope,
      "project:manage_settings",
    );
    const result = await setWipLimit(
      scope,
      c.req.valid("param").stateId,
      c.req.valid("json").limit,
      actor,
    );
    if (!result) throw new HTTPException(404, { message: "State not found" });
    return c.json(wipLimitSchema.parse(result), 200);
  })
  .openapi(getItemEstimateRoute, async (c) => {
    const scope = scopeOf(c);
    await requireAgileFeature(
      "feature.estimates",
      scope.workspaceId,
      scope.projectId,
    );
    await authoriseProject(c, scope, "work_item:read");
    return c.json(
      workItemEstimateSchema.parse(
        await getWorkItemEstimateFor({
          workItemId: c.get("workItemId" as never) as string,
          projectId: scope.projectId,
        }),
      ),
      200,
    );
  })
  .openapi(setItemEstimateRoute, async (c) => {
    const scope = scopeOf(c);
    await requireAgileFeature(
      "feature.estimates",
      scope.workspaceId,
      scope.projectId,
    );
    const { actor } = await authoriseProject(c, scope, "work_item:update");
    const workItemId = c.get("workItemId" as never) as string;
    await setWorkItemEstimate(
      {
        workItemId,
        projectId: scope.projectId,
        workspaceId: scope.workspaceId,
        estimatePointId: c.req.valid("json").estimatePointId,
      },
      actor,
    );
    return c.json(
      workItemEstimateSchema.parse(
        await getWorkItemEstimateFor({
          workItemId,
          projectId: scope.projectId,
        }),
      ),
      200,
    );
  })
  .openapi(setItemCycleRoute, async (c) => {
    const scope = scopeOf(c);
    await requireAgileFeature(
      "feature.cycles",
      scope.workspaceId,
      scope.projectId,
    );
    const { actor } = await authoriseProject(c, scope, "work_item:update");
    await setItemCycle(
      {
        projectId: scope.projectId,
        key: c.req.valid("param").key,
        cycleId: c.req.valid("json").cycleId,
      },
      actor,
      new Date(),
    );
    return c.json({ added: [] }, 200);
  })
  .openapi(setItemModuleRoute, async (c) => {
    const scope = scopeOf(c);
    await requireAgileFeature(
      "feature.modules",
      scope.workspaceId,
      scope.projectId,
    );
    const { actor } = await authoriseProject(c, scope, "work_item:update");
    await setItemModule(
      {
        projectId: scope.projectId,
        key: c.req.valid("param").key,
        moduleId: c.req.valid("json").moduleId,
      },
      actor,
      new Date(),
    );
    return c.json({ added: [] }, 200);
  });

export default router;
