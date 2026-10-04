import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import { createAttachmentDownloadUrl } from "../storage";

export async function listSubmissionAttachments(
  submissionId: string,
  options: { customerVisibleOnly: boolean },
) {
  const predicates = [
    eq(schema.attachmentTable.submissionId, submissionId),
    eq(schema.attachmentTable.state, "ready"),
    isNull(schema.attachmentTable.deletedAt),
  ];
  if (options.customerVisibleOnly)
    predicates.push(eq(schema.attachmentTable.customerVisible, true));
  return db
    .select({
      id: schema.attachmentTable.id,
      fieldKey: schema.attachmentTable.submissionFieldKey,
      filename: schema.attachmentTable.filename,
      mimeType: schema.attachmentTable.mimeType,
      size: schema.attachmentTable.size,
      uploadedBy: schema.attachmentTable.uploadedBy,
      createdAt: schema.attachmentTable.createdAt,
    })
    .from(schema.attachmentTable)
    .where(and(...predicates))
    .orderBy(schema.attachmentTable.createdAt, schema.attachmentTable.id);
}

export async function downloadSubmissionAttachment(input: {
  attachmentId: string;
  submissionId: string;
  workspaceId: string;
  actorId: string;
  apiBaseUrl: string;
  customerVisibleOnly: boolean;
}) {
  const predicates = [
    eq(schema.attachmentTable.id, input.attachmentId),
    eq(schema.attachmentTable.submissionId, input.submissionId),
    eq(schema.attachmentTable.workspaceId, input.workspaceId),
    eq(schema.attachmentTable.state, "ready"),
    isNull(schema.attachmentTable.deletedAt),
  ];
  if (input.customerVisibleOnly)
    predicates.push(eq(schema.attachmentTable.customerVisible, true));
  const [attachment] = await db
    .select()
    .from(schema.attachmentTable)
    .where(and(...predicates))
    .limit(1);
  if (!attachment) throw new HTTPException(404, { message: "Not found" });

  const downloadUrl = await createAttachmentDownloadUrl(
    attachment.objectKey,
    attachment.filename,
    input.apiBaseUrl,
  );
  await appendAuditLog(db, {
    actorId: input.actorId,
    actorType: "person",
    workspaceId: input.workspaceId,
    projectId: null,
    action: "attachment.downloaded",
    entityType: "attachment",
    entityId: attachment.id,
  });
  return downloadUrl;
}
