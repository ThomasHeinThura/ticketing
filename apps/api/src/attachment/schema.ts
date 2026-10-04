import { z } from "../openapi";

function containsNulByte(value: string): boolean {
  return value.includes("\u0000");
}
const NO_NUL_BYTE_MESSAGE = "must not contain a NUL (\\u0000) byte";

export const attachmentIdParam = z.object({
  id: z
    .string()
    .refine((value) => !containsNulByte(value), NO_NUL_BYTE_MESSAGE),
});

export const workItemKeyParam = z.object({
  key: z
    .string()
    .refine((value) => !containsNulByte(value), NO_NUL_BYTE_MESSAGE),
});

// `POST /api/work-items/{key}/attachments/presign` (`attachments.md` AT-2). `size` and
// `contentType` are validated against the God Mode-configurable
// `attachment_max_bytes`/`attachment_allowed_extensions` before a URL is minted --
// `AT-14`: a rejection says exactly why, never a generic failure.
export const presignAttachmentBody = z.object({
  filename: z
    .string()
    .min(1)
    .max(255)
    .refine((value) => !containsNulByte(value), NO_NUL_BYTE_MESSAGE),
  contentType: z.string().min(1).max(255),
  size: z.number().int().positive(),
  customerVisible: z.boolean().optional().openapi({
    description:
      "AT-3: staff uploads default to false (not customer-visible); explicit true is honoured.",
  }),
});

export const presignSubmissionAttachmentBody = z
  .object({
    filename: presignAttachmentBody.shape.filename,
    contentType: presignAttachmentBody.shape.contentType,
    size: presignAttachmentBody.shape.size,
    fieldKey: z.string().min(1).max(120),
  })
  .strict();
