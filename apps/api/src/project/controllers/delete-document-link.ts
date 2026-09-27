import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { documentLinkTable } from "../../database/schema";
import { requireActiveProject } from "../require-active-project";

async function deleteDocumentLink(
  projectId: string,
  documentLinkId: string,
  workspaceId: string,
) {
  await requireActiveProject(projectId, workspaceId);

  const [deleted] = await db
    .delete(documentLinkTable)
    .where(
      and(
        eq(documentLinkTable.id, documentLinkId),
        eq(documentLinkTable.projectId, projectId),
      ),
    )
    .returning();

  if (!deleted) {
    throw new HTTPException(404, { message: "Document link not found" });
  }

  return deleted;
}

export default deleteDocumentLink;
