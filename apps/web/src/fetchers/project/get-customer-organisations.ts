import { client } from "@taskdesk/libs";

export type CustomerOrganisation = { id: string; name: string };

async function getCustomerOrganisations(workspaceId: string) {
  const response = await client.project.organisations.$get({
    query: { workspaceId },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as CustomerOrganisation[];
}

export default getCustomerOrganisations;
