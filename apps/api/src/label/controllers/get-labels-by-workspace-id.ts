import { listLabelsByWorkspaceQuery } from "../repository";

function getLabelsByWorkspaceId(workspaceId: string) {
  return listLabelsByWorkspaceQuery(workspaceId);
}

export default getLabelsByWorkspaceId;
