import { createId } from "@paralleldrive/cuid2";
import {
  type FormSchema,
  type FormValue,
  isFieldVisible,
} from "@taskdesk/domain";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { formSchema as intakeFormSchema } from "../../intake/schema";
import {
  buildAttachmentStorageKey,
  getFileExtension,
  sanitizePathSegment,
} from "../../storage";
import { createPortalAttachmentUploadUrl } from "../../storage/portal-servable";
import {
  assertProjectStillLive,
  assertWorkItemStillLive,
} from "../../work-item/assert-work-item-live";
import { isMimeTypeAllowedForExtension } from "../magic-bytes";
import {
  countSubmissionAttachments,
  countWorkItemAttachments,
  findSubmissionFormSchema,
  findSubmissionForPresign,
  getAttachmentSettings,
  insertSubmissionAttachment,
  insertWorkItemAttachment,
  lockAttachmentWorkItem,
  lockCommentForAttachment,
  lockSubmissionForPresign,
} from "../repository";
import { assertOrganisationStorageQuota } from "../storage-quota";

function isFormValue(value: unknown): value is FormValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (Array.isArray(value) && value.every(isFormValue))
  );
}

/** Reject malformed persisted snapshots before evaluating attachment visibility. */
export function parseAttachmentFormSchema(value: unknown): FormSchema | null {
  const parsed = intakeFormSchema.safeParse(value);
  if (!parsed.success) return null;
  const fields: FormSchema["fields"][number][] = [];
  for (const field of parsed.data.fields) {
    const condition = field.showIf;
    if (
      condition &&
      condition.value !== undefined &&
      !isFormValue(condition.value)
    )
      return null;
    const { showIf: _showIf, ...rest } = field;
    if (condition) {
      const { value: conditionValue, ...restCondition } = condition;
      if (conditionValue !== undefined && !isFormValue(conditionValue))
        return null;
      fields.push({
        ...rest,
        showIf:
          conditionValue === undefined
            ? restCondition
            : { ...restCondition, value: conditionValue },
      });
    } else {
      fields.push({ ...rest, showIf: condition });
    }
  }
  return { fields };
}

/**
 * A customer upload on their own request (AT-3: customer uploads are customer-visible). While the
 * submission is open (`new`, `clarifying`) the file attaches to the submission, optionally to a
 * form field. Once accepted (A-08) it attaches to the converted work item, the same parent the
 * completion step already accepts, so the requester can send files with a reply; a file field
 * no longer applies then.
 */
export async function presignSubmissionAttachment(input: {
  submissionId: string;
  workspaceId: string;
  requesterId: string;
  /** The live work item an accepted submission converted into (null otherwise). */
  acceptedWorkItemId?: string | null;
  /**
   * A-08: attach the file to the requester's reply on the accepted request (a live public
   * comment they wrote on the converted work item). Only for an accepted submission.
   */
  commentId?: string;
  fieldKey?: string;
  filename: string;
  contentType: string;
  size: number;
  apiBaseUrl: string;
}) {
  const [submission] = await findSubmissionForPresign(db, input);
  const open =
    submission?.state === "new" || submission?.state === "clarifying";
  const acceptedParent =
    submission?.state === "accepted" && input.acceptedWorkItemId
      ? input.acceptedWorkItemId
      : null;
  if (!submission || (!open && !acceptedParent))
    throw new HTTPException(404, { message: "Submission not found" });
  if (acceptedParent && input.fieldKey)
    throw new HTTPException(400, {
      message: "The attachment field is not part of this submitted form.",
    });
  if (input.commentId && !acceptedParent)
    throw new HTTPException(400, {
      message: "Files go with a reply only once the request is accepted.",
    });
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
  // An open submission's file lives under the submission; once accepted, a fresh key under the
  // converted work item, served to the portal only through a portal-bound link (CP-19).
  const objectKey = buildAttachmentStorageKey(
    [
      "workspace",
      sanitizePathSegment(input.workspaceId),
      ...(acceptedParent
        ? ["work-item", sanitizePathSegment(acceptedParent)]
        : ["submission", sanitizePathSegment(input.submissionId)]),
      "attachment",
      attachmentId,
      safeName,
    ].join("/"),
  );
  const [row] = await db.transaction(async (tx) => {
    const [locked] = await lockSubmissionForPresign(tx, input);
    if (
      !locked ||
      (acceptedParent
        ? locked.state !== "accepted"
        : locked.state !== "new" && locked.state !== "clarifying")
    )
      throw new HTTPException(409, {
        message: "Submission changed before upload",
      });
    if (acceptedParent) {
      // The converted item must still be live, in the request's workspace (the completion step
      // checks the same workspace), and under its per-item file limit.
      const [item] = await lockAttachmentWorkItem(tx, {
        workItemId: acceptedParent,
        workspaceId: input.workspaceId,
      });
      assertWorkItemStillLive(item);
      // CP-16: once staff name another requester (A-03) the item is no longer this request's;
      // the share lock orders this check against that change.
      if (item.requesterId !== input.requesterId)
        throw new HTTPException(404, { message: "Submission not found" });
      await assertProjectStillLive(tx, item.projectId);
      await assertOrganisationStorageQuota(tx, {
        workspaceId: input.workspaceId,
        additionalBytes: input.size,
      });
      const [itemCount] = await countWorkItemAttachments(tx, acceptedParent);
      if ((itemCount?.value ?? 0) >= maxPerParent)
        throw new HTTPException(400, {
          message: `This request already has the maximum of ${maxPerParent} attachments.`,
        });
      if (input.commentId) {
        // The reply must be the requester's own live public comment on this item; the share
        // lock makes a concurrent deletion wait, so a file never lands on a tombstone.
        const [comment] = await lockCommentForAttachment(tx, {
          commentId: input.commentId,
          workItemId: acceptedParent,
          workspaceId: input.workspaceId,
        });
        if (
          !comment ||
          comment.deletedAt ||
          comment.visibility !== "public" ||
          comment.authorId !== input.requesterId
        )
          throw new HTTPException(404, { message: "Comment not found" });
      }
      return insertWorkItemAttachment(tx, {
        id: attachmentId,
        workspaceId: input.workspaceId,
        organisationId: submission.organisationId,
        ...(input.commentId
          ? { commentId: input.commentId }
          : { workItemId: acceptedParent }),
        objectKey,
        filename: input.filename,
        contentType: input.contentType,
        size: input.size,
        customerVisible: true,
        uploadedBy: input.requesterId,
      });
    }
    await assertOrganisationStorageQuota(tx, {
      workspaceId: input.workspaceId,
      additionalBytes: input.size,
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
      const formSchema = parseAttachmentFormSchema(snapshot?.formSchema);
      const field = formSchema?.fields.find(
        (candidate) =>
          candidate.key === input.fieldKey && candidate.type === "file",
      );
      if (
        !formSchema ||
        !field ||
        !isFieldVisible(
          formSchema,
          field,
          (locked.formData ?? {}) as Record<string, FormValue>,
        )
      )
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
  const upload = await createPortalAttachmentUploadUrl({
    objectKey,
    contentType: input.contentType,
    maxBytes,
    personId: input.requesterId,
    apiBaseUrl: input.apiBaseUrl,
    declaredSize: input.size,
  });
  return {
    attachmentId: row.id,
    uploadUrl: upload.uploadUrl,
    uploadHeaders: upload.headers,
  };
}
