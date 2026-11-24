import { client } from "@taskdesk/libs";

/**
 * The current key of a project that holds, or once held, `key`. `null` for every refusal
 * (unknown, out of reach, another workspace's): the API answers them all with one 404.
 */
export default async function resolveProjectKey({
  workspaceId,
  key,
}: {
  workspaceId: string;
  key: string;
}) {
  const response = await client.project["by-key"].$get({
    query: { workspaceId, key },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Failed to resolve the project key");
  return (await response.json()).slug;
}
