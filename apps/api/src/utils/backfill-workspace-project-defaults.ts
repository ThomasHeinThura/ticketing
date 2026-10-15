import { backfillWorkspaceAndProjectDefaults as runBackfill } from "../database/repositories/backfill-workspace-project-defaults.repository";

export type {
  BackfillSummary,
  ProjectBackfillSummary,
  WorkspaceBackfillSummary,
} from "../database/repositories/backfill-workspace-project-defaults.repository";

/** Run the legacy workspace and project default backfill during API boot. */
export const backfillWorkspaceAndProjectDefaults = runBackfill;
export default backfillWorkspaceAndProjectDefaults;
