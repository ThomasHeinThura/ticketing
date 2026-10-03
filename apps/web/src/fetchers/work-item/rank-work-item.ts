import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

export default async function rankWorkItem(input: {
  key: string;
  beforeId?: string;
  afterId?: string;
}) {
  const response = await client["work-items"][":key"].rank.$post({
    param: { key: input.key },
    json: {
      ...(input.beforeId ? { beforeId: input.beforeId } : {}),
      ...(input.afterId ? { afterId: input.afterId } : {}),
    },
  });
  if (!response.ok) {
    throw new HttpError(response.status, "Failed to reorder work item");
  }
  return response.json();
}
