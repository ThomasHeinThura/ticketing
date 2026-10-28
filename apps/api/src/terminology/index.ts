import { resolveFeatureFlag } from "@taskdesk/permissions";
import { and, eq, exists, isNull, or } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { portalForHost } from "../auth";
import db, { schema } from "../database";
import { requireCurrentInstanceAdmin } from "../instance/require-instance-admin";
import {
  findSubmission,
  portalCatalogue,
  portalIdentity,
  portalReadablePredicate,
} from "../intake/repository";
import { apiRouter, createRoute, jsonResponse, z } from "../openapi";
import { resolveRequestIdentity } from "../permissions/resolve-request-identity";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { requireApiKeyPermissionScope } from "../utils/require-api-key-permission-scope";
import { requireSessionOnly } from "../utils/require-session-only";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { buildTerminologyPreviewExamples } from "./preview";
import {
  terminologyAdminResponseSchema,
  terminologyMutationBodySchema,
  terminologyPortalQuerySchema,
  terminologyPreviewBodySchema,
  terminologyPreviewResponseSchema,
  terminologyPublicQuerySchema,
  terminologyPublicResponseSchema,
  terminologyRuntimeQuerySchema,
  terminologyWorkspaceParamSchema,
} from "./schema";
import {
  effectiveTerminologyEtag,
  getInstanceTerminologyOverrides,
  listTerminologyOverrides,
  resolveEffectiveTerminology,
  saveTerminologyOverride,
  TerminologyConflictError,
  terminologyEtag,
} from "./service";

export { terminologyPolicies } from "./policy";

// Portal work item overlays use the same organisation/private-requester/participant
// predicate as portal-linked request reads. The identifier is resolved in the same query
// that proves that predicate, and unknown/out-of-scope keys share one 404.
async function readablePortalWorkItemWorkspace(
  key: string,
  personId: string,
  organisationId: string,
) {
  const workItem = schema.workItemTable;
  const submission = schema.submissionTable;
  const viewer = { personId, organisationId };
  const [row] = await db
    .select({ workspaceId: workItem.workspaceId })
    .from(workItem)
    .innerJoin(submission, eq(submission.workItemId, workItem.id))
    .where(
      and(
        or(
          eq(workItem.key, key),
          exists(
            db
              .select({ one: schema.workItemKeyAliasTable.oldKey })
              .from(schema.workItemKeyAliasTable)
              .where(
                and(
                  eq(schema.workItemKeyAliasTable.workItemId, workItem.id),
                  eq(schema.workItemKeyAliasTable.oldKey, key),
                ),
              ),
          ),
        ),
        portalReadablePredicate(viewer),
        // Portal submission detail exposes a linked work item only when it still belongs
        // to the requester's item; this prevents a moved/relinked item from broadening scope.
        eq(workItem.requesterId, submission.requesterId),
        isNull(workItem.deletedAt),
        isNull(workItem.archivedAt),
      ),
    )
    .limit(1);
  return row?.workspaceId ?? null;
}

const errorSchema = z.object({ message: z.string() });
const apiError = (description: string) =>
  jsonResponse(description, errorSchema);
const instanceBase = { tags: ["Terminology"] };
const session = requireSessionOnly();

function requireAgentSurface(c: Context) {
  if (portalForHost(c.req.header("host")) !== "agent")
    throw new HTTPException(404, { message: "Not found" });
}

async function agentSurface(c: Context, next: Next) {
  requireAgentSurface(c);
  await next();
}

async function requirePortalIntakeEnabled(workspaceId: string) {
  const [[instance], [workspace]] = await Promise.all([
    db
      .select({
        enabled: schema.instanceFeatureFlagTable.enabled,
        locked: schema.instanceFeatureFlagTable.locked,
      })
      .from(schema.instanceFeatureFlagTable)
      .where(eq(schema.instanceFeatureFlagTable.featureKey, "feature.intake"))
      .limit(1),
    db
      .select({ enabled: schema.workspaceFeatureFlagTable.enabled })
      .from(schema.workspaceFeatureFlagTable)
      .where(
        and(
          eq(schema.workspaceFeatureFlagTable.workspaceId, workspaceId),
          eq(schema.workspaceFeatureFlagTable.featureKey, "feature.intake"),
        ),
      )
      .limit(1),
  ]);
  if (
    !resolveFeatureFlag({
      feature: "feature.intake",
      instance: instance ?? null,
      workspace: workspace?.enabled ?? null,
    }).enabled
  )
    throw new HTTPException(404, { message: "Not found" });
}

