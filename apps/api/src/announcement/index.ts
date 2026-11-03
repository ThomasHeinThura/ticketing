import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import type { AnnouncementSeverity } from "../database/schema-p5-service";
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
import { actorOf, requireServiceCatalogue } from "../service-management/common";
import {
  listReachOf,
  requireReachContext,
  requireReachFilteredList,
} from "../utils/reach-filtered-list";
import { rejectNulByte } from "../utils/reject-nul-byte";
import { requireApiKeyPermissionScope } from "../utils/require-api-key-permission-scope";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { ANNOUNCEMENT_DELETION_ROUTE } from "./deletion-target";
import {
  type AnnouncementReach,
  AnnouncementVersionConflictError,
  announcementAudienceOptions,
  assertAnnouncementDeletable,
  createAnnouncement,
  getAnnouncement,
  getAnnouncementWorkspace,
  getPortalAnnouncement,
  listAnnouncements,
  listPortalAnnouncements,
  type PortalAnnouncementScope,
  resolvePortalAnnouncementScope,
  setAnnouncementPublished,
  updateAnnouncement,
} from "./repository";
import {
  announcementAudienceOptionsSchema,
  announcementListSchema,
  announcementSchema,
  announcementVersionConflictSchema,
  portalAnnouncementListSchema,
  portalAnnouncementSchema,
} from "./response";
import {
  announcementIdParam,
  createAnnouncementBody,
  portalAnnouncementListQuery,
  updateAnnouncementBody,
  versionBody,
  workspaceIdQuery,
} from "./schema";

const NOT_FOUND = "Announcement not found";

/** Resolve the announcement's workspace and require access; foreign, deleted or missing is 404. */
async function announcementReach(c: Context, next: Next) {
  const id = c.req.param("id");
  if (!id) throw new HTTPException(400, { message: "Missing id" });
  rejectNulByte(id, "Id");
  const row = await getAnnouncementWorkspace(id);
  if (!row) throw new HTTPException(404, { message: NOT_FOUND });
  try {
    await validateWorkspaceAccess(
      c.get("userId"),
      row.workspaceId,
      c.get("apiKey")?.id,
    );
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403)
      throw new HTTPException(404, { message: NOT_FOUND });
    throw error;
  }
  c.set("workspaceId", row.workspaceId);
  c.set("workspaceIdSource", "row");
  await next();
}

const manage = [
  requireApiKeyPermissionScope({ service: ["manage"] }),
  requireWorkspaceCapability("service:manage"),
] as const;

const tags = ["Announcements"];
const conflict = jsonResponse(
  "Version conflict",
  announcementVersionConflictSchema,
);

const listRoute = createRoute({
  method: "get",
  path: "/",
  operationId: "listAnnouncements",
  tags,
  summary: "List the workspace's announcements, drafts included",
  description:
    "Announcements with no target in the caller's project reach are left out; targets outside it are left out of each row.",
  middleware: [
    workspaceAccess.fromQuery(),
    ...manage,
    requireReachFilteredList,
  ] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse("Announcements", announcementListSchema),
    403: errorResponse("Missing service:manage permission"),
    409: errorResponse("feature_disabled"),
  },
});

const audienceOptionsRoute = createRoute({
  method: "get",
  path: "/audience-options",
  operationId: "listAnnouncementAudienceOptions",
  tags,
  summary:
    "Customer organisations and projects an announcement in this workspace may address",
  description:
    "The caller's reachable live customer projects, and the organisations they serve.",
  middleware: [
    workspaceAccess.fromQuery(),
    ...manage,
    requireReachFilteredList,
  ] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse("Audience options", announcementAudienceOptionsSchema),
    403: errorResponse("Missing service:manage permission"),
    409: errorResponse("feature_disabled"),
  },
});

const createAnnouncementRoute = createRoute({
  method: "post",
  path: "/",
  operationId: "createAnnouncement",
  tags,
  summary: "Create a draft announcement",
  description:
    "The announcement starts as a draft; customers see it only after it is published and while it is inside its window.",
  middleware: [
    workspaceAccess.fromBody(),
    ...manage,
    requireReachContext,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createAnnouncementBody } },
    },
  },
  responses: {
    200: jsonResponse("The announcement", announcementSchema),
    403: errorResponse("Missing service:manage permission"),
    409: errorResponse("feature_disabled"),
    422: errorResponse(
      "Unknown organisation or project, an invalid window, or an audience beyond the caller's project reach",
    ),
  },
});

const getAnnouncementRoute = createRoute({
  method: "get",
  path: "/{id}",
  operationId: "getAnnouncement",
  tags,
  summary: "Get an announcement",
  middleware: [announcementReach, ...manage, requireReachFilteredList] as const,
  request: { params: announcementIdParam },
  responses: {
    200: jsonResponse("The announcement", announcementSchema),
    403: errorResponse("Missing service:manage permission"),
    404: errorResponse(NOT_FOUND),
    409: errorResponse("feature_disabled"),
  },
});

