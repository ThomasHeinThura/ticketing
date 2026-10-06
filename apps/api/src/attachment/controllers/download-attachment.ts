import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import { createAttachmentDownloadUrl } from "../../storage";
import { getAttachment, getWorkItemProjectId } from "../repository";

export type DownloadAttachmentInput = {
  attachmentId: string;
  workspaceId: string;
  workItemId: string;
  actorId: string;
  actorType: "person" | "api_key";
  apiKeyId: string | null;
  apiBaseUrl: string;
};

/**
 * `GET /api/attachments/{id}` (`attachments.md` AT-5/AT-6). Mints a five-minute
 * presigned download and writes the mandatory `attachment.downloaded` audit row --
 * "every download writes an audit row", regardless of whether the caller ever actually
 * follows the redirect.
 */
export async function downloadAttachment(input: DownloadAttachmentInput) {
  const {
    attachmentId,
    workspaceId,
    workItemId,
    actorId,
    actorType,
    apiKeyId,
    apiBaseUrl,
  } = input;

  const [attachment] = await getAttachment(db, attachmentId);

  // AT-5: "the download path serves only `state = 'ready'` rows, never by raw key" --
  // a `pending` or `deleted` row 404s exactly like a nonexistent one.
  if (
    !attachment ||
    attachment.workspaceId !== workspaceId ||
    attachment.workItemId !== workItemId ||
    attachment.state !== "ready"
  ) {
    throw new HTTPException(404, { message: "Attachment not found" });
  }

  const [workItem] = await getWorkItemProjectId(db, workItemId);

  const downloadUrl = await createAttachmentDownloadUrl(
    attachment.objectKey,
    attachment.filename,
    apiBaseUrl,
  );

  await appendAuditLog(db, {
    actorId,
    actorType,
    apiKeyId,
    workspaceId,
    projectId: workItem?.projectId ?? null,
    action: "attachment.downloaded",
    entityType: "attachment",
    entityId: attachment.id,
  });

  return { downloadUrl };
}

export default downloadAttachment;
