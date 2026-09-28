import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

// The row this feature's routes return -- never the raw ORM row on the wire
// (`objectKey` is deliberately excluded: it is an internal storage detail, never
// exposed, matching `attachments.md` AT-2's "the API never proxies bytes" spirit --
// nothing about the storage backend's own key shape should leak to a client).
export const attachmentSchema = z
  .object({
    id: z.string(),
    workItemId: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    size: z.number(),
    state: z
      .string()
      .openapi({ description: "One of: pending, ready, deleted." }),
    customerVisible: z.boolean(),
    uploadedBy: z.string().nullable(),
    createdAt: responseTimestamp,
    deletedAt: nullableResponseTimestamp,
  })
  .openapi("Attachment");

export const attachmentListSchema = z.array(attachmentSchema);

// `POST /api/work-items/{key}/attachments/presign` response (`AT-2`).
export const presignAttachmentResponseSchema = z
  .object({
    attachmentId: z.string(),
    uploadUrl: z.string(),
    uploadHeaders: z.record(z.string(), z.string()),
  })
  .openapi("AttachmentPresignResult");
