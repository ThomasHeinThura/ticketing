import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

async function updateWorkItemComment({
  id,
  body,
}: {
  id: string;
  body: unknown;
}) {
  const response = await client.comments[":id"].$patch({
    param: { id },
    json: { body },
  });
  if (!response.ok) {
    throw new HttpError(response.status, "Failed to update comment");
  }
  return response.json();
}

export default updateWorkItemComment;