const updateAnnouncementRoute = createRoute({
  method: "patch",
  path: "/{id}",
  operationId: "updateAnnouncement",
  tags,
  summary: "Update an announcement",
  description:
    "Editing a published announcement needs project reach to every customer it addresses; drafts need reach to one target.",
  middleware: [announcementReach, ...manage, requireReachContext] as const,
  request: {
    params: announcementIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateAnnouncementBody } },
    },
  },
  responses: {
    200: jsonResponse("The announcement", announcementSchema),
    403: errorResponse("Missing service:manage permission"),
    404: errorResponse(NOT_FOUND),
    409: conflict,
    422: errorResponse(
      "Unknown organisation or project, an invalid window, an audience beyond the caller's project reach, or a published announcement addressing a customer beyond it",
    ),
  },
});

const publishRoute = createRoute({
  method: "post",
  path: "/{id}/publish",
  operationId: "publishAnnouncement",
  tags,
  summary: "Publish an announcement to the customer portal",
  description:
    "Publishing a workspace-wide announcement needs project reach to every live customer project of the workspace.",
  middleware: [announcementReach, ...manage, requireReachContext] as const,
  request: {
    params: announcementIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: versionBody } },
    },
  },
  responses: {
    200: jsonResponse("The announcement", announcementSchema),
    403: errorResponse("Missing service:manage permission"),
    404: errorResponse(NOT_FOUND),
    409: conflict,
    422: errorResponse(
      "A workspace-wide announcement needs reach to every customer project",
    ),
  },
});

const unpublishRoute = createRoute({
  method: "post",
  path: "/{id}/unpublish",
  operationId: "unpublishAnnouncement",
  tags,
  summary: "Withdraw an announcement from the customer portal",
  description:
    "Withdrawing a published announcement needs project reach to every customer it addresses.",
  middleware: [announcementReach, ...manage, requireReachContext] as const,
  request: {
    params: announcementIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: versionBody } },
    },
  },
  responses: {
    200: jsonResponse("The announcement", announcementSchema),
    403: errorResponse("Missing service:manage permission"),
    404: errorResponse(NOT_FOUND),
    409: conflict,
    422: errorResponse(
      "A published announcement addresses a customer beyond the caller's project reach",
    ),
  },
});

const deleteAnnouncementRoute = createRoute({
  method: "delete",
  path: "/{id}",
  operationId: "deleteAnnouncement",
  tags,
  summary: "Delete an announcement",
  description:
    "Requests a durable pending deletion (202); the announcement is unchanged until the requester approves, then it is soft-deleted. Deleting a published announcement needs project reach to every customer it addresses.",
  middleware: [announcementReach, ...manage, requireReachContext] as const,
  request: { params: announcementIdParam },
  responses: {
    202: jsonResponse(
      "Pending deletion; announcement unchanged",
      registeredDeletionRequestSchema,
    ),
    403: errorResponse("Missing service:manage permission"),
    404: errorResponse(NOT_FOUND),
    409: errorResponse("An equivalent deletion is already pending"),
    422: errorResponse(
      "A published announcement addresses a customer beyond the caller's project reach",
    ),
  },
});

/** The caller's project reach in the workspace (the one decision source, #740). */
async function reachIn(
  c: Context,
  workspaceId: string,
): Promise<AnnouncementReach> {
  const reach = listReachOf(c);
  const [live, any] = await Promise.all([
    reach.reachableProjectIds([workspaceId]),
    reach.reachableProjectIds([workspaceId], { includeDeleted: true }),
  ]);
  return { live, any };
}

function versionConflict(c: Context, error: unknown) {
  if (error instanceof AnnouncementVersionConflictError)
    return c.json(
      { message: error.message, currentVersion: error.currentVersion },
      409,
    );
  throw error;
}

export const announcementRouter = apiRouter<
  BaseVariables & { workspaceId: string }