const publicRoute = createRoute({
  ...instanceBase,
  method: "get",
  path: "/",
  operationId: "getPublicTerminology",
  summary: "Get public terminology for this application surface",
  request: { query: terminologyPublicQuerySchema },
  responses: {
    200: jsonResponse(
      "Instance terminology overrides",
      terminologyPublicResponseSchema,
    ),
    304: { description: "Terminology has not changed" },
    403: apiError("Unknown application host"),
  },
});

export const publicTerminology = apiRouter().openapi(publicRoute, async (c) => {
  const surface = portalForHost(c.req.header("host"));
  if (!surface) throw new HTTPException(403, { message: "Forbidden" });
  const audience = surface === "agent" ? "agent" : "customer";
  const data = await getInstanceTerminologyOverrides({
    locale: c.req.valid("query").locale,
    audience,
  });
  c.header("ETag", data.etag);
  c.header("Cache-Control", "no-cache");
  c.header("Vary", "Host");
  if (c.req.header("if-none-match") === data.etag) return c.body(null, 304);
  setShadowLegacyAuthorization(c, "allowed");
  return c.json(data, 200);
});

const getInstanceRoute = createRoute({
  ...instanceBase,
  method: "get",
  path: "/",
  operationId: "getInstanceTerminology",
  summary: "List instance terminology overrides",
  responses: {
    200: jsonResponse(
      "Instance overrides and concurrency token",
      terminologyAdminResponseSchema,
    ),
    403: apiError("Forbidden"),
  },
});
const putInstanceRoute = createRoute({
  ...instanceBase,
  method: "put",
  path: "/",
  operationId: "putInstanceTerminology",
  summary: "Save or remove an instance terminology override",
  middleware: [session] as const,
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: terminologyMutationBodySchema },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Updated instance overrides",
      terminologyAdminResponseSchema,
    ),
    400: apiError("Invalid terminology forms"),
    403: apiError("Forbidden"),
    409: apiError("Instance overrides changed; reload before saving"),
  },
});
const previewInstanceRoute = createRoute({
  ...instanceBase,
  method: "post",
  path: "/preview",
  operationId: "previewInstanceTerminology",
  summary: "Preview CLDR terminology forms",
  middleware: [session] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: terminologyPreviewBodySchema } },
    },
  },
  responses: {
    200: jsonResponse("Plural examples", terminologyPreviewResponseSchema),
    400: apiError("Invalid terminology forms"),
    403: apiError("Forbidden"),
  },
});

function adminResponse(
  rows: Awaited<ReturnType<typeof listTerminologyOverrides>>,
) {
  return { overrides: rows, etag: terminologyEtag(rows) };
}

async function saveFromRequest(
  c: Context,
  scope: "instance" | "workspace",
  workspaceId: string | null,
  body: z.infer<typeof terminologyMutationBodySchema>,
) {
  const identity = await resolveRequestIdentity({ userId: c.get("userId") });
  if (!identity || identity.side !== "staff")
    throw new HTTPException(403, { message: "Forbidden" });
  try {
    return await saveTerminologyOverride(
      { scope, workspaceId, ...body.override, expectedEtag: body.expectedEtag },
      {
        userId: c.get("userId"),
        personId: identity.personId,
        traceId: c.req.header("x-request-id"),
      },
    );
  } catch (error) {
    if (error instanceof TerminologyConflictError)
      throw new HTTPException(409, {
        message: "version_conflict",
        cause: error,
      });
    if (error instanceof TypeError)
      throw new HTTPException(400, { message: error.message, cause: error });
    throw error;
  }
}

