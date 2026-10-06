import { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

const views = client.views;

export type SavedView = InferResponseType<typeof views.$get, 200>[number];

export async function getSavedViews(workspaceId: string): Promise<SavedView[]> {
  const response = await views.$get({ query: { workspaceId } });
  if (!response.ok)
    throw new HttpError(response.status, "Unable to load saved views");
  return response.json();
}

export async function requestSavedViewDeletion(id: string) {
  const response = await views[":id"].$delete({ param: { id } });
  if (!response.ok)
    throw new HttpError(
      response.status,
      "Unable to request saved view deletion",
    );
  return response.json() as Promise<{ pendingActionId: string }>;
}
