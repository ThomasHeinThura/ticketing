import { FEATURE_FLAGS, isFeatureFlag } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { normaliseTraceId } from "../permissions/shadow-middleware";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { resolveFeatureSet } from "./runtime";

const featureParam = z.object({ featureKey: z.string().refine(isFeatureFlag) });
const workspaceParam = z.object({ workspaceId: z.string().min(1) });
const projectParam = z.object({ projectId: z.string().min(1) });
const featureQuery = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).optional(),
});
const updateBody = z
  .object({ version: z.number().int().min(0), enabled: z.boolean() })
  .strict();
const settingItem = z.object({
  key: z.string(),
  enabled: z.boolean(),
  locked: z.boolean(),
  version: z.number().int().min(0),
  override: z.boolean(),
  source: z.enum(["project", "workspace", "instance", "default"]),
});
const settingList = z.object({ items: z.array(settingItem) });
const resolvedList = z.object({
  workspaceId: z.string(),
  projectId: z.string().nullable(),
  items: z.array(
    z.object({
      key: z.string(),
      enabled: z.boolean(),
      source: z.enum(["project", "workspace", "instance", "default"]),
    }),
  ),
});

async function workspaceSettings(workspaceId: string) {
  const [overrides, instances, resolved] = await Promise.all([
    db
      .select()
      .from(schema.workspaceFeatureFlagTable)
      .where(eq(schema.workspaceFeatureFlagTable.workspaceId, workspaceId)),
    db.select().from(schema.instanceFeatureFlagTable),
    resolveFeatureSet({ workspaceId }),
  ]);
  const overrideByKey = new Map(overrides.map((row) => [row.featureKey, row]));
  const instanceByKey = new Map(instances.map((row) => [row.featureKey, row]));
  const effectiveByKey = new Map(resolved.map((row) => [row.key, row]));
  return FEATURE_FLAGS.map((key) => {
    const override = overrideByKey.get(key);
    const instance = instanceByKey.get(key);
    const effective = effectiveByKey.get(key)!;
    return {
      key,
      enabled: override?.enabled ?? effective.enabled,
      locked: instance?.locked ?? false,
      version: override?.version ?? 0,
      override: override !== undefined,
      source: override ? ("workspace" as const) : effective.source,
    };
  });
}

async function projectSettings(projectId: string, workspaceId: string) {
  const [overrides, instances, resolved] = await Promise.all([
    db
      .select()
      .from(schema.projectFeatureFlagTable)
      .where(eq(schema.projectFeatureFlagTable.projectId, projectId)),
    db.select().from(schema.instanceFeatureFlagTable),
    resolveFeatureSet({ workspaceId, projectId }),
  ]);
  const overrideByKey = new Map(overrides.map((row) => [row.featureKey, row]));
  const instanceByKey = new Map(instances.map((row) => [row.featureKey, row]));
  const effectiveByKey = new Map(resolved.map((row) => [row.key, row]));
  return FEATURE_FLAGS.map((key) => {
    const override = overrideByKey.get(key);
    const instance = instanceByKey.get(key);
    const effective = effectiveByKey.get(key)!;
    return {
      key,
      enabled: override?.enabled ?? effective.enabled,
      locked: instance?.locked ?? false,
      version: override?.version ?? 0,
      override: override !== undefined,
      source: override ? ("project" as const) : effective.source,
    };
  });
}

