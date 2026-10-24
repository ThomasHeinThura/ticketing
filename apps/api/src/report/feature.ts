import { listWorkspaceFeatures } from "../feature-flag/repository";

export const REPORTS_FEATURE_KEY = "feature.reports";

/** Resolve a feature flag for a workspace (instance, workspace, default). Fails closed. */
export async function workspaceFeatureEnabled(
  workspaceId: string,
  key: string,
): Promise<boolean> {
  try {
    const features = await listWorkspaceFeatures(workspaceId);
    return features.find((entry) => entry.key === key)?.enabled === true;
  } catch {
    return false;
  }
}
