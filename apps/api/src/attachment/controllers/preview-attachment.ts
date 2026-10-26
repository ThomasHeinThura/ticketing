import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import { getPrivateObject } from "../../storage";
import {
  assertPdfPreviewMetadata,
  createVerifiedPdfPreviewStream,
  PdfPreviewUnavailableError,
} from "../pdf-preview";

export type PreviewAttachmentInput = {
  /** Row returned by a parent-scoped, permission-checked attachment repository query. */
  attachment: {
    id: string;
    objectKey: string;
    mimeType: string;
    size: number;
    workspaceId: string;
  };
  projectId: string | null;
  actorId: string;
  actorType: "person" | "api_key";
  apiKeyId: string | null;
  signal?: AbortSignal;
};

/**
 * Read the bytes only after the route has applied its existing attachment reach and
 * visibility checks. The caller returns this stream with a no-store inline PDF response.
 */
export async function previewAttachment(input: PreviewAttachmentInput) {
  assertPdfPreviewMetadata(input.attachment);
  const stored = await getPrivateObject(input.attachment.objectKey);
  if (
    stored.contentLength !== undefined &&
    stored.contentLength !== input.attachment.size
  ) {
    await cancelBody(stored.body);
    throw new PdfPreviewUnavailableError("invalid");
  }

  const body = await createVerifiedPdfPreviewStream({
    body: stored.body,
    size: input.attachment.size,
    signal: input.signal,
  });
  try {
    await appendAuditLog(db, {
      actorId: input.actorId,
      actorType: input.actorType,
      apiKeyId: input.apiKeyId,
      workspaceId: input.attachment.workspaceId,
      projectId: input.projectId,
      action: "attachment.downloaded",
      entityType: "attachment",
      entityId: input.attachment.id,
    });
  } catch (error) {
    await body.cancel().catch(() => {});
    throw error;
  }

  return {
    body,
    contentLength: input.attachment.size,
  };
}

async function cancelBody(body: unknown) {
  if (
    body &&
    typeof body === "object" &&
    "cancel" in body &&
    typeof body.cancel === "function"
  ) {
    await body.cancel().catch(() => {});
  }
}

export default previewAttachment;
