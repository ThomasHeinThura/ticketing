import { client } from "@taskdesk/libs";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";

export type DeleteCommentRequest = { commentId: string };

/** Requests deletion (`202` pending action); the comment stays until the requester approves. */
async function deleteComment({ commentId }: DeleteCommentRequest) {
  const response = await client.comments[":id"].$delete({
    param: { id: commentId },
  });
  return readPendingDeletion(response, "Failed to request comment deletion");
}

export default deleteComment;
