import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { runWithStepUp, stepUpTokenHeader } from "../auth/step-up-spend";
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
import { resolveRequestIdentity } from "../permissions/resolve-request-identity";
import { callerReach } from "../utils/caller-reach";
import {
  listReachOf,
  requireReachFilteredList,
} from "../utils/reach-filtered-list";
import { rejectNulByte } from "../utils/reject-nul-byte";
import { requireApiKeyPermissionScope } from "../utils/require-api-key-permission-scope";
import { requireSessionOnly } from "../utils/require-session-only";
import {
  assertCallerHasCapability,
  capabilityCredential,
  requireWorkspaceCapability,
} from "../utils/require-workspace-capability";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { requireWorkItemReach } from "../work-item/require-work-item-reach";
import {
  applyCabTemplate,
  CabTemplateError,
  cabTemplateStatus,
} from "./cab-template";
import {
  changeCalendar,
  createFreeze,
  getChange,
  getFreezeWorkspace,
  grantFreezeOverride,
  listFreezeOverrides,
  listFreezes,
  patchChange,
  resolveChangeTarget,
  updateFreeze,
} from "./change-repository";
import {
  actorOf,
  requireServiceCatalogue,
  serviceCatalogueEnabled,
  VersionConflictError,
} from "./common";
import { SERVICE_DELETION_ROUTE } from "./deletion-target";
import {
  createRelease,
  getReleaseDetail,
  getReleaseWorkspace,
  listReleases,
  setReleaseNotes,
  toggleChecklistItem,
  updateRelease,
} from "./release-repository";
import {
  cabTemplateConflictSchema,
  cabTemplateResultSchema,
  cabTemplateStatusSchema,
  catalogueStatusSchema,
  changeCalendarSchema,
  changeViewSchema,
  freezeListSchema,
  freezeWriteSchema,
  okSchema,
  overrideReportSchema,
  releaseDetailSchema,
  releaseListSchema,
  serviceDetailSchema,
  serviceImpactSchema,
  serviceListSchema,
  versionConflictSchema,
} from "./response";
import {
  applyCabTemplateBody,
  calendarQuery,
  createFreezeBody,
  createReleaseBody,
  createServiceBody,
  freezeListQuery,
  freezeOverrideBody,
  idParam,
  keyParam,
  patchChangeBody,
  releaseChecklistParam,
  releaseListQuery,
  releaseNotesBody,
  serviceListQuery,
  setServiceStatusBody,
  setWorkItemServiceBody,
  toggleChecklistBody,
  updateFreezeBody,
  updateReleaseBody,
  updateServiceBody,
  workspaceIdQuery,
} from "./schema";
import {
  createService,
  getServiceDetail,
  getServiceWorkspace,
  listServices,
  serviceDeletionBlockers,
  serviceImpact,
  setServiceStatus,
  setWorkItemService,
  updateService,
} from "./service-repository";

const MAX_CALENDAR_RANGE_MS = 400 * 24 * 60 * 60 * 1000;

/** Resolve a row's workspace and require access; a foreign or missing row is a 404. */
function rowReach(
  loader: (id: string) => Promise<{ workspaceId: string } | undefined>,
  notFound: string,
) {
  return async (c: Context, next: Next) => {
    const id = c.req.param("id");
    if (!id) throw new HTTPException(400, { message: "Missing id" });
    rejectNulByte(id, "Id");
    const row = await loader(id);
    if (!row) throw new HTTPException(404, { message: notFound });
    try {
      await validateWorkspaceAccess(
        c.get("userId"),
        row.workspaceId,
        c.get("apiKey")?.id,
      );
    } catch (error) {
      if (error instanceof HTTPException && error.status === 403)
        throw new HTTPException(404, { message: notFound });
      throw error;
    }
    c.set("workspaceId", row.workspaceId);
    c.set("workspaceIdSource", "row");
    await next();
  };
}

const serviceReach = rowReach(getServiceWorkspace, "Service not found");
const freezeReach = rowReach(getFreezeWorkspace, "Change freeze not found");
const releaseReach = rowReach(getReleaseWorkspace, "Release not found");

