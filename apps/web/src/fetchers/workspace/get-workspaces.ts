import { client } from "@taskdesk/libs";

// S3 (issue #6, retrofit plan §3): native replacement for
// authClient.organization.list() -- GET /api/workspace.
const getWorkspaces = async () => {
  const response = await client.workspace.$get();

  if (!response.ok) {
    throw new Error("Failed to fetch workspaces");
  }

  return response.json();
};

export default getWorkspaces;
