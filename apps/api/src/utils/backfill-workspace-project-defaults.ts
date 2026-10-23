import { backfillWorkspaceAndProjectDefaults as runBackfill } from "../database/repositories/backfill-workspace-project-defaults.repository";
import { repairDefaultWorkflows } from "./seed-default-workflow";

export type {
  BackfillSummary,
  ProjectBackfillSummary,
  WorkspaceBackfillSummary,
} from "../database/repositories/backfill-workspace-project-defaults.repository";

/**
 * Run the legacy workspace and project default backfill during API boot, then give every
 * workspace's unconfigured builtin types the default workflow (work-item creation requires a
 * leaveable default state, so a backfilled workspace without it could not create items).
 */
export async function backfillWorkspaceAndProjectDefaults() {
  const summary = await runBackfill();
  await repairDefaultWorkflows();
  return summary;
}
export default backfillWorkspaceAndProjectDefaults;
