import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

async function createWorkItemComment({
  key,
  body,
  visibility,
}: {
  key: string;
  body: unknown;
  visibility: "public" | "internal";
}) {
  const response = await client["work-items"][":key"].comments.$post({
    param: { key },
    json: { body, visibility },
  });
  if (!response.ok) {
    throw new HttpError(response.status, "Failed to create comment");
  }
  return response.json();
}

export default createWorkItemComment;
