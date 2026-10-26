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
  lifecycle: "live" | "recoverable" = "live",
): Promise<WorkItemAttachment[]> {
  const response = await workItemAttachments.$get({
    param: { key },
    query: lifecycle === "recoverable" ? { lifecycle } : {},
  });
  if (!response.ok) {
    throw new HttpError(response.status, "Failed to load attachments");
  }
  return response.json();
}

/** AT-7: restore a file only through the policy-checked attachment API. */
export async function restoreWorkItemAttachment(id: string) {
  const response = await client.attachments[":id"].restore.$post({
    param: { id },
  });
  if (!response.ok)
    throw new HttpError(response.status, await readErrorDetail(response));
  return response.json();
}

/** A resumable checkpoint belongs to one file on one already-created work item. */
export type AttachmentUploadCheckpoint = {
  attachmentId: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  uploaded: boolean;
};

/** AT-1: where a file attaches. Omitted, it attaches to the work item itself. */
export type AttachmentTarget = { commentId?: string };

export async function presignWorkItemAttachment(
  key: string,
  file: File,
  target: AttachmentTarget = {},
) {
  const response = await workItemAttachments.presign.$post({
    param: { key },
    json: {
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      size: file.size,
      ...(target.commentId ? { commentId: target.commentId } : {}),
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

export type AttachmentUploadOptions = AttachmentTarget & {
  /** Byte progress of the direct upload. Supplying it switches the PUT to XHR (fetch cannot report it). */
  onProgress?: (loaded: number, total: number) => void;
};

/** Direct-to-storage PUT. The signed URL stays inside this function: it never reaches an error or a log. */
async function putAttachmentBytes(
  checkpoint: AttachmentUploadCheckpoint,
  file: File,
  onProgress: AttachmentUploadOptions["onProgress"],
) {
  if (!onProgress || typeof XMLHttpRequest === "undefined") {
    const response = await fetch(checkpoint.uploadUrl, {
      method: "PUT",
      headers: checkpoint.uploadHeaders,
      body: file,
    });
    if (!response.ok) throw new HttpError(response.status, "");
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", checkpoint.uploadUrl);
    for (const [name, value] of Object.entries(checkpoint.uploadHeaders))
      request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(file.size, file.size);
        resolve();
      } else reject(new HttpError(request.status, ""));
    };
    request.onerror = () => reject(new Error("Upload interrupted"));
    request.onabort = () => reject(new Error("Upload interrupted"));
    request.send(file);
  });
}

/** Retry the same attachment ID, reconciling a lost completion response before any write. */
export async function resumeWorkItemAttachment(
  key: string,
  file: File,
  checkpoint: AttachmentUploadCheckpoint | undefined,
  onCheckpoint: (value: AttachmentUploadCheckpoint) => void,
  options: AttachmentUploadOptions = {},
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
    current = await presignWorkItemAttachment(key, file, options);
    onCheckpoint(current);
  }
  if (!current.uploaded) {
    await putAttachmentBytes(current, file, options.onProgress);
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
