import { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";
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

/** A resumable checkpoint belongs to one file on one already-created work item. */
export type AttachmentUploadCheckpoint = {
  attachmentId: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  uploaded: boolean;
};

export async function presignWorkItemAttachment(key: string, file: File) {
  const response = await workItemAttachments.presign.$post({
    param: { key },
    json: {
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      size: file.size,
    },
  });
  if (!response.ok)
    throw new HttpError(response.status, await readErrorDetail(response));
  return { ...(await response.json()), uploaded: false };
}

export async function completeWorkItemAttachment(id: string) {
  const response = await client.attachments[":id"].complete.$post({
    param: { id },
  });
  if (!response.ok)
    throw new HttpError(response.status, await readErrorDetail(response));
  return response.json();
}

/** Retry the same attachment ID, reconciling a lost completion response before any write. */
export async function resumeWorkItemAttachment(
  key: string,
  file: File,
  checkpoint: AttachmentUploadCheckpoint | undefined,
  onCheckpoint: (value: AttachmentUploadCheckpoint) => void,
) {
  let current = checkpoint;
  if (current?.uploaded) {
    const row = (await listWorkItemAttachments(key)).find(
      (attachment) => attachment.id === current?.attachmentId,
    );
    if (!row) throw new HttpError(404, "Attachment not found");
    if (row.state === "ready") return row;
    if (row.state !== "pending")
      throw new HttpError(409, "Attachment is no longer pending");
  }
  if (!current) {
    current = await presignWorkItemAttachment(key, file);
    onCheckpoint(current);
  }
  if (!current.uploaded) {
    const response = await fetch(current.uploadUrl, {
      method: "PUT",
      headers: current.uploadHeaders,
      body: file,
    });
    if (!response.ok) throw new HttpError(response.status, "");
    current = { ...current, uploaded: true };
    onCheckpoint(current);
  }
  try {
    return await completeWorkItemAttachment(current.attachmentId);
  } catch (error) {
    // Concurrent completion can legitimately return409. Only this exact ready ID proves success.
    if (error instanceof HttpError && error.status === 409) {
      const row = (await listWorkItemAttachments(key)).find(
        (attachment) => attachment.id === current?.attachmentId,
      );
      if (row?.state === "ready") return row;
    }
    throw error;
  }
}

/** Existing callers retain the single-upload interface and the same persisted policies. */
export async function uploadWorkItemAttachment(key: string, file: File) {
  return resumeWorkItemAttachment(key, file, undefined, () => {});
}

/**
 * A delete request preserves the row until its requester confirms the durable action; a
 * repeated request reopens the requester's existing pending action.
 */
export async function requestAttachmentDeletion(id: string) {
  const response = await client.attachments[":id"].$delete({ param: { id } });
  return readPendingDeletion(response, "Unable to request attachment deletion");
}
