import { asc, eq } from "drizzle-orm";
import db from "../../database";
import { documentLinkTable } from "../../database/schema";
import { requireActiveProject } from "../require-active-project";

async function listDocumentLinks(projectId: string, workspaceId: string) {
  await requireActiveProject(projectId, workspaceId);

  return db
    .select()
    .from(documentLinkTable)
    .where(eq(documentLinkTable.projectId, projectId))
    .orderBy(asc(documentLinkTable.createdAt));
}

export default listDocumentLinks;
