import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { portalForHost } from "../auth";
import db, { schema } from "../database";
import { requireCurrentInstanceAdmin } from "../instance/require-instance-admin";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { resolveRequestIdentity } from "../permissions/resolve-request-identity";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { normaliseTraceId } from "../permissions/shadow-middleware";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { customerPortalStateForOrganisation } from "./enforce";
import {
  type FeatureActor,
  FeatureFlagConflictError,
  FeatureFlagScopeError,
  listInstanceFeatures,
  listProjectFeatures,
  listWorkspaceFeatures,
  lowerLevelFeatures,
  patchInstanceFeatures,
  patchProjectFeatures,
  patchWorkspaceFeatures,
  resolveProjectFeatures,
  resolveWorkspaceFeatureValues,
} from "./repository";
import {
  featureConflictSchema,
  featureProjectParam,
  featureScopeErrorSchema,
  featureWorkspaceParam,
  instanceFeaturesSchema,
  levelFeaturesSchema,
  patchInstanceFeaturesBody,
  patchLevelFeaturesBody,
  portalFeatureStateSchema,
  resolvedFeaturesQuery,
  resolvedFeaturesSchema,
  workspaceResolvedFeaturesSchema,
} from "./schema";

// biome-ignore lint/suspicious/noExplicitAny: handlers run under differing route generics
type Ctx = Context<any>;

async function callerIdentity(c: Ctx) {
  const session = c.get("session") as { impersonatedBy?: string | null } | null;
  const identity = await resolveRequestIdentity({
    userId: c.get("userId"),
    apiKey: c.get("apiKey"),
    impersonatedBy: session?.impersonatedBy,
  });
  if (!identity) throw new HTTPException(403, { message: "Forbidden" });
  return { identity, impersonatedBy: session?.impersonatedBy ?? null };
}

/** `GM-9`: an impersonator may not change settings that outlive the session. */
async function writeActor(c: Ctx): Promise<FeatureActor> {
  const { identity, impersonatedBy } = await callerIdentity(c);
  if (impersonatedBy) {
    throw new HTTPException(403, { message: "impersonation" });
  }
  return {
    userId: c.get("userId"),
    personId: identity.personId,
    impersonatorId: null,
    traceId: normaliseTraceId(c.req.header("x-request-id")),
  };
}

/**
 * `GET /features/resolved?project=` names its project in the query, but the shared
 * project-reach middleware reads path params only (so a body or query id can never
 * authorise one resource while the handler acts on another). This exposes exactly the
 * `project` query value to it as the `project` param, and nothing else.
 */
async function queryProjectAsParam(c: Ctx, next: () => Promise<void>) {
  const project = c.req.query("project");
  const original = c.req.param.bind(c.req) as (key?: string) => unknown;
  (c.req as { param: unknown }).param = (key?: string) =>
    key === "project" ? project : original(key);
  await next();
}

const getInstanceRoute = createRoute({
  method: "get",
  operationId: "getInstanceFeatures",
  path: "/instance/features",
  tags: ["Instance"],
  summary: "List instance feature flags",
  responses: {
    200: jsonResponse("Instance flags with locks", instanceFeaturesSchema),
    403: errorResponse("Forbidden"),
  },
});

const patchInstanceRoute = createRoute({
  method: "patch",
  operationId: "patchInstanceFeatures",
  path: "/instance/features",
  tags: ["Instance"],
  summary: "Change instance feature flags and locks",
  description:
    "Sets the instance value and/or lock of one or more flags (ST-2). Every change is audited as feature_flag.changed.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: patchInstanceFeaturesBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated instance flags", instanceFeaturesSchema),
    403: errorResponse("Forbidden"),
    409: jsonResponse("Locked flag or version conflict", featureConflictSchema),
  },
});

const getWorkspaceRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceFeatures",
  path: "/workspaces/{workspaceId}/features",
  tags: ["Workspaces"],
  summary: "List a workspace's feature flags",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspaceCapability("workspace:manage_settings"),
  ] as const,
  request: { params: featureWorkspaceParam },
  responses: {
    200: jsonResponse("Flags resolved for the workspace", levelFeaturesSchema),
    403: errorResponse("Missing workspace:manage_settings permission"),
  },
});

const getWorkspaceResolvedRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceResolvedFeatures",
  path: "/workspaces/{workspaceId}/features/resolved",
  tags: ["Workspaces"],
  summary: "Effective feature values for a workspace",
  description:
    "Only the effective on/off value of each flag, for navigation. Open to any workspace reader (project:read); the admin list with locks and overrides stays at /features.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspaceCapability("project:read"),
  ] as const,
  request: { params: featureWorkspaceParam },
  responses: {
    200: jsonResponse("Effective values", workspaceResolvedFeaturesSchema),
    403: errorResponse("Missing project:read permission"),
  },
});

const patchWorkspaceRoute = createRoute({
  method: "patch",
  operationId: "patchWorkspaceFeatures",
  path: "/workspaces/{workspaceId}/features",
  tags: ["Workspaces"],
  summary: "Override or clear workspace feature flags",
  description:
    "`enabled: null` clears the workspace override. A flag the instance has locked answers 409 feature_locked (ST-2).",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspaceCapability("workspace:manage_settings"),
  ] as const,
  request: {
    params: featureWorkspaceParam,
    body: {
      required: true,
      content: { "application/json": { schema: patchLevelFeaturesBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated workspace flags", levelFeaturesSchema),
    403: errorResponse("Missing workspace:manage_settings permission"),
    409: jsonResponse("Locked flag or version conflict", featureConflictSchema),
    422: jsonResponse(
      "The flag exists at instance level only",
      featureScopeErrorSchema,
    ),
  },
});

const getProjectRoute = createRoute({
  method: "get",
  operationId: "getProjectFeatures",
  path: "/projects/{projectId}/features",
  tags: ["Projects"],
  summary: "List a project's feature flags",
  middleware: [
    workspaceAccess.fromProject("projectId", { requireProjectReach: true }),
  ] as const,
  request: { params: featureProjectParam },
  responses: {
    200: jsonResponse("Flags resolved for the project", levelFeaturesSchema),
    403: errorResponse("Missing project:manage_settings permission"),
    404: errorResponse("Project not found or out of reach"),
  },
});

const patchProjectRoute = createRoute({
  method: "patch",
  operationId: "patchProjectFeatures",
  path: "/projects/{projectId}/features",
  tags: ["Projects"],
  summary: "Override or clear project feature flags",
  description:
    "`enabled: null` clears the project override. A flag the instance has locked answers 409 feature_locked (ST-2).",
  middleware: [
    workspaceAccess.fromProject("projectId", { requireProjectReach: true }),
  ] as const,
  request: {
    params: featureProjectParam,
    body: {
      required: true,
      content: { "application/json": { schema: patchLevelFeaturesBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated project flags", levelFeaturesSchema),
    403: errorResponse("Missing project:manage_settings permission"),
    404: errorResponse("Project not found or out of reach"),
    409: jsonResponse("Locked flag or version conflict", featureConflictSchema),
    422: jsonResponse(
      "The flag exists at instance level only",
      featureScopeErrorSchema,
    ),
  },
});

const resolvedRoute = createRoute({
  method: "get",
  operationId: "getResolvedFeatures",
  path: "/features/resolved",
  tags: ["Features"],
  summary: "Resolved feature flags for a project",
  description:
    "The fully resolved flag set for the caller's own reach, so clients never re-implement the project, workspace, instance, default order (ST-1).",
  middleware: [
    queryProjectAsParam,
    workspaceAccess.fromProject("project", { requireProjectReach: true }),
  ] as const,
  request: { query: resolvedFeaturesQuery },
  responses: {
    200: jsonResponse("Resolved flags", resolvedFeaturesSchema),
    404: errorResponse("Project not found or out of reach"),
  },
});

/**
 * The signed-in customer's own organisation (policy predicate `own_organisation`). Anything
 * else (agent host, staff or API-key caller, no customer person) answers 404.
 */
async function portalCustomerOrganisation(c: Ctx, next: Next) {
  const session = c.get("session") as { portal?: string } | null;
  const userId = c.get("userId") as string | undefined;
  if (
    !userId ||
    c.get("apiKey") ||
    portalForHost(c.req.header("host")) !== "customer" ||
    session?.portal !== "customer"
  )
    throw new HTTPException(404, { message: "Not found" });
  const [person] = await db
    .select({
      organisationId: schema.personTable.organisationId,
      side: schema.personTable.side,
    })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .limit(1);
  if (person?.side !== "customer")
    throw new HTTPException(404, { message: "Not found" });
  c.set("portalPredicateSatisfied", true);
  c.set("policyOrganisationId", person.organisationId);
  c.set("policyOrganisationIdSource", "row");
  c.set("portalOrganisationId", person.organisationId);
  await next();
}

const portalFeatureStateRoute = createRoute({
  method: "get",
  operationId: "getPortalFeatureState",
  path: "/portal/feature-state",
  tags: ["Portal"],
  summary: "Whether the customer portal is on for the caller's organisation",
  description:
    "`off` when `feature.customer_portal` resolves off for every project and workspace serving the organisation; `unavailable` when it cannot be read.",
  middleware: [portalCustomerOrganisation] as const,
  responses: {
    200: jsonResponse("The portal state", portalFeatureStateSchema),
    404: errorResponse("Not a customer portal session"),
  },
});

function scopeError(error: FeatureFlagScopeError) {
  return { message: error.code, key: error.key };
}

function conflict(error: FeatureFlagConflictError) {
  return {
    message: error.code,
    key: error.key,
    ...(error.version === undefined ? {} : { version: error.version }),
  };
}

const routes = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(getInstanceRoute, async (c) => {
    await requireCurrentInstanceAdmin(c, "GET", "/api/instance/features");
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "no-store");
    return c.json({ features: await listInstanceFeatures() }, 200);
  })
  .openapi(patchInstanceRoute, async (c) => {
    await requireCurrentInstanceAdmin(c, "PATCH", "/api/instance/features");
    const actor = await writeActor(c);
    try {
      await patchInstanceFeatures(c.req.valid("json").changes, actor);
    } catch (error) {
      if (error instanceof FeatureFlagConflictError)
        return c.json(conflict(error), 409);
      throw error;
    }
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "no-store");
    return c.json({ features: await listInstanceFeatures() }, 200);
  })
  .openapi(getWorkspaceRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    return c.json(
      {
        features: lowerLevelFeatures(await listWorkspaceFeatures(workspaceId)),
      },
      200,
    );
  })
  .openapi(getWorkspaceResolvedRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    c.header("Cache-Control", "no-store");
    return c.json(
      { features: await resolveWorkspaceFeatureValues(workspaceId) },
      200,
    );
  })
  .openapi(patchWorkspaceRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    const actor = await writeActor(c);
    try {
      await patchWorkspaceFeatures(
        workspaceId,
        c.req.valid("json").changes,
        actor,
      );
    } catch (error) {
      if (error instanceof FeatureFlagScopeError)
        return c.json(scopeError(error), 422);
      if (error instanceof FeatureFlagConflictError)
        return c.json(conflict(error), 409);
      throw error;
    }
    return c.json(
      {
        features: lowerLevelFeatures(await listWorkspaceFeatures(workspaceId)),
      },
      200,
    );
  })
  .openapi(getProjectRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    return c.json(
      {
        features: lowerLevelFeatures(
          await listProjectFeatures(projectId, workspaceId),
        ),
      },
      200,
    );
  })
  .openapi(patchProjectRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const actor = await writeActor(c);
    try {
      await patchProjectFeatures(
        projectId,
        workspaceId,
        c.req.valid("json").changes,
        actor,
      );
    } catch (error) {
      if (error instanceof FeatureFlagScopeError)
        return c.json(scopeError(error), 422);
      if (error instanceof FeatureFlagConflictError)
        return c.json(conflict(error), 409);
      throw error;
    }
    return c.json(
      {
        features: lowerLevelFeatures(
          await listProjectFeatures(projectId, workspaceId),
        ),
      },
      200,
    );
  })
  .openapi(portalFeatureStateRoute, async (c) => {
    const state = await customerPortalStateForOrganisation(
      c.get("portalOrganisationId") as string,
    );
    c.header("Cache-Control", "no-store");
    return c.json(
      { state: state === "unknown" ? ("unavailable" as const) : state },
      200,
    );
  })
  .openapi(resolvedRoute, async (c) => {
    const { project } = c.req.valid("query");
    const workspaceId = c.get("workspaceId");
    c.header("Cache-Control", "no-store");
    return c.json(
      { features: await resolveProjectFeatures(project, workspaceId) },
      200,
    );
  });

export default routes;