const workspaceGet = createRoute({
  method: "get",
  path: "/workspaces/{workspaceId}/features",
  operationId: "getWorkspaceFeatures",
  tags: ["Feature flags"],
  summary: "List workspace feature overrides",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspaceCapability("workspace:manage_settings"),
  ] as const,
  request: { params: workspaceParam },
  responses: {
    200: jsonResponse("Feature settings", settingList),
    403: errorResponse("Forbidden"),
    404: errorResponse("Workspace not found"),
  },
});
const workspacePatch = createRoute({
  method: "patch",
  path: "/workspaces/{workspaceId}/features/{featureKey}",
  operationId: "updateWorkspaceFeature",
  tags: ["Feature flags"],
  summary: "Update a workspace feature override",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspaceCapability("workspace:manage_settings"),
  ] as const,
  request: {
    params: workspaceParam.merge(featureParam),
    body: {
      required: true,
      content: { "application/json": { schema: updateBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated feature", settingItem),
    400: errorResponse("Unknown feature"),
    403: errorResponse("Forbidden"),
    409: errorResponse("Locked or stale feature flag"),
  },
});
const projectGet = createRoute({
  method: "get",
  path: "/projects/{projectId}/features",
  operationId: "getProjectFeatures",
  tags: ["Feature flags"],
  summary: "List project feature overrides",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspaceCapability("project:manage_settings"),
  ] as const,
  request: { params: projectParam },
  responses: {
    200: jsonResponse("Feature settings", settingList),
    403: errorResponse("Forbidden"),
    404: errorResponse("Project not found"),
  },
});
const projectPatch = createRoute({
  method: "patch",
  path: "/projects/{projectId}/features/{featureKey}",
  operationId: "updateProjectFeature",
  tags: ["Feature flags"],
  summary: "Update a project feature override",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspaceCapability("project:manage_settings"),
  ] as const,
  request: {
    params: projectParam.merge(featureParam),
    body: {
      required: true,
      content: { "application/json": { schema: updateBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated feature", settingItem),
    400: errorResponse("Unknown feature"),
    403: errorResponse("Forbidden"),
    409: errorResponse("Locked or stale feature flag"),
  },
});
const resolvedGet = createRoute({
  method: "get",
  path: "/features/resolved",
  operationId: "getResolvedFeatures",
  tags: ["Feature flags"],
  summary: "Resolve feature flags for a reachable context",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspaceCapability("workspace:read"),
  ] as const,
  request: { query: featureQuery },
  responses: {
    200: jsonResponse("Resolved feature flags", resolvedList),
    403: errorResponse("Forbidden"),
    404: errorResponse("Project not found"),
  },
});

const routes = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(workspaceGet, async (c) => {
    const { workspaceId } = c.req.valid("param");
    setShadowLegacyAuthorization(c, "allowed");
    return c.json({ items: await workspaceSettings(workspaceId) }, 200);
  })
  .openapi(workspacePatch, async (c) => {
    const { workspaceId, featureKey } = c.req.valid("param");
    const { version, enabled } = c.req.valid("json");
    if (!isFeatureFlag(featureKey))
      throw new HTTPException(400, { message: "Unknown feature" });
    const result = await db.transaction(async (tx) => {
      await tx
        .select({ id: schema.workspaceTable.id })
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId))
        .for("update");
      const [instance] = await tx
        .select()
        .from(schema.instanceFeatureFlagTable)
        .where(eq(schema.instanceFeatureFlagTable.featureKey, featureKey))
        .for("update")
        .limit(1);
      if (instance?.locked)
        throw new HTTPException(409, {
          message: "Feature is locked at the instance level",
        });
      const [current] = await tx
        .select()
        .from(schema.workspaceFeatureFlagTable)
        .where(
          and(
            eq(schema.workspaceFeatureFlagTable.workspaceId, workspaceId),
            eq(schema.workspaceFeatureFlagTable.featureKey, featureKey),
          ),
        )
        .for("update")
        .limit(1);
      if ((current?.version ?? 0) !== version)
        throw new HTTPException(409, {
          message: "Feature settings changed; reload and retry",
        });
      const [actor] = await tx
        .select({ id: schema.personTable.id })
        .from(schema.personTable)
        .where(
          and(
            eq(schema.personTable.userId, c.get("userId") as string),
            eq(schema.personTable.side, "staff"),
            eq(schema.personTable.active, true),
          ),
        )
        .limit(1);
      if (!actor) throw new HTTPException(403, { message: "Forbidden" });
      const [updated] = current
        ? await tx
            .update(schema.workspaceFeatureFlagTable)
            .set({
              enabled,
              version: version + 1,
              updatedBy: actor.id,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.workspaceFeatureFlagTable.workspaceId, workspaceId),
                eq(schema.workspaceFeatureFlagTable.featureKey, featureKey),
              ),
            )
            .returning()
        : await tx
            .insert(schema.workspaceFeatureFlagTable)
            .values({
              workspaceId,
              featureKey,
              enabled,
              version: 1,
              updatedBy: actor.id,
            })
            .returning();
      if (!updated)
        throw new HTTPException(503, {
          message: "Feature setting unavailable",
        });
      await appendAuditLog(tx, {
        action: "feature_flag.changed",
        actorId: c.get("userId") as string,
        actorType: "person",
        traceId: normaliseTraceId(c.req.header("x-request-id")),
        workspaceId,
        entityType: "workspace_feature_flag",
        entityId: `${workspaceId}:${featureKey}`,
        before: current ? { enabled: current.enabled } : null,
        after: { enabled: updated.enabled },
      });
      return {
        key: featureKey,
        enabled: updated.enabled,
        locked: false,
        version: updated.version,
        override: true,
        source: "workspace" as const,
      };
    });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(result, 200);
  })
  .openapi(projectGet, async (c) => {
    const { projectId } = c.req.valid("param");
    const workspaceId = c.get("workspaceId") as string | undefined;
    if (!workspaceId)
      throw new HTTPException(404, { message: "Project not found" });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      { items: await projectSettings(projectId, workspaceId) },
      200,
    );
  })
  .openapi(projectPatch, async (c) => {
    const { projectId, featureKey } = c.req.valid("param");
    const workspaceId = c.get("workspaceId") as string | undefined;
    const { version, enabled } = c.req.valid("json");
    if (!workspaceId || !isFeatureFlag(featureKey))
      throw new HTTPException(400, { message: "Unknown feature" });
    const result = await db.transaction(async (tx) => {
      const [project] = await tx
        .select({
          id: schema.projectTable.id,
          workspaceId: schema.projectTable.workspaceId,
        })
        .from(schema.projectTable)
        .where(
          and(
            eq(schema.projectTable.id, projectId),
            eq(schema.projectTable.workspaceId, workspaceId),
          ),
        )
        .for("update")
        .limit(1);
      if (!project)
        throw new HTTPException(404, { message: "Project not found" });
      const [instance] = await tx
        .select()
        .from(schema.instanceFeatureFlagTable)
        .where(eq(schema.instanceFeatureFlagTable.featureKey, featureKey))
        .for("update")
        .limit(1);
      if (instance?.locked)
        throw new HTTPException(409, {
          message: "Feature is locked at the instance level",
        });
      const [current] = await tx
        .select()
        .from(schema.projectFeatureFlagTable)
        .where(
          and(
            eq(schema.projectFeatureFlagTable.projectId, projectId),
            eq(schema.projectFeatureFlagTable.featureKey, featureKey),
          ),
        )
        .for("update")
        .limit(1);
      if ((current?.version ?? 0) !== version)
        throw new HTTPException(409, {
          message: "Feature settings changed; reload and retry",
        });
      const [actor] = await tx
        .select({ id: schema.personTable.id })
        .from(schema.personTable)
        .where(
          and(
            eq(schema.personTable.userId, c.get("userId") as string),
            eq(schema.personTable.side, "staff"),
            eq(schema.personTable.active, true),
          ),
        )
        .limit(1);
      if (!actor) throw new HTTPException(403, { message: "Forbidden" });
      const [updated] = current
        ? await tx
            .update(schema.projectFeatureFlagTable)
            .set({
              enabled,
              version: version + 1,
              updatedBy: actor.id,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.projectFeatureFlagTable.projectId, projectId),
                eq(schema.projectFeatureFlagTable.featureKey, featureKey),
              ),
            )
            .returning()
        : await tx
            .insert(schema.projectFeatureFlagTable)
            .values({
              projectId,
              featureKey,
              enabled,
              version: 1,
              updatedBy: actor.id,
            })
            .returning();
      if (!updated)
        throw new HTTPException(503, {
          message: "Feature setting unavailable",
        });
      await appendAuditLog(tx, {
        action: "feature_flag.changed",
        actorId: c.get("userId") as string,
        actorType: "person",
        traceId: normaliseTraceId(c.req.header("x-request-id")),
        workspaceId,
        projectId,
        entityType: "project_feature_flag",
        entityId: `${projectId}:${featureKey}`,
        before: current ? { enabled: current.enabled } : null,
        after: { enabled: updated.enabled },
      });
      return {
        key: featureKey,
        enabled: updated.enabled,
        locked: false,
        version: updated.version,
        override: true,
        source: "project" as const,
      };
    });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(result, 200);
  })
  .openapi(resolvedGet, async (c) => {
    const { workspaceId, projectId } = c.req.valid("query");
    const items = await resolveFeatureSet({ workspaceId, projectId });
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "private, no-store");
    return c.json({ workspaceId, projectId: projectId ?? null, items }, 200);
  });

export default routes;