const readProject = [
  requireApiKeyPermissionScope({ project: ["read"] }),
  requireWorkspaceCapability("project:read"),
] as const;
const manageService = [
  requireApiKeyPermissionScope({ service: ["manage"] }),
  requireWorkspaceCapability("service:manage"),
] as const;
const manageChange = [
  requireApiKeyPermissionScope({ change: ["manage"] }),
  requireWorkspaceCapability("change:manage"),
] as const;
const manageRelease = [
  requireApiKeyPermissionScope({ release: ["manage"] }),
  requireWorkspaceCapability("release:manage"),
] as const;

const conflict = (description: string) =>
  jsonResponse(description, versionConflictSchema);

// -------------------------------------------------------------------------------- services

const statusReadRoute = createRoute({
  method: "get",
  path: "/service-catalogue/status",
  operationId: "getServiceCatalogueStatus",
  tags: ["Service management"],
  summary:
    "Whether the service catalogue is on, and what the caller may manage",
  description:
    "Never refused for a disabled feature, so navigation can decide whether to show the screens.",
  middleware: [workspaceAccess.fromQuery(), ...readProject] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse("Status", catalogueStatusSchema),
    403: errorResponse("Missing project:read permission"),
  },
});

const listServicesRoute = createRoute({
  method: "get",
  path: "/services",
  operationId: "listServices",
  tags: ["Service management"],
  summary: "List services",
  middleware: [workspaceAccess.fromQuery(), ...readProject] as const,
  request: { query: serviceListQuery },
  responses: {
    200: jsonResponse(
      "Services with incident and open change counts",
      serviceListSchema,
    ),
    403: errorResponse("Missing project:read permission"),
    409: errorResponse("The service catalogue is off for this workspace"),
  },
});
const createServiceRoute = createRoute({
  method: "post",
  path: "/services",
  operationId: "createService",
  tags: ["Service management"],
  summary: "Create a service",
  middleware: [workspaceAccess.fromBody(), ...manageService] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createServiceBody } },
    },
  },
  responses: {
    200: jsonResponse("The created service", serviceDetailSchema),
    403: errorResponse("Missing service:manage permission"),
    409: errorResponse("The name is taken, or the catalogue is off"),
    422: errorResponse(
      "A referenced team, calendar, project or service was not found",
    ),
  },
});
const getServiceRoute = createRoute({
  method: "get",
  path: "/services/{id}",
  operationId: "getService",
  tags: ["Service management"],
  summary: "Get a service with links, dependencies and checklist",
  middleware: [serviceReach, ...readProject, requireReachFilteredList] as const,
  request: { params: idParam },
  responses: {
    200: jsonResponse("The service", serviceDetailSchema),
    403: errorResponse("Missing project:read permission"),
    404: errorResponse("Service not found"),
  },
});
const patchServiceRoute = createRoute({
  method: "patch",
  path: "/services/{id}",
  operationId: "updateService",
  tags: ["Service management"],
  summary: "Update a service",
  description:
    "Links, dependencies and the release checklist are replaced as sets. A circular dependency is permitted but flagged in the response.",
  middleware: [serviceReach, ...manageService] as const,
  request: {
    params: idParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateServiceBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated service", serviceDetailSchema),
    403: errorResponse("Missing service:manage permission"),
    404: errorResponse("Service not found"),
    409: conflict("Version conflict"),
    422: errorResponse("A referenced entity was not found"),
  },
});
const statusRoute = createRoute({
  method: "post",
  path: "/services/{id}/status",
  operationId: "setServiceStatus",
  tags: ["Service management"],
  summary: "Set a service's status",
  description:
    "Operational, degraded or outage is set by a person, never computed from open incidents (SVC-4).",
  middleware: [serviceReach, ...manageService] as const,
  request: {
    params: idParam,
    body: {
      required: true,
      content: { "application/json": { schema: setServiceStatusBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated service", serviceDetailSchema),
    403: errorResponse("Missing service:manage permission"),
    404: errorResponse("Service not found"),
  },
});
const impactRoute = createRoute({
  method: "get",
  path: "/services/{id}/impact",
  operationId: "getServiceImpact",
  tags: ["Service management"],
  summary: "Services and customers impacted by a service",
  description:
    "Every service that depends on this one, level by level, and the customers they serve. A cycle stops the walk and is reported.",
  middleware: [serviceReach, ...readProject, requireReachFilteredList] as const,
  request: { params: idParam },
  responses: {
    200: jsonResponse("Impact list", serviceImpactSchema),
    403: errorResponse("Missing project:read permission"),
    404: errorResponse("Service not found"),
  },
});
const deleteServiceRoute = createRoute({
  method: "delete",
  path: "/services/{id}",
  operationId: "requestServiceDeletion",
  tags: ["Service management"],
  summary: "Request service deletion",
  description:
    "Creates a pending action (click approval). Refused while the service has open changes, releases or dependents.",
  middleware: [serviceReach, ...manageService] as const,
  request: { params: idParam },
  responses: {
    202: jsonResponse(
      "Deletion awaiting approval",
      registeredDeletionRequestSchema,
    ),
    403: errorResponse("Missing service:manage permission"),
    404: errorResponse("Service not found"),
    409: errorResponse("The service still has open changes or dependents"),
  },
});

// -------------------------------------------------------------------------------- changes

const calendarRoute = createRoute({
  method: "get",
  path: "/changes/calendar",
  operationId: "getChangeCalendar",
  tags: ["Service management"],
  summary: "Change calendar",
  description:
    "Planned change windows in reachable projects, active freezes and same-service conflicts for a date range of at most 400 days.",
  middleware: [
    workspaceAccess.fromQuery(),
    ...readProject,
    requireReachFilteredList,
  ] as const,
  request: { query: calendarQuery },
  responses: {
    200: jsonResponse("Windows, freezes and conflicts", changeCalendarSchema),
    400: errorResponse("Invalid range"),
    403: errorResponse("Missing project:read permission"),
  },
});
const getChangeRoute = createRoute({
  method: "get",
  path: "/work-items/{key}/change",
  operationId: "getWorkItemChange",
  tags: ["Service management"],
  summary: "Change detail of a work item",
  middleware: [requireWorkItemReach()] as const,
  request: { params: keyParam },
  responses: {
    200: jsonResponse(
      "Change detail, freeze state and conflicts",
      changeViewSchema,
    ),
    403: errorResponse("Insufficient permission"),
    404: errorResponse("Work item not found"),
  },
});
const patchChangeRoute = createRoute({
  method: "patch",
  path: "/work-items/{key}/change",
  operationId: "updateWorkItemChange",
  tags: ["Service management"],
  summary: "Set risk, window, rollback plan, affected services or release",
  description:
    "Only a work item of a change type has change detail. An override is recorded per freeze id and version, so moving the window does not void it; a freeze the override has not covered still blocks.",
  middleware: [
    requireWorkItemReach("key", { deferApiKeyCapability: true }),
    ...manageChange,
  ] as const,
  request: {
    params: keyParam,
    body: {
      required: true,
      content: { "application/json": { schema: patchChangeBody } },
    },
  },
  responses: {
    200: jsonResponse("Change detail", changeViewSchema),
    403: errorResponse("Missing change:manage permission"),
    404: errorResponse("Work item not found"),
    409: conflict("Version conflict"),
    422: errorResponse("Not a change, or an invalid window or reference"),
  },
});
const overrideRoute = createRoute({
  method: "post",
  path: "/work-items/{key}/change/override-freeze",
  operationId: "overrideChangeFreeze",
  tags: ["Service management"],
  summary: "Override a change freeze",
  description:
    "Session-only and elevated: spends a one-use operation-bound step-up proof bound to the change and reason, and is audited prominently as change.freeze_overridden (CH-4).",
  middleware: [
    requireSessionOnly(),
    requireWorkItemReach("key", { deferApiKeyCapability: true }),
    ...manageChange,
  ] as const,
  request: {
    params: keyParam,
    headers: stepUpTokenHeader,
    body: {
      required: true,
      content: { "application/json": { schema: freezeOverrideBody } },
    },
  },
  responses: {
    200: jsonResponse("Change detail", changeViewSchema),
    403: errorResponse("Missing change:manage permission or step-up proof"),
    404: errorResponse("Work item not found"),
    409: errorResponse("Nothing to override"),
    422: errorResponse("Not a change"),
  },
});
const setWorkItemServiceRoute = createRoute({
  method: "post",
  path: "/work-items/{key}/service",
  operationId: "setWorkItemService",
  tags: ["Service management"],
  summary: "Set or clear the service a work item affects",
  middleware: [
    requireWorkItemReach("key", { deferApiKeyCapability: true }),
    requireApiKeyPermissionScope({ work_item: ["update"] }),
    requireWorkspaceCapability("work_item:update"),
  ] as const,
  request: {
    params: keyParam,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: setWorkItemServiceBody,
        },
      },
    },
  },
  responses: {
    200: jsonResponse("Updated", okSchema),
    403: errorResponse("Missing work_item:update permission"),
    404: errorResponse("Work item not found"),
    422: errorResponse("Service not found"),
  },
});

