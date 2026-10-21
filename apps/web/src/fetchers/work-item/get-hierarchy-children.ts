import { client } from "@taskdesk/libs";
import { HttpError, readErrorDetail } from "@/lib/http-error";

export async function getHierarchyChildren(
  key: string,
  cursor?: string,
  signal?: AbortSignal,
) {
  const response = await client["work-items"][":key"].children.$get(
    {
      param: { key },
      query: { limit: "50", ...(cursor ? { cursor } : {}) },
    },
    { init: { signal } },
  );
  if (!response.ok)
    throw new HttpError(response.status, await readErrorDetail(response));
  return response.json();
}
