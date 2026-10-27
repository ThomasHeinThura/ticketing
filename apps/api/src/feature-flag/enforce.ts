import { type FeatureFlag, resolveFeatureFlag } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import type { Context, MiddlewareHandler, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import type { Executor } from "../database/executor";

/**
 * Runtime enforcement of a feature flag (`ST-1`, `ST-11`; features.md "Disabled features are
 * enforced by the API and UI; hiding navigation alone is insufficient"). Every helper resolves
 * the same project -> workspace -> instance -> built-in default chain as the settings screens
 * and **fails closed**: a flag that cannot be read is off.
 */

async function instanceView(feature: FeatureFlag, executor: Executor = db) {
  const [row] = await executor
    .select({
      enabled: schema.instanceFeatureFlagTable.enabled,
      locked: schema.instanceFeatureFlagTable.locked,
    })
    .from(schema.instanceFeatureFlagTable)
    .where(eq(schema.instanceFeatureFlagTable.featureKey, feature))
    .limit(1);
  return row ?? null;
}

/** The instance-level value, for surfaces that belong to no workspace (SCIM). */
export async function instanceFeatureEnabled(
  feature: FeatureFlag,
): Promise<boolean> {
  try {
    return resolveFeatureFlag({
      feature,
      instance: await instanceView(feature),
    }).enabled;
  } catch {
    return false;
  }
}

/**
 * The value for one workspace (workspace override, instance, default). Pass the open
 * transaction as `executor` when calling from inside one, so the read never waits for a second
 * pool connection while the transaction holds the first.
 */
export async function workspaceFeatureEnabled(
  feature: FeatureFlag,
  workspaceId: string,
  executor: Executor = db,
): Promise<boolean> {
  try {
    const instance = await instanceView(feature, executor);
    const [workspace] = await executor
      .select({ enabled: schema.workspaceFeatureFlagTable.enabled })
      .from(schema.workspaceFeatureFlagTable)
      .where(
        and(
          eq(schema.workspaceFeatureFlagTable.workspaceId, workspaceId),
          eq(schema.workspaceFeatureFlagTable.featureKey, feature),
        ),
      )
      .limit(1);
    return resolveFeatureFlag({
      feature,
      instance,
      workspace: workspace?.enabled ?? null,
    }).enabled;
  } catch {
    return false;
  }
}

/**
 * Whether the feature is on for the instance or for at least one workspace. For surfaces that
 * are not addressed to a workspace (the customer-portal host, `feature.customer_portal`): they
 * answer while any workspace offers the feature, and not at all when none does.
 */
export async function featureEnabledSomewhere(
  feature: FeatureFlag,
): Promise<boolean> {
  try {
    const instance = await instanceView(feature);
    if (resolveFeatureFlag({ feature, instance }).enabled) return true;
    if (instance?.locked) return false;
    const rows = await db
      .select({ enabled: schema.workspaceFeatureFlagTable.enabled })
      .from(schema.workspaceFeatureFlagTable)
      .where(eq(schema.workspaceFeatureFlagTable.featureKey, feature));
    return rows.some(
      (row) =>
        resolveFeatureFlag({ feature, instance, workspace: row.enabled })
          .enabled,
    );
  } catch {
    return false;
  }
}

/**
 * Route middleware: the feature must be on for the request's resolved workspace, otherwise the
 * route answers exactly like one that does not exist (404). Place it after the middleware that
 * sets `workspaceId` and after the capability check, so an unauthorised caller still sees 403.
 */
export function requireWorkspaceFeature(
  feature: FeatureFlag,
): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const workspaceId = c.get("workspaceId") as string | undefined;
    if (!workspaceId || !(await workspaceFeatureEnabled(feature, workspaceId)))
      throw new HTTPException(404, { message: "Not found" });
    await next();
  };
}