// -------------------------------------------------------------------------------- freezes

const listFreezesRoute = createRoute({
  method: "get",
  path: "/change-freezes",
  operationId: "listChangeFreezes",
  tags: ["Service management"],
  summary: "List change freezes",
  middleware: [workspaceAccess.fromQuery(), ...readProject] as const,
  request: { query: freezeListQuery },
  responses: {
    200: jsonResponse("Freezes", freezeListSchema),
    403: errorResponse("Missing project:read permission"),
  },
});
const overridesRoute = createRoute({
  method: "get",
  path: "/change-freezes/overrides",
  operationId: "listChangeFreezeOverrides",
  tags: ["Service management"],
  summary: "Report of freeze overrides",
  middleware: [
    workspaceAccess.fromQuery(),
    ...manageChange,
    requireReachFilteredList,
  ] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse("Overrides, newest first", overrideReportSchema),
    403: errorResponse("Missing change:manage permission"),
  },
});
const createFreezeRoute = createRoute({
  method: "post",
  path: "/change-freezes",
  operationId: "createChangeFreeze",
  tags: ["Service management"],
  summary: "Declare a change freeze",
  middleware: [workspaceAccess.fromBody(), ...manageChange] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createFreezeBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The freeze and how many changes it now blocks",
      freezeWriteSchema,
    ),
    400: errorResponse("Invalid range"),
    403: errorResponse("Missing change:manage permission"),
  },
});
const patchFreezeRoute = createRoute({
  method: "patch",
  path: "/change-freezes/{id}",
  operationId: "updateChangeFreeze",
  tags: ["Service management"],
  summary: "Edit or cancel a change freeze",
  middleware: [freezeReach, ...manageChange] as const,
  request: {
    params: idParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateFreezeBody } },
    },
  },
  responses: {
    200: jsonResponse("The freeze", freezeWriteSchema),
    403: errorResponse("Missing change:manage permission"),
    404: errorResponse("Freeze not found"),
    409: conflict("Version conflict or already cancelled"),
    422: errorResponse("Invalid range"),
  },
});

