import {
  FEATURE_FLAG_DEFAULTS,
  FEATURE_FLAGS,
  type FeatureFlag,
  resolveFeatureFlag,
} from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";

export type FeatureResolution = {
  key: FeatureFlag;
  enabled: boolean;
  source: "project" | "workspace" | "instance" | "default";
};

export async function resolveFeatureSet(input: {
  workspaceId?: string;
  projectId?: string;
}): Promise<FeatureResolution[]> {
  if (input.projectId && !input.workspaceId) {
    throw new HTTPException(400, { message: "workspaceId is required" });
  }
  if (input.projectId) {
    const [project] = await db
      .select({ id: schema.projectTable.id })
      .from(schema.projectTable)
      .where(
        and(
          eq(schema.projectTable.id, input.projectId),
          eq(schema.projectTable.workspaceId, input.workspaceId!),
        ),
      )
      .limit(1);
    if (!project) throw new HTTPException(404, { message: "Not found" });
  }
  const [instances, workspaces, projects] = await Promise.all([
    db.select().from(schema.instanceFeatureFlagTable),
    input.workspaceId
      ? db
          .select()
          .from(schema.workspaceFeatureFlagTable)
          .where(
            eq(schema.workspaceFeatureFlagTable.workspaceId, input.workspaceId),
          )
      : Promise.resolve([]),
    input.projectId
      ? db
          .select()
          .from(schema.projectFeatureFlagTable)
          .where(eq(schema.projectFeatureFlagTable.projectId, input.projectId))
      : Promise.resolve([]),
  ]);
  const instanceByKey = new Map(instances.map((row) => [row.featureKey, row]));
  const workspaceByKey = new Map(
    workspaces.map((row) => [row.featureKey, row.enabled]),
  );
  const projectByKey = new Map(
    projects.map((row) => [row.featureKey, row.enabled]),
  );
  return FEATURE_FLAGS.map((key) => {
    const instance = instanceByKey.get(key);
    const resolved = resolveFeatureFlag({
      feature: key,
      instance: instance
        ? { enabled: instance.enabled, locked: instance.locked }
        : null,
      workspace: workspaceByKey.get(key),
      project: projectByKey.get(key),
    });
    return { key, ...resolved };
  });
}

export async function isFeatureEnabled(
  feature: FeatureFlag,
  context: { workspaceId?: string; projectId?: string } = {},
): Promise<boolean> {
  const resolved = await resolveFeatureSet(context);
  return (
    resolved.find((entry) => entry.key === feature)?.enabled ??
    FEATURE_FLAG_DEFAULTS[feature]
  );
}

export function requireFeatureEnabled(
  feature: FeatureFlag,
  context: (c: Context) => { workspaceId?: string; projectId?: string },
) {
  return async (c: Context, next: Next) => {
    if (!(await isFeatureEnabled(feature, context(c)))) {
      throw new HTTPException(404, { message: "Not found" });
    }
    await next();
  };
}
