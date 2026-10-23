import { client } from "@taskdesk/libs";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";

/** Requests deletion; the column is only removed once the requester approves it. */
async function deleteColumn(id: string) {
  const response = await client.column[":id"].$delete({
    param: { id },
  });
  return readPendingDeletion(response, "Failed to request column deletion");
}

export default deleteColumn;
