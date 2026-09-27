import db from "../../database";
import { documentLinkTable } from "../../database/schema";
import { requireActiveProject } from "../require-active-project";

export type AddDocumentLinkInput = {
  url: string;
  title: string;
  customerVisible?: boolean;
};

async function addDocumentLink(
  projectId: string,
  workspaceId: string,
  input: AddDocumentLinkInput,
) {
  await requireActiveProject(projectId, workspaceId);

  const [created] = await db
    .insert(documentLinkTable)
    .values({
      projectId,
      url: input.url,
      title: input.title,
      // Customer visibility is off by default (projects-and-engagements.md, "Documents").
      customerVisible: input.customerVisible ?? false,
    })
    .returning();

  return created;
}

export default addDocumentLink;