// -------------------------------------------------------------------------------- releases

const listReleasesRoute = createRoute({
  method: "get",
  path: "/releases",
  operationId: "listReleases",
  tags: ["Service management"],
  summary: "List releases",
  middleware: [workspaceAccess.fromQuery(), ...readProject] as const,
  request: { query: releaseListQuery },
  responses: {
    200: jsonResponse("Releases", releaseListSchema),
    403: errorResponse("Missing project:read permission"),
  },
});
const createReleaseRoute = createRoute({
  method: "post",
  path: "/releases",
  operationId: "createRelease",
  tags: ["Service management"],
  summary: "Create a release",
  description:
    "The target service's release checklist is instantiated for the release (REL-3).",
  middleware: [workspaceAccess.fromBody(), ...manageRelease] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createReleaseBody } },
    },
  },
  responses: {
    200: jsonResponse("The release", releaseDetailSchema),
    403: errorResponse("Missing release:manage permission"),
    422: errorResponse("Unknown service or change"),
  },
});
const getReleaseRoute = createRoute({
  method: "get",
  path: "/releases/{id}",
  operationId: "getRelease",
  tags: ["Service management"],
  summary: "Get a release with its changes, checklist and notes",
  middleware: [releaseReach, ...readProject, requireReachFilteredList] as const,
  request: { params: idParam },
  responses: {
    200: jsonResponse("The release", releaseDetailSchema),
    403: errorResponse("Missing project:read permission"),
    404: errorResponse("Release not found"),
  },
});
const patchReleaseRoute = createRoute({
  method: "patch",
  path: "/releases/{id}",
  operationId: "updateRelease",
  tags: ["Service management"],
  summary: "Update a release",
  middleware: [releaseReach, ...manageRelease] as const,
  request: {
    params: idParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateReleaseBody } },
    },
  },
  responses: {
    200: jsonResponse("The release", releaseDetailSchema),
    403: errorResponse("Missing release:manage permission"),
    404: errorResponse("Release not found"),
    409: conflict("Version conflict"),
    422: errorResponse("Unknown change"),
  },
});
const notesRoute = createRoute({
  method: "post",
  path: "/releases/{id}/notes",
  operationId: "setReleaseNotes",
  tags: ["Service management"],
  summary: "Edit or regenerate release notes",
  description:
    "Regenerate builds notes from the associated changes; supplying notes stores the edit. Locked once the release is published to the portal.",
  middleware: [releaseReach, ...manageRelease] as const,
  request: {
    params: idParam,
    body: {
      required: true,
      content: { "application/json": { schema: releaseNotesBody } },
    },
  },
  responses: {
    200: jsonResponse("The release", releaseDetailSchema),
    403: errorResponse("Missing release:manage permission"),
    404: errorResponse("Release not found"),
    409: errorResponse("Notes are locked after publication"),
  },
});
const checklistRoute = createRoute({
  method: "patch",
  path: "/releases/{id}/checklist/{itemId}",
  operationId: "toggleReleaseChecklistItem",
  tags: ["Service management"],
  summary: "Tick or untick a release checklist item",
  middleware: [releaseReach, ...manageRelease] as const,
  request: {
    params: releaseChecklistParam,
    body: {
      required: true,
      content: { "application/json": { schema: toggleChecklistBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated", okSchema),
    403: errorResponse("Missing release:manage permission"),
    404: errorResponse("Release or item not found"),
  },
});

const cabTemplateStatusRoute = createRoute({
  method: "get",
  path: "/change-cab-template",
  operationId: "getChangeCabTemplateStatus",
  tags: ["Service management"],
  summary: "Whether the CAB workflow template is applied",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspaceCapability("workflow:read"),
  ] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse("Template status", cabTemplateStatusSchema),
    403: errorResponse("Missing workflow:read permission"),
  },
});
const applyCabTemplateRoute = createRoute({
  method: "post",
  path: "/change-cab-template",
  operationId: "applyChangeCabTemplate",
  tags: ["Service management"],
  summary: "Apply the opt-in CAB workflow template",
  description:
    "CH-2. Adds an Approved state and CAB-gated edges for change work, binds the change types to " +
    "a new workflow and adopts Approved into the named projects. Never applied automatically. " +
    "Refused (409) while a project that has not adopted Approved still holds open change items.",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspaceCapability("workflow:manage"),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: applyCabTemplateBody } },
    },
  },
  responses: {
    200: jsonResponse("The applied template", cabTemplateResultSchema),
    403: errorResponse("Missing workflow:manage or project access"),
    404: errorResponse("Project not found"),
    409: jsonResponse(
      "Nothing to bind, a conflicting workflow, or changes that would be stranded",
      cabTemplateConflictSchema,
    ),
  },
});

