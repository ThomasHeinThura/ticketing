import { client } from "@taskdesk/libs";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";

export type DeleteTaskRelationRequest = { key: string; id: string };

/** Requests removal (`202` pending action); the relation stays until the requester approves. */
async function deleteTaskRelation({ key, id }: DeleteTaskRelationRequest) {
  const response = await client["work-items"][":key"].relations[":id"].$delete({
    param: { key, id },
  });
  return readPendingDeletion(response, "Failed to request relation removal");
}

export default deleteTaskRelation;
