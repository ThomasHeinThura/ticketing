import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

export default async function createWorkItemComment(input: {
  key: string;
  body: unknown;
  visibility: "public" | "internal";
}) {
  const response = await client["work-items"][":key"].comments.$post({
    param: { key: input.key },
    json: { body: input.body, visibility: input.visibility },
  });
  if (!response.ok)
    throw new HttpError(response.status, "Failed to create work item comment");
  return response.json();
}
