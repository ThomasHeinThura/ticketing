import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { cannedResponseTable } from "../../database/schema";

export async function deleteCannedResponse(id: string, workspaceId: string) {
  const [deleted] = await db
    .delete(cannedResponseTable)
    .where(
      and(
        eq(cannedResponseTable.id, id),
        eq(cannedResponseTable.workspaceId, workspaceId),
      ),
    )
    .returning();

  if (!deleted) {
    throw new HTTPException(404, { message: "Canned response not found" });
  }

  return deleted;
}

export default deleteCannedResponse;
