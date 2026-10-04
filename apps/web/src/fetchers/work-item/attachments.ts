import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

export type WorkItemAttachment = {
  id: string;
  workItemId: string;
  filename: string;
  mimeType: string;
  size: number;
  state: string;
  customerVisible: boolean;
  uploadedBy: string | null;
  createdAt: string;
  deletedAt: string | null;
};

export async function listWorkItemAttachments(key: string) {
  const response = await client["work-items"][":key"].attachments.$get({
    param: { key },
  });
  if (!response.ok) {
    throw new HttpError(response.status, "Failed to list attachments");
  }
  return (await response.json()) as WorkItemAttachment[];
}

export async function presignWorkItemAttachment(input: {
  key: string;
  filename: string;
  contentType: string;
  size: number;
}) {
  const response = await client["work-items"][":key"].attachments.presign.$post(
    {
      param: { key: input.key },
      json: {
        filename: input.filename,
        contentType: input.contentType,
        size: input.size,
      },
    },
  );
  if (!response.ok) {
    throw await readAttachmentError(response, "Could not prepare this upload.");
  }
  return response.json();
}

export async function completeWorkItemAttachment(id: string) {
  const response = await client.attachments[":id"].complete.$post({
    param: { id },
  });
  if (!response.ok) {
    throw await readAttachmentError(
      response,
      "The uploaded file was rejected.",
    );
  }
  return (await response.json()) as WorkItemAttachment;
}

export async function deleteWorkItemAttachment(id: string) {
  const response = await client.attachments[":id"].$delete({ param: { id } });
  if (!response.ok) {
    throw await readAttachmentError(response, "Could not delete this file.");
  }
  return (await response.json()) as WorkItemAttachment;
}

async function readAttachmentError(response: Response, fallback: string) {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "message" in body) {
      const message = (body as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) {
        return new HttpError(response.status, message);
      }
    }
  } catch {
    // Keep the user-facing fallback when the API did not return a JSON error.
  }
  return new HttpError(response.status, fallback);
}
