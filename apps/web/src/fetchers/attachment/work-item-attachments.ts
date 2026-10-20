import { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import { HttpError, readErrorDetail } from "@/lib/http-error";

const workItemAttachments = client["work-items"][":key"].attachments;

export type WorkItemAttachment = InferResponseType<
  typeof workItemAttachments.$get,
  200
>[number];

/** `GET /api/work-items/{key}/attachments`. */
export async function listWorkItemAttachments(
  key: string,
): Promise<WorkItemAttachment[]> {
  const response = await workItemAttachments.$get({ param: { key } });
  if (!response.ok) {
    throw new HttpError(response.status, "Failed to load attachments");
  }
  return response.json();
}

/**
 * Presign, PUT the bytes to storage, then complete (`attachments.md` AT-2). The server
 * checks the magic bytes on complete; a rejection keeps its exact reason (AT-14).
 */
export async function uploadWorkItemAttachment(key: string, file: File) {
  const presign = await workItemAttachments.presign.$post({
    param: { key },
    json: {
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      size: file.size,
    },
  });
  if (!presign.ok) {
    throw new HttpError(presign.status, await readErrorDetail(presign));
  }
  const { attachmentId, uploadUrl, uploadHeaders } = await presign.json();
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: uploadHeaders,
    body: file,
  });
  if (!put.ok) throw new HttpError(put.status, "Upload failed");
  const complete = await client.attachments[":id"].complete.$post({
    param: { id: attachmentId },
  });
  if (!complete.ok) {
    throw new HttpError(complete.status, await readErrorDetail(complete));
  }
  return complete.json();
}

/** `DELETE /api/attachments/{id}` (soft delete, uploader only). */
export async function deleteAttachment(id: string) {
  const response = await client.attachments[":id"].$delete({ param: { id } });
  if (!response.ok) {
    throw new HttpError(response.status, await readErrorDetail(response));
  }
}
