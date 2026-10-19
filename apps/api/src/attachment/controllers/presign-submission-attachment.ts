import { createId } from "@paralleldrive/cuid2";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  createAttachmentUploadUrl,
  getFileExtension,
  sanitizePathSegment,
} from "../../storage";
import { isMimeTypeAllowedForExtension } from "../magic-bytes";
import {
  countSubmissionAttachments,
  findSubmissionFormSchema,
  findSubmissionForPresign,
  getAttachmentSettings,
  insertSubmissionAttachment,
  lockSubmissionForPresign,
} from "../repository";

export async function presignSubmissionAttachment(input: {
  submissionId: string;
  workspaceId: string;
  requesterId: string;
  fieldKey?: string;
  filename: string;
  contentType: string;
  size: number;
  apiBaseUrl: string;
}) {
  const [submission] = await findSubmissionForPresign(db, input);
  if (
    !submission ||
    (submission.state !== "new" && submission.state !== "clarifying")
  )
    throw new HTTPException(404, { message: "Submission not found" });
  const [settings] = await getAttachmentSettings(db);
  const maxBytes = settings?.maxBytes ?? 25 * 1024 * 1024;
  const maxPerParent = settings?.maxPerItem ?? 100;
  const extensions = settings?.allowedExtensions ?? [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp",
    "heic",
    "heif",
    "bmp",
    "tiff",
    "pdf",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    "odt",
    "ods",
    "odp",
    "txt",
    "csv",
    "md",
    "json",
    "log",
    "rtf",
  ];
  if (input.size > maxBytes)
    throw new HTTPException(400, {
      message: `This file is ${Math.ceil(input.size / (1024 * 1024))} MB; the limit is ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
    });
  const extension = getFileExtension(input.filename).toLowerCase();
  if (
    extensions?.length &&
    !extensions.map((value) => value.toLowerCase()).includes(extension)
  )
    throw new HTTPException(400, {
      message: extension
        ? `".${extension}" files aren't allowed.`
        : "Files with no extension aren't allowed.",
    });
  if (!isMimeTypeAllowedForExtension(extension, input.contentType))
    throw new HTTPException(400, {
      message: `"${input.contentType}" is not an allowed content type for ".${extension}" files.`,
    });
  const safeName = `${sanitizePathSegment(input.filename.replace(/\.[^/.]+$/, "") || "file")}${extension ? `.${extension}` : ""}`;
  const attachmentId = createId();
  const objectKey = [
    "workspace",
    sanitizePathSegment(input.workspaceId),
    "submission",
    sanitizePathSegment(input.submissionId),
    "attachment",
    attachmentId,
    safeName,
  ].join("/");
  const [row] = await db.transaction(async (tx) => {
    const [locked] = await lockSubmissionForPresign(tx, input);
    if (!locked || (locked.state !== "new" && locked.state !== "clarifying"))
      throw new HTTPException(409, {
        message: "Submission changed before upload",
      });
    const [countRow] = await countSubmissionAttachments(tx, input.submissionId);
    if ((countRow?.value ?? 0) >= maxPerParent)
      throw new HTTPException(400, {
        message: `This submission already has the maximum of ${maxPerParent} attachments.`,
      });
    if (input.fieldKey) {
      const [snapshot] = await findSubmissionFormSchema(
        tx,
        locked.requestTypeVersionId,
      );
      const fields =
        (
          snapshot?.formSchema as
            | {
                fields?: Array<{
                  key?: string;
                  type?: string;
                  multiple?: boolean;
                }>;
              }
            | undefined
        )?.fields ?? [];
      const field = fields.find(
        (candidate) =>
          candidate.key === input.fieldKey && candidate.type === "file",
      );
      if (!field)
        throw new HTTPException(400, {
          message: "The attachment field is not part of this submitted form.",
        });
      if (!field.multiple) {
        const [existing] = await countSubmissionAttachments(
          tx,
          input.submissionId,
          input.fieldKey,
        );
        if ((existing?.value ?? 0) > 0)
          throw new HTTPException(409, {
            message: "This form field accepts one file.",
          });
      }
    }
    const [created] = await insertSubmissionAttachment(tx, {
      id: attachmentId,
      workspaceId: input.workspaceId,
      organisationId: submission.organisationId,
      submissionId: input.submissionId,
      fieldKey: input.fieldKey,
      objectKey,
      filename: input.filename,
      contentType: input.contentType,
      size: input.size,
      requesterId: input.requesterId,
    });
    return [created];
  });
  if (!row)
    throw new HTTPException(500, {
      message: "Could not create the pending attachment",
    });
  const upload = await createAttachmentUploadUrl(
    objectKey,
    input.contentType,
    maxBytes,
    input.apiBaseUrl,
  );
  return {
    attachmentId: row.id,
    uploadUrl: upload.uploadUrl,
    uploadHeaders: upload.headers,
  };
}
