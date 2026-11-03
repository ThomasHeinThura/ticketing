import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import { documentLinkTable } from "../../database/schema";
import { requireActiveProject } from "../require-active-project";
import type { DocumentLinkActor } from "./document-link-audit";

export type AddDocumentLinkInput = {
  url: string;
  title: string;
  kind?: (typeof documentLinkTable.$inferInsert)["kind"];
  description?: string | null;
  customerVisible?: boolean;
};

/**
 * Adds one entry to the project's Documents register, audited as `document_link.created`
 * (ids, kind and visibility only, never the title, address or description).
 */
async function addDocumentLink(
  projectId: string,
  workspaceId: string,
  input: AddDocumentLinkInput,
  actor: DocumentLinkActor,
) {
  await requireActiveProject(projectId, workspaceId);

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(documentLinkTable)
      .values({
        projectId,
        url: input.url,
        title: input.title,
        kind: input.kind ?? "other",
        description: input.description?.trim() ? input.description : null,
        // Customer visibility is off by default (projects-and-engagements.md, "Documents").
        customerVisible: input.customerVisible ?? false,
      })
      .returning();
    if (!created) throw new Error("document_link insert returned no row");

    await appendAuditLog(tx, {
      actorId: actor.actorId,
      actorType: actor.actorType,
      apiKeyId: actor.apiKeyId,
      workspaceId,
      projectId,
      action: "document_link.created",
      entityType: "document_link",
      entityId: created.id,
      before: null,
      after: { kind: created.kind, customerVisible: created.customerVisible },
    });
    return created;
  });
}

export default addDocumentLink;
