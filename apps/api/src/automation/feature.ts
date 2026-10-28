import {
  listWorkspaceFeatures,
  resolveProjectFeatures,
} from "../feature-flag/repository";

export const AUTOMATIONS_FEATURE_KEY = "feature.automations";

/**
 * Is `feature.automations` on for this scope? The flag resolves instance -> workspace -> project
 * (`settings-hierarchy.md`); a project rule is decided at project level, a workspace rule at
 * workspace level. Fails closed: an unreadable flag is off, so a broken flag lookup stops rules
 * rather than running them.
 */
export async function automationsEnabled(
  workspaceId: string,
  projectId: string | null,
): Promise<boolean> {
  try {
    const features = projectId
      ? await resolveProjectFeatures(projectId, workspaceId)
      : await listWorkspaceFeatures(workspaceId);
    return (
      features.find((entry) => entry.key === AUTOMATIONS_FEATURE_KEY)
        ?.enabled === true
    );
  } catch {
    return false;
  }
}
