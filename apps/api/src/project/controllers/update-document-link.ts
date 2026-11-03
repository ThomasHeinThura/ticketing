import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import { documentLinkTable } from "../../database/schema";
import { requireActiveProject } from "../require-active-project";
import type { AddDocumentLinkInput } from "./add-document-link";
import type { DocumentLinkActor } from "./document-link-audit";

export type UpdateDocumentLinkInput = Partial<AddDocumentLinkInput>;

/**
 * Edits one Documents entry of this project (a row of another project is a 404), audited as
 * `document_link.updated` with the changed field names and the before/after customer
 * visibility. The row is locked so two edits never interleave their audit rows.
 */
async function updateDocumentLink(
  projectId: string,
  documentLinkId: string,
  workspaceId: string,
  input: UpdateDocumentLinkInput,
  actor: DocumentLinkActor,
) {
  await requireActiveProject(projectId, workspaceId);

  return db.transaction(async (tx) => {
    const scope = and(
      eq(documentLinkTable.id, documentLinkId),
      eq(documentLinkTable.projectId, projectId),
    );
    const [current] = await tx
      .select()
      .from(documentLinkTable)
      .where(scope)
      .for("update")
      .limit(1);
    if (!current)
      throw new HTTPException(404, { message: "Document link not found" });

    const next: Partial<typeof documentLinkTable.$inferInsert> = {};
    if (input.url !== undefined && input.url !== current.url)
      next.url = input.url;
    if (input.title !== undefined && input.title !== current.title)
      next.title = input.title;
    if (input.kind !== undefined && input.kind !== current.kind)
      next.kind = input.kind;
    if (input.description !== undefined) {
      const description = input.description?.trim() ? input.description : null;
      if (description !== current.description) next.description = description;
    }
    if (
      input.customerVisible !== undefined &&
      input.customerVisible !== current.customerVisible
    )
      next.customerVisible = input.customerVisible;

    const changedFields = Object.keys(next);
    if (changedFields.length === 0) return current;

    const [updated] = await tx
      .update(documentLinkTable)
      .set({ ...next, updatedAt: new Date() })
      .where(scope)
      .returning();
    if (!updated)
      throw new HTTPException(404, { message: "Document link not found" });

    await appendAuditLog(tx, {
      actorId: actor.actorId,
      actorType: actor.actorType,
      apiKeyId: actor.apiKeyId,
      workspaceId,
      projectId,
      action: "document_link.updated",
      entityType: "document_link",
      entityId: updated.id,
      before: { kind: current.kind, customerVisible: current.customerVisible },
      after: {
        kind: updated.kind,
        customerVisible: updated.customerVisible,
        changedFields,
      },
    });
    return updated;
  });
}

export default updateDocumentLink;
