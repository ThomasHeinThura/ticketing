import { HTTPException } from "hono/http-exception";
import { resolveProjectFeatures } from "../feature-flag/repository";

export const AGILE_FEATURES = [
  "feature.cycles",
  "feature.modules",
  "feature.estimates",
] as const;
export type AgileFeature = (typeof AGILE_FEATURES)[number];

/**
 * Is the flag on for this project? Resolves project, workspace, instance, default
 * (`settings-hierarchy.md`) and fails closed: an unreadable flag is off.
 */
export async function agileFeatureEnabled(
  feature: AgileFeature,
  workspaceId: string,
  projectId: string,
): Promise<boolean> {
  try {
    const features = await resolveProjectFeatures(projectId, workspaceId);
    return features.find((entry) => entry.key === feature)?.enabled === true;
  } catch {
    return false;
  }
}

/**
 * Feature off: the screens and data are hidden, the rows are retained and come back on re-enable
 * ("Feature disabled while cycles exist", feature-contracts-p5.md). One answer everywhere: 404
 * `feature_disabled`.
 */
export async function requireAgileFeature(
  feature: AgileFeature,
  workspaceId: string,
  projectId: string,
): Promise<void> {
  if (!(await agileFeatureEnabled(feature, workspaceId, projectId)))
    throw new HTTPException(404, { message: "feature_disabled" });
}
