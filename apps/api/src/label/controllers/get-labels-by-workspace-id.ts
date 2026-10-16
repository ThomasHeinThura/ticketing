import type { ResolvedIdentity } from "@taskdesk/permissions";
import { listLabelsByWorkspaceId } from "../repository";

/**
 * The workspace's label list. A label DEFINITION (no task) is workspace-level and always
 * listed under current workspace reach. Task-bound copies require current project reach in SQL.
 */
function getLabelsByWorkspaceId(
  identity: ResolvedIdentity,
  workspaceId: string,
) {
  return listLabelsByWorkspaceId(identity, workspaceId);
}

export default getLabelsByWorkspaceId;