>()
  .openapi(listRoute, async (c) => {
    const { workspaceId } = c.req.valid("query");
    await requireServiceCatalogue(workspaceId);
    return c.json(
      announcementListSchema.parse({
        data: await listAnnouncements(
          workspaceId,
          await reachIn(c, workspaceId),
        ),
      }),
      200,
    );
  })
  .openapi(audienceOptionsRoute, async (c) => {
    const { workspaceId } = c.req.valid("query");
    await requireServiceCatalogue(workspaceId);
    return c.json(
      announcementAudienceOptionsSchema.parse(
        await announcementAudienceOptions(
          workspaceId,
          (await reachIn(c, workspaceId)).live,
        ),
      ),
      200,
    );
  })
  .openapi(createAnnouncementRoute, async (c) => {
    const body = c.req.valid("json");
    await requireServiceCatalogue(body.workspaceId);
    const created = await createAnnouncement(
      body,
      actorOf(c),
      await reachIn(c, body.workspaceId),
    );
    return c.json(announcementSchema.parse(created), 200);
  })
  .openapi(getAnnouncementRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    await requireServiceCatalogue(workspaceId);
    const view = await getAnnouncement(
      c.req.valid("param").id,
      workspaceId,
      await reachIn(c, workspaceId),
    );
    if (!view) throw new HTTPException(404, { message: NOT_FOUND });
    return c.json(announcementSchema.parse(view), 200);
  })
  .openapi(updateAnnouncementRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    await requireServiceCatalogue(workspaceId);
    try {
      const updated = await updateAnnouncement(
        c.req.valid("param").id,
        workspaceId,
        c.req.valid("json"),
        actorOf(c),
        await reachIn(c, workspaceId),
      );
      return c.json(announcementSchema.parse(updated), 200);
    } catch (error) {
      return versionConflict(c, error);
    }
  })
  .openapi(publishRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    await requireServiceCatalogue(workspaceId);
    try {
      const view = await setAnnouncementPublished(
        c.req.valid("param").id,
        workspaceId,
        c.req.valid("json").version,
        true,
        actorOf(c),
        await reachIn(c, workspaceId),
      );
      return c.json(announcementSchema.parse(view), 200);
    } catch (error) {
      return versionConflict(c, error);
    }
  })
  .openapi(unpublishRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    await requireServiceCatalogue(workspaceId);
    try {
      const view = await setAnnouncementPublished(
        c.req.valid("param").id,
        workspaceId,
        c.req.valid("json").version,
        false,
        actorOf(c),
        await reachIn(c, workspaceId),
      );
      return c.json(announcementSchema.parse(view), 200);
    } catch (error) {
      return versionConflict(c, error);
    }
  })
  .openapi(deleteAnnouncementRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    // Deleting a published notice needs reach to every customer it addresses; refuse before a
    // pending action exists. Out-of-reach notices fall through to the pending path's 404.
    await assertAnnouncementDeletable(
      db,
      c.req.valid("param").id,
      workspaceId,
      await reachIn(c, workspaceId),
    );
    const pending = await requestRegisteredDeletion(c, {
      routeKey: ANNOUNCEMENT_DELETION_ROUTE,
      targetType: "announcement",
      id: c.req.valid("param").id,
      workspaceId: c.get("workspaceId"),
    });
    return c.json(pending, 202);
  });

// ------------------------------------------------------------------------------------ portal

type PortalAnnouncementVariables = BaseVariables & {
  portalPredicateSatisfied: boolean;
  policyOrganisationId: string;
  policyOrganisationIdSource: "row";
  portalAnnouncement: PortalAnnouncementScope;
};

async function portalScope(
  c: Context<{ Variables: PortalAnnouncementVariables }>,
  next: Next,
) {
  const scope = await resolvePortalAnnouncementScope(c.get("userId"));
  c.set("portalAnnouncement", scope);
  c.set("portalPredicateSatisfied", true);
  c.set("policyOrganisationId", scope.organisationId);
  c.set("policyOrganisationIdSource", "row");
  await next();
}

const portalListRoute = createRoute({
  method: "get",
  path: "/announcements",
  operationId: "listPortalAnnouncements",
  tags: ["Portal announcements"],
  summary:
    "List the announcements currently addressed to the customer organisation",
  description:
    "Published, not deleted, inside their window, and addressed to the caller's organisation through a live project of theirs. Newest start first.",
  middleware: [portalScope] as const,
  request: { query: portalAnnouncementListQuery },
  responses: {
    200: jsonResponse("Announcements", portalAnnouncementListSchema),
    400: errorResponse("Invalid cursor, page size or severity"),
    404: errorResponse("Portal account unavailable"),
  },
});

const portalDetailRoute = createRoute({
  method: "get",
  path: "/announcements/{id}",
  operationId: "getPortalAnnouncement",
  tags: ["Portal announcements"],
  summary: "Read one announcement addressed to the customer organisation",
  middleware: [portalScope] as const,
  request: { params: announcementIdParam },
  responses: {
    200: jsonResponse("Announcement", portalAnnouncementSchema),
    404: errorResponse(NOT_FOUND),
  },
});

export const portalAnnouncementRouter = apiRouter<PortalAnnouncementVariables>()
  .openapi(portalListRoute, async (c) => {
    const { limit, cursor, severity } = c.req.valid("query");
    const severities = severity
      ? [...new Set(severity.split(","))].map(
          (value) => value as AnnouncementSeverity,
        )
      : undefined;
    return c.json(
      portalAnnouncementListSchema.parse(
        await listPortalAnnouncements(c.get("portalAnnouncement"), {
          limit,
          cursor,
          severities,
        }),
      ),
      200,
    );
  })
  .openapi(portalDetailRoute, async (c) =>
    c.json(
      portalAnnouncementSchema.parse(
        await getPortalAnnouncement(
          c.get("portalAnnouncement"),
          c.req.valid("param").id,
        ),
      ),
      200,
    ),
  );
