import { client } from "@taskdesk/libs";

export type DeleteWorkspaceRequest = { id: string };

const deleteWorkspace = async ({ id }: DeleteWorkspaceRequest) => {
  // S4b: native replacement for authClient.organization.delete().
  const response = await client.workspace[":workspaceId"].$delete({
    param: { workspaceId: id },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return await response.json();
};

export default deleteWorkspace;
