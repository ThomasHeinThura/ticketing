import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

export type CannedResponse = {
  id: string;
  name: string;
  body: unknown;
  visibilityDefault: string;
};

async function listCannedResponses(
  workspaceId: string,
): Promise<CannedResponse[]> {
  const response = await client["canned-responses"].$get({
    query: { workspaceId },
  });
  if (!response.ok) {
    throw new HttpError(response.status, "Failed to fetch canned responses");
  }
  return response.json();
}

export default listCannedResponses;
