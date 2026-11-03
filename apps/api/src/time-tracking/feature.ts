import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { cycleTable, moduleTable } from "../database/schema-p5-agile";
import {
  listWorkspaceFeatures,
  projectsWithFeature,
  resolveProjectFeatures,
} from "../feature-flag/repository";

export const TIME_TRACKING_FEATURE_KEY = "feature.time_tracking";
export const COST_TRACKING_FEATURE_KEY = "feature.cost_tracking";

/** The project-level answer (project, workspace, instance, default) refuses with 409 `feature_disabled`. */
export async function assertTrackingEnabledForProject(
  workspaceId: string,
  projectId: string,
  ...keys: Array<
    typeof TIME_TRACKING_FEATURE_KEY | typeof COST_TRACKING_FEATURE_KEY
  >
): Promise<void> {
  for (const key of keys)
    if (!(await trackingFeatureEnabled(key, workspaceId, projectId)))
      throw new HTTPException(409, { message: "feature_disabled" });
}

/**
 * Resolve a time/cost feature flag (instance, workspace, project hierarchy). Fails closed: an
 * unreadable flag is off, so a broken lookup stops tracking rather than allowing it.
 */
export async function trackingFeatureEnabled(
  key: typeof TIME_TRACKING_FEATURE_KEY | typeof COST_TRACKING_FEATURE_KEY,
  workspaceId: string,
  projectId: string | null = null,
): Promise<boolean> {
  try {
    const features = projectId
      ? await resolveProjectFeatures(projectId, workspaceId)
      : await listWorkspaceFeatures(workspaceId);
    return features.find((entry) => entry.key === key)?.enabled === true;
  } catch {
    return false;
  }
}

/**
 * A-10: the project level decides (features.md). A workspace-wide time read (the timer, the
 * activity catalogue, review notices) is open while tracking is on for the workspace or for at
 * least one live project in it; each item- or project-bound read and write is still checked at
 * its own project. Fails closed.
 */
export async function trackingFeatureReachable(
  key: typeof TIME_TRACKING_FEATURE_KEY | typeof COST_TRACKING_FEATURE_KEY,
  workspaceId: string,
): Promise<boolean> {
  if (await trackingFeatureEnabled(key, workspaceId)) return true;
  try {
    const overrides = await db
      .select({ projectId: schema.projectFeatureFlagTable.projectId })
      .from(schema.projectFeatureFlagTable)
      .innerJoin(
        schema.projectTable,
        eq(schema.projectTable.id, schema.projectFeatureFlagTable.projectId),
      )
      .where(
        and(
          eq(schema.projectTable.workspaceId, workspaceId),
          isNull(schema.projectTable.deletedAt),
          eq(schema.projectFeatureFlagTable.featureKey, key),
          eq(schema.projectFeatureFlagTable.enabled, true),
        ),
      );
    if (overrides.length === 0) return false;
    const enabled = await projectsWithFeature(
      key,
      workspaceId,
      overrides.map((row) => row.projectId),
    );
    return enabled.length > 0;
  } catch {
    return false;
  }
}

/**
 * A-10: the projects of a workspace whose own answer for `key` is on (project, workspace,
 * instance, default). A workspace-wide list keeps only rows of these projects, so a project
 * switched off never shows through a read that names no project. Fails closed (no projects).
 */
export async function trackingProjectsInWorkspace(
  key: typeof TIME_TRACKING_FEATURE_KEY | typeof COST_TRACKING_FEATURE_KEY,
  workspaceId: string,
): Promise<string[]> {
  try {
    const projects = await db
      .select({ id: schema.projectTable.id })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.workspaceId, workspaceId));
    return await projectsWithFeature(
      key,
      workspaceId,
      projects.map((project) => project.id),
    );
  } catch {
    return [];
  }
}

/**
 * The project a time request is bound to, read only from the workspace the request already
 * resolved: a work item, cycle, module or project id from another workspace resolves to nothing.
 */
export async function trackingProjectInWorkspace(
  workspaceId: string,
  ref: {
    projectId?: string | null;
    workItemId?: string | null;
    cycleId?: string | null;
    moduleId?: string | null;
  },
): Promise<string | null> {
  if (ref.workItemId) {
    const [item] = await db
      .select({ projectId: schema.workItemTable.projectId })
      .from(schema.workItemTable)
      .where(
        and(
          eq(schema.workItemTable.id, ref.workItemId),
          eq(schema.workItemTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    return item?.projectId ?? null;
  }
  if (ref.cycleId) {
    const [cycle] = await db
      .select({ projectId: cycleTable.projectId })
      .from(cycleTable)
      .where(
        and(
          eq(cycleTable.id, ref.cycleId),
          eq(cycleTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    return cycle?.projectId ?? null;
  }
  if (ref.moduleId) {
    const [module] = await db
      .select({ projectId: moduleTable.projectId })
      .from(moduleTable)
      .where(
        and(
          eq(moduleTable.id, ref.moduleId),
          eq(moduleTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    return module?.projectId ?? null;
  }
  if (ref.projectId) {
    const [project] = await db
      .select({ id: schema.projectTable.id })
      .from(schema.projectTable)
      .where(
        and(
          eq(schema.projectTable.id, ref.projectId),
          eq(schema.projectTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    return project?.id ?? null;
  }
  return null;
}
