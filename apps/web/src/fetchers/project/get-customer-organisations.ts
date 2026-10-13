import { client } from "@taskdesk/libs";
import type { InferRequestType } from "hono/client";

export type GetCustomerOrganisationsRequest = InferRequestType<
  (typeof client)["project"]["organisations"]["$get"]
>["query"];

async function getCustomerOrganisations({
  workspaceId,
}: GetCustomerOrganisationsRequest) {
  const response = await client.project.organisations.$get({
    query: { workspaceId },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return response.json();
}

export default getCustomerOrganisations;