export const instanceTerminology = apiRouter()
  .openapi(getInstanceRoute, async (c) => {
    requireAgentSurface(c);
    await requireCurrentInstanceAdmin(c, "GET", "/api/instance/terminology");
    const rows = await listTerminologyOverrides({ scope: "instance" });
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "no-store");
    return c.json(adminResponse(rows), 200);
  })
  .openapi(putInstanceRoute, async (c) => {
    requireAgentSurface(c);
    await requireCurrentInstanceAdmin(c, "PUT", "/api/instance/terminology");
    const result = await saveFromRequest(
      c,
      "instance",
      null,
      c.req.valid("json"),
    );
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "no-store");
    return c.json(adminResponse(result.overrides), 200);
  })
  .openapi(previewInstanceRoute, async (c) => {
    requireAgentSurface(c);
    await requireCurrentInstanceAdmin(
      c,
      "POST",
      "/api/instance/terminology/preview",
    );
    const input = c.req.valid("json") as z.infer<
      typeof terminologyPreviewBodySchema
    >;
    const examples = buildTerminologyPreviewExamples(input);
    if (!examples)
      throw new HTTPException(400, {
        message: "forms must match this locale's CLDR categories",
      });
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "no-store");
    return c.json(
      {
        termKey: input.termKey,
        locale: input.locale,
        audience: input.audience,
        examples,
      },
      200,
    );
  });

const workspaceGetRoute = createRoute({
  ...instanceBase,
  method: "get",
  path: "/{workspaceId}/terminology",
  operationId: "getWorkspaceTerminology",
  summary: "List workspace terminology overrides",
  middleware: [
    agentSurface,
    workspaceAccess.fromParam(),
    requireApiKeyPermissionScope({ workspace: ["manage_settings"] }),
    requireWorkspaceCapability("workspace:manage_settings"),
  ] as const,
  request: { params: terminologyWorkspaceParamSchema },
  responses: {
    200: jsonResponse(
      "Workspace overrides and concurrency token",
      terminologyAdminResponseSchema,
    ),
    403: apiError("Forbidden"),
    404: apiError("Workspace not found"),
  },
});
const workspacePutRoute = createRoute({
  ...instanceBase,
  method: "put",
  path: "/{workspaceId}/terminology",
  operationId: "putWorkspaceTerminology",
  summary: "Save or remove a workspace terminology override",
  middleware: [
    agentSurface,
    workspaceAccess.fromParam(),
    requireApiKeyPermissionScope({ workspace: ["manage_settings"] }),
    requireWorkspaceCapability("workspace:manage_settings"),
  ] as const,
  request: {
    params: terminologyWorkspaceParamSchema,
    body: {
      required: true,
      content: {
        "application/json": { schema: terminologyMutationBodySchema },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Updated workspace overrides",
      terminologyAdminResponseSchema,
    ),
    400: apiError("Invalid terminology forms"),
    403: apiError("Forbidden"),
    404: apiError("Workspace not found"),
    409: apiError("Workspace overrides changed; reload before saving"),
  },
});
const workspaceRuntimeRoute = createRoute({
  ...instanceBase,
  method: "get",
  path: "/{workspaceId}/terminology/runtime",
  operationId: "getWorkspaceRuntimeTerminology",
  summary: "Get effective staff terminology for the active workspace",
  middleware: [
    agentSurface,
    workspaceAccess.fromParam(),
    requireApiKeyPermissionScope({ workspace: ["read"] }),
    requireWorkspaceCapability("workspace:read"),
  ] as const,
  request: {
    params: terminologyWorkspaceParamSchema,
    query: terminologyRuntimeQuerySchema,
  },
  responses: {
    200: jsonResponse(
      "Effective staff terminology",
      terminologyPublicResponseSchema,
    ),
    403: apiError("Forbidden"),
    404: apiError("Workspace not found"),
  },
});
export const workspaceTerminology = apiRouter()
  .openapi(workspaceGetRoute, async (c) => {
    requireAgentSurface(c);
    const { workspaceId } = c.req.valid("param");
    const rows = await listTerminologyOverrides({
      scope: "workspace",
      workspaceId,
    });
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "no-store");
    return c.json(adminResponse(rows), 200);
  })
  .openapi(workspaceRuntimeRoute, async (c) => {
    requireAgentSurface(c);
    const identity = await resolveRequestIdentity({ userId: c.get("userId") });
    if (!identity || identity.side !== "staff")
      throw new HTTPException(404, { message: "Not found" });
    const { workspaceId } = c.req.valid("param");
    const { locale } = c.req.valid("query");
    const snapshot = await db.transaction(
      async (tx) => {
        const terms = await resolveEffectiveTerminology({
          locale,
          audience: "agent",
          workspaceId,
          executor: tx,
        });
        const instance = await getInstanceTerminologyOverrides({
          locale,
          audience: "agent",
          executor: tx,
        });
        return {
          instance,
          terms,
          etag: effectiveTerminologyEtag({
            locale,
            audience: "agent",
            workspaceId,
            terms,
          }),
        };
      },
      { isolationLevel: "repeatable read" },
    );
    c.header("Cache-Control", "private, no-store");
    c.header("Vary", "Host, Cookie");
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      { ...snapshot.instance, etag: snapshot.etag, terms: snapshot.terms },
      200,
    );
  })
  .openapi(workspacePutRoute, async (c) => {
    requireAgentSurface(c);
    const { workspaceId } = c.req.valid("param");
    const result = await saveFromRequest(
      c,
      "workspace",
      workspaceId,
      c.req.valid("json"),
    );
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "no-store");
    return c.json(adminResponse(result.overrides), 200);
  });

