import { HTTPException } from "hono/http-exception";
import {
  listWorkspaceFeatures,
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
