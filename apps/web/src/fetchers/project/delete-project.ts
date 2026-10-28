import { client } from "@taskdesk/libs";
import type { InferRequestType } from "hono/client";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";

export type DeleteProjectRequest = InferRequestType<
  (typeof client)["project"][":id"]["$delete"]
>["param"];

/** Requests deletion; the project is only removed once the requester approves it. */
async function deleteProject({ id }: DeleteProjectRequest) {
  const response = await client.project[":id"].$delete({ param: { id } });
  return readPendingDeletion(response, "Failed to request project deletion");
}

export default deleteProject;
