import { listWorkspaceMembersQuery } from "../repository";

async function getWorkspaceMembers(workspaceId: string) {
  const members = await listWorkspaceMembersQuery(workspaceId);

  return members;
}

export default getWorkspaceMembers;