const portalRoute = createRoute({
  ...instanceBase,
  method: "get",
  path: "/",
  operationId: "getPortalTerminology",
  summary: "Get public and authorized workspace terminology for the portal",
  middleware: [session] as const,
  request: { query: terminologyPortalQuerySchema },
  responses: {
    200: jsonResponse(
      "Customer terminology overlays",
      terminologyPublicResponseSchema,
    ),
    404: apiError("Not found"),
  },
});
export const portalTerminology = apiRouter().openapi(portalRoute, async (c) => {
  const sessionData = c.get("session") as { portal?: string } | null;
  if (
    portalForHost(c.req.header("host")) !== "customer" ||
    sessionData?.portal !== "customer"
  )
    throw new HTTPException(404, { message: "Not found" });
  const identity = await portalIdentity(c.get("userId"));
  const query = c.req.valid("query");
  let workspaceId: string | null = null;
  if (query.requestTypeKey) {
    const type = (await portalCatalogue(identity.organisationId)).find(
      (item) => item.type.key === query.requestTypeKey,
    );
    if (!type) throw new HTTPException(404, { message: "Not found" });
    workspaceId = type.workspaceId;
  } else if (query.submissionRef) {
    const submission = await findSubmission(
      query.submissionRef,
      undefined,
      undefined,
      undefined,
      {
        personId: identity.personId,
        organisationId: identity.organisationId,
      },
    );
    if (!submission) throw new HTTPException(404, { message: "Not found" });
    workspaceId = submission.workspaceId;
    await requirePortalIntakeEnabled(workspaceId);
  } else if (query.workItemKey) {
    workspaceId = await readablePortalWorkItemWorkspace(
      query.workItemKey,
      identity.personId,
      identity.organisationId,
    );
    if (!workspaceId) throw new HTTPException(404, { message: "Not found" });
    await requirePortalIntakeEnabled(workspaceId);
  }
  const audience = "customer" as const;
  const snapshot = await db.transaction(
    async (tx) => {
      const [instance, effective] = await Promise.all([
        getInstanceTerminologyOverrides({
          locale: query.locale,
          audience,
          executor: tx,
        }),
        resolveEffectiveTerminology({
          locale: query.locale,
          audience,
          workspaceId,
          executor: tx,
        }),
      ]);
      return { instance, effective };
    },
    { isolationLevel: "repeatable read" },
  );
  // Send only workspace rows authorized by a catalogue/submission proof. Instance-only
  // requests use the public response shape with an empty workspace overlay.
  const data = {
    ...snapshot.instance,
    ...(workspaceId
      ? {
          terms: snapshot.effective,
          etag: effectiveTerminologyEtag({
            locale: query.locale,
            audience,
            workspaceId,
            terms: snapshot.effective,
          }),
        }
      : { terms: snapshot.instance.terms }),
  };
  c.header("Cache-Control", "private, no-store");
  c.header("Vary", "Host, Cookie");
  setShadowLegacyAuthorization(c, "allowed");
  return c.json(data, 200);
});
