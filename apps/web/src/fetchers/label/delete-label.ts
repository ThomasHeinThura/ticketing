import { client } from "@taskdesk/libs";
import type { InferRequestType } from "hono/client";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";

export type DeleteLabelRequest = InferRequestType<
  (typeof client)["label"][":id"]["$delete"]
>["param"];

/** Requests deletion; the label is only removed once the requester approves it. */
async function deleteLabel({ id }: DeleteLabelRequest) {
  const response = await client.label[":id"].$delete({
    param: { id },
  });
  return readPendingDeletion(response, "Failed to request label deletion");
}

export default deleteLabel;