async function reachableProjects(c: Context, workspaceId: string) {
  const reach = await callerReach(c, c.get("userId"));
  return reach.reachableProjectIds([workspaceId]);
}

/** The reachable projects of a route that declares `requireReachFilteredList`. */
function declaredReach(c: Context, workspaceId: string) {
  return listReachOf(c).reachableProjectIds([workspaceId]);
}

async function callerHolds(
  c: Context,
  workspaceId: string,
  capability: "service:manage" | "change:manage" | "release:manage",
) {
  try {
    await assertCallerHasCapability(
      workspaceId,
      c.get("userId") as string,
      capability,
      capabilityCredential(c.get("apiKey")),
    );
    return true;
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) return false;
    throw error;
  }
}

const router = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(statusReadRoute, async (c) => {
    const { workspaceId } = c.req.valid("query");
    return c.json(
      catalogueStatusSchema.parse({
        enabled: await serviceCatalogueEnabled(workspaceId),
        canManageServices: await callerHolds(c, workspaceId, "service:manage"),
        canManageChanges: await callerHolds(c, workspaceId, "change:manage"),
        canManageReleases: await callerHolds(c, workspaceId, "release:manage"),
      }),
      200,
    );
  })
  .openapi(listServicesRoute, async (c) => {
    const { workspaceId, q } = c.req.valid("query");
    await requireServiceCatalogue(workspaceId);
    return c.json(
      serviceListSchema.parse({ data: await listServices(workspaceId, q) }),
      200,
    );
  })
  .openapi(createServiceRoute, async (c) => {
    const body = c.req.valid("json");
    await requireServiceCatalogue(body.workspaceId);
    const created = await createService({
      ...body,
      actor: actorOf(c),
      reachableProjectIds: await reachableProjects(c, body.workspaceId),
    });
    return c.json(serviceDetailSchema.parse(created), 200);
  })
  .openapi(getServiceRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    await requireServiceCatalogue(workspaceId);
    const detail = await getServiceDetail(
      c.req.valid("param").id,
      workspaceId,
      await declaredReach(c, workspaceId),
      {
        userId: c.get("userId") as string,
        credential: capabilityCredential(c.get("apiKey")),
      },
    );
    if (!detail) throw new HTTPException(404, { message: "Service not found" });
    return c.json(serviceDetailSchema.parse(detail), 200);
  })
  .openapi(patchServiceRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    await requireServiceCatalogue(workspaceId);
    try {
      const updated = await updateService(
        c.req.valid("param").id,
        workspaceId,
        c.req.valid("json"),
        actorOf(c),
        await reachableProjects(c, workspaceId),
      );
      if (!updated)
        throw new HTTPException(404, { message: "Service not found" });
      return c.json(serviceDetailSchema.parse(updated), 200);
    } catch (error) {
      if (error instanceof VersionConflictError)
        return c.json(
          { message: error.message, currentVersion: error.currentVersion },
          409,
        );
      throw error;
    }
  })
  .openapi(statusRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    await requireServiceCatalogue(workspaceId);
    const updated = await setServiceStatus(
      c.req.valid("param").id,
      workspaceId,
      c.req.valid("json"),
      actorOf(c),
      await reachableProjects(c, workspaceId),
    );
    if (!updated)
      throw new HTTPException(404, { message: "Service not found" });
    return c.json(serviceDetailSchema.parse(updated), 200);
  })
  .openapi(impactRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    await requireServiceCatalogue(workspaceId);
    const impact = await serviceImpact(
      c.req.valid("param").id,
      workspaceId,
      await declaredReach(c, workspaceId),
    );
    if (!impact) throw new HTTPException(404, { message: "Service not found" });
    return c.json(serviceImpactSchema.parse(impact), 200);
  })
  .openapi(deleteServiceRoute, async (c) => {
    const id = c.req.valid("param").id;
    const workspaceId = c.get("workspaceId");
    await requireServiceCatalogue(workspaceId);
    const blockers = await serviceDeletionBlockers(db, id, workspaceId);
    if (blockers.length > 0)
      throw new HTTPException(409, { message: blockers.join(" ") });
    const pending = await requestRegisteredDeletion(c, {
      routeKey: SERVICE_DELETION_ROUTE,
      targetType: "service",
      id,
      workspaceId,
    });
    return c.json(pending, 202);
  })
  .openapi(calendarRoute, async (c) => {
    const { workspaceId, from, to } = c.req.valid("query");
    await requireServiceCatalogue(workspaceId);
    if (!(to > from) || to.getTime() - from.getTime() > MAX_CALENDAR_RANGE_MS)
      throw new HTTPException(400, {
        message: "The range must be positive and at most 400 days",
      });
    const calendar = await changeCalendar({
      workspaceId,
      from,
      to,
      reachableProjectIds: await declaredReach(c, workspaceId),
    });
    return c.json(changeCalendarSchema.parse(calendar), 200);
  })
  .openapi(getChangeRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    await requireServiceCatalogue(workspaceId);
    const target = await resolveChangeTarget(
      c.req.valid("param").key,
      workspaceId,
    );
    if (!target)
      throw new HTTPException(404, { message: "Work item not found" });
    const view = await getChange(target, {
      reachableProjectIds: await reachableProjects(c, workspaceId),
    });
    return c.json(changeViewSchema.parse(view), 200);
  })
  .openapi(patchChangeRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    await requireServiceCatalogue(workspaceId);
    const target = await resolveChangeTarget(
      c.req.valid("param").key,
      workspaceId,
    );
    if (!target)
      throw new HTTPException(404, { message: "Work item not found" });
    try {
      await patchChange(target, c.req.valid("json"), actorOf(c));
    } catch (error) {
      if (error instanceof VersionConflictError)
        return c.json(
          { message: error.message, currentVersion: error.currentVersion },
          409,
        );
      throw error;
    }
    const view = await getChange(target, {
      reachableProjectIds: await reachableProjects(c, workspaceId),
    });
    return c.json(changeViewSchema.parse(view), 200);
  })
  .openapi(overrideRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    await requireServiceCatalogue(workspaceId);
    const key = c.req.valid("param").key;
    const { reason, windowStart, windowEnd } = c.req.valid("json");
    const target = await resolveChangeTarget(key, workspaceId);
    if (!target)
      throw new HTTPException(404, { message: "Work item not found" });
    await runWithStepUp(
      c,
      {
        operation: "change_freeze_override",
        workspaceId,
        workItemKey: key,
        reason,
        windowStart: windowStart ? windowStart.toISOString() : null,
        windowEnd: windowEnd ? windowEnd.toISOString() : null,
      },
      (spend) =>
        grantFreezeOverride({
          target,
          reason,
          window:
            windowStart && windowEnd
              ? { start: windowStart, end: windowEnd }
              : null,
          actor: actorOf(c),
          spend,
        }),
    );
    const view = await getChange(target, {
      reachableProjectIds: await reachableProjects(c, workspaceId),
    });
    return c.json(changeViewSchema.parse(view), 200);
  })
  .openapi(setWorkItemServiceRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    await requireServiceCatalogue(workspaceId);
    const target = await resolveChangeTarget(
      c.req.valid("param").key,
      workspaceId,
    );
    if (!target)
      throw new HTTPException(404, { message: "Work item not found" });
    await setWorkItemService(
      target.id,
      workspaceId,
      c.req.valid("json").serviceId,
      actorOf(c),
    );
    return c.json({ ok: true as const }, 200);
  })
  .openapi(listFreezesRoute, async (c) => {
    const { workspaceId, includeCancelled } = c.req.valid("query");
    await requireServiceCatalogue(workspaceId);
    return c.json(
      freezeListSchema.parse({
        data: await listFreezes(workspaceId, includeCancelled),
      }),
      200,
    );
  })
  .openapi(overridesRoute, async (c) => {
    const { workspaceId } = c.req.valid("query");
    await requireServiceCatalogue(workspaceId);
    return c.json(
      overrideReportSchema.parse({
        data: await listFreezeOverrides(
          workspaceId,
          await declaredReach(c, workspaceId),
        ),
      }),
      200,
    );
  })
  .openapi(createFreezeRoute, async (c) => {
    const body = c.req.valid("json");
    await requireServiceCatalogue(body.workspaceId);
    const result = await createFreeze({ ...body, actor: actorOf(c) });
    return c.json(freezeWriteSchema.parse(result), 200);
  })
  .openapi(patchFreezeRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    await requireServiceCatalogue(workspaceId);
    try {
      const result = await updateFreeze(
        c.req.valid("param").id,
        workspaceId,
        c.req.valid("json"),
        actorOf(c),
      );
      if (!result)
        throw new HTTPException(404, { message: "Change freeze not found" });
      return c.json(freezeWriteSchema.parse(result), 200);
    } catch (error) {
      if (error instanceof VersionConflictError)
        return c.json(
          { message: error.message, currentVersion: error.currentVersion },
          409,
        );
      throw error;
    }
  })
  .openapi(listReleasesRoute, async (c) => {
    const { workspaceId, serviceId } = c.req.valid("query");
    await requireServiceCatalogue(workspaceId);
    return c.json(
      releaseListSchema.parse({
        data: await listReleases(workspaceId, serviceId),
      }),
      200,
    );
  })
  .openapi(createReleaseRoute, async (c) => {
    const body = c.req.valid("json");
    await requireServiceCatalogue(body.workspaceId);
    const reachable = await reachableProjects(c, body.workspaceId);
    const id = await createRelease({
      ...body,
      reachableProjectIds: reachable,
      actor: actorOf(c),
    });
    const detail = await getReleaseDetail(
      id,
      body.workspaceId,
      reachable,
      true,
    );
    return c.json(releaseDetailSchema.parse(detail), 200);
  })
  .openapi(getReleaseRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    await requireServiceCatalogue(workspaceId);
    const detail = await getReleaseDetail(
      c.req.valid("param").id,
      workspaceId,
      await declaredReach(c, workspaceId),
      await callerHolds(c, workspaceId, "release:manage"),
    );
    if (!detail) throw new HTTPException(404, { message: "Release not found" });
    return c.json(releaseDetailSchema.parse(detail), 200);
  })
  .openapi(patchReleaseRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    await requireServiceCatalogue(workspaceId);
    const id = c.req.valid("param").id;
    const reachable = await reachableProjects(c, workspaceId);
    try {
      const found = await updateRelease(
        id,
        workspaceId,
        c.req.valid("json"),
        reachable,
        actorOf(c),
      );
      if (!found)
        throw new HTTPException(404, { message: "Release not found" });
    } catch (error) {
      if (error instanceof VersionConflictError)
        return c.json(
          { message: error.message, currentVersion: error.currentVersion },
          409,
        );
      throw error;
    }
    const detail = await getReleaseDetail(id, workspaceId, reachable, true);
    return c.json(releaseDetailSchema.parse(detail), 200);
  })
  .openapi(notesRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    await requireServiceCatalogue(workspaceId);
    const id = c.req.valid("param").id;
    const reachable = await reachableProjects(c, workspaceId);
    const found = await setReleaseNotes(
      id,
      workspaceId,
      c.req.valid("json"),
      reachable,
      actorOf(c),
    );
    if (!found) throw new HTTPException(404, { message: "Release not found" });
    const detail = await getReleaseDetail(id, workspaceId, reachable, true);
    return c.json(releaseDetailSchema.parse(detail), 200);
  })
  .openapi(checklistRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    await requireServiceCatalogue(workspaceId);
    const { id, itemId } = c.req.valid("param");
    const found = await toggleChecklistItem(
      id,
      itemId,
      workspaceId,
      c.req.valid("json").done,
      actorOf(c),
    );
    if (!found)
      throw new HTTPException(404, { message: "Checklist item not found" });
    return c.json({ ok: true as const }, 200);
  })
  .openapi(cabTemplateStatusRoute, async (c) => {
    const { workspaceId } = c.req.valid("query");
    return c.json(
      cabTemplateStatusSchema.parse(await cabTemplateStatus(workspaceId)),
      200,
    );
  })
  .openapi(applyCabTemplateRoute, async (c) => {
    const body = c.req.valid("json");
    const session = c.get("session") as {
      impersonatedBy?: string | null;
    } | null;
    const identity = await resolveRequestIdentity({
      userId: c.get("userId"),
      apiKey: c.get("apiKey"),
      impersonatedBy: session?.impersonatedBy,
    });
    if (!identity) throw new HTTPException(403, { message: "Forbidden" });
    try {
      const result = await applyCabTemplate({
        workspaceId: body.workspaceId,
        projectIds: body.projectIds,
        identity,
        actor: actorOf(c),
      });
      return c.json(cabTemplateResultSchema.parse(result), 200);
    } catch (error) {
      if (!(error instanceof CabTemplateError)) throw error;
      if (error.status === 409)
        return c.json({ message: error.code, projects: error.projects }, 409);
      throw new HTTPException(error.status, { message: error.code });
    }
  });

export default router;
