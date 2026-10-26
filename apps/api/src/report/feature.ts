import type { Executor } from "../database/executor";
import { listWorkspaceFeatures } from "../feature-flag/repository";
import { currentReportExecutor } from "./context";

export const REPORTS_FEATURE_KEY = "feature.reports";

/** Resolve a feature flag for a workspace (instance, workspace, default). Fails closed. */
export async function workspaceFeatureEnabled(
  workspaceId: string,
  key: string,
  executor: Executor | undefined = currentReportExecutor(),
): Promise<boolean> {
  try {
    const features = await listWorkspaceFeatures(workspaceId, executor);
    return features.find((entry) => entry.key === key)?.enabled === true;
  } catch {
    return false;
  }
}
