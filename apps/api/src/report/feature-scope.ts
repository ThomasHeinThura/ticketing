import { sql } from "drizzle-orm";
import type { Executor } from "../database/executor";
import {
  workspaceFeatureEnabled as flagOnForWorkspace,
  projectsWithFeatureEnabled,
} from "../feature-flag/enforce";
import { selectRows } from "./context";
import { workspaceFeatureEnabled } from "./feature";

/** Report features resolved per project: a project override can switch them on or off (ST-1). */
const PROJECT_LEVEL_FEATURES = new Set(["feature.sla"]);

/**
 * Where a report's feature is on in a workspace (P4, feature flags at project scope).
 * - `null`: the report has no feature, or a workspace-level one: no project restriction.
 * - `"off"`: the feature is on nowhere in the workspace, so the report is refused (409).
 * - `string[]`: the projects whose rows the report may count; every query is restricted to them.
 *
 * `feature.sla` is on for the workspace when its workspace value is on OR any of its projects
 * has an override that turns it on; the rows then come only from projects where it resolves on.
 */
export async function reportFeatureScope(
  feature: string | undefined,
  workspaceId: string,
  executor?: Executor,
): Promise<null | "off" | string[]> {
  if (!feature) return null;
  if (!PROJECT_LEVEL_FEATURES.has(feature))
    return (await workspaceFeatureEnabled(workspaceId, feature, executor))
      ? null
      : "off";
  const candidates = await selectRows<{ id: string }>(
    sql`SELECT id FROM project WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL`,
    executor,
  );
  const on = await projectsWithFeatureEnabled(
    "feature.sla",
    candidates.map((row) => row.id),
    executor,
  );
  if (
    on.size === 0 &&
    !(await flagOnForWorkspace("feature.sla", workspaceId, executor))
  )
    return "off";
  return [...on];
}
