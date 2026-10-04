import { createId } from "@paralleldrive/cuid2";
import {
  type FormSchema,
  type FormValue,
  visibleFields,
} from "@taskdesk/domain/intake";
import { and, count, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../../database";
import {
  attachmentTable,
  instanceSettingTable,
  organisationTable,
  personTable,
  submissionTable,
  workItemTable,
  workspaceTable,
} from "../../database/schema";
import { createAttachmentUploadUrl } from "../../storage";
import { getFileExtension, sanitizePathSegment } from "../../storage/shared";
import {
  assertProjectStillLive,
  assertWorkItemStillLive,
} from "../../work-item/assert-work-item-live";
import { isMimeTypeAllowedForExtension } from "../magic-bytes";

export type PresignAttachmentInput = {
  workItemId?: string;
  submissionId?: string;
  submissionFieldKey?: string;
  workspaceId: string;
  filename: string;
  contentType: string;
  size: number;
  customerVisible: boolean;
  userId: string;
  apiBaseUrl: string;
};

// Same defaults as the `instance_setting` migration's own column DEFAULTs
// (`database/schema.ts`) -- used only when the singleton row itself is somehow missing
// (never true after a real boot, which always has exactly one row; a defensive fallback
// for a test database that seeds no instance_setting row at all, matching this
// module's `FALLBACK_MAX_BYTES`/`FALLBACK_MAX_PER_ITEM` precedent).
const FALLBACK_MAX_BYTES = 25 * 1024 * 1024;
const FALLBACK_MAX_PER_ITEM = 100;
const FALLBACK_ALLOWED_EXTENSIONS = [
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

/**
 * `POST /api/work-items/{key}/attachments/presign` (`attachments.md` AT-2, AT-14).
 * Validates against the God Mode-configurable limits, inserts a `pending` row, and
 * mints a presigned direct-PUT -- the bytes themselves never pass through this
 * process.
 */
export async function presignAttachment(input: PresignAttachmentInput) {
  const {
    workItemId,
    submissionId,
    submissionFieldKey,
    workspaceId,
    filename,
    contentType,
    size,
    customerVisible,
    userId,
    apiBaseUrl,
  } = input;

  if ((workItemId === undefined) === (submissionId === undefined)) {
    throw new HTTPException(400, {
      message: "Exactly one upload parent is required",
    });
  }
  if (submissionId && !customerVisible) {
    throw new HTTPException(400, {
      message: "Portal uploads must be customer-visible",
    });
  }
  if (submissionId && !submissionFieldKey) {
    throw new HTTPException(400, {
      message: "A request form field is required for this upload.",
    });
  }
  if (!submissionId && submissionFieldKey !== undefined) {
    throw new HTTPException(400, {
      message: "A request form field is invalid for this upload.",
    });
  }

  // `attachments.md`'s data section: `organisation_id` is `null` for an internal
  // workspace's own organisation, not merely absent -- every `workspace` row has a
  // real `organisation_id` today (#192: it defaults to the seeded internal
  // organisation), so "internal" is `organisation.is_internal`, not "no row".
  const [workspaceOrganisation] = await db
    .select({
      isInternal: organisationTable.isInternal,
      id: organisationTable.id,
    })
    .from(workspaceTable)
    .innerJoin(
      organisationTable,
      eq(workspaceTable.organisationId, organisationTable.id),
    )
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);

  let organisationId =
    workspaceOrganisation && !workspaceOrganisation.isInternal
      ? workspaceOrganisation.id
      : null;

  const [settings] = await db
    .select({
      maxBytes: instanceSettingTable.attachmentMaxBytes,
      maxPerItem: instanceSettingTable.attachmentMaxPerItem,
      allowedExtensions: instanceSettingTable.attachmentAllowedExtensions,
    })
    .from(instanceSettingTable)
    .limit(1);

  const maxBytes = settings?.maxBytes ?? FALLBACK_MAX_BYTES;
  const maxPerItem = settings?.maxPerItem ?? FALLBACK_MAX_PER_ITEM;
  const allowedExtensions =
    settings?.allowedExtensions ?? FALLBACK_ALLOWED_EXTENSIONS;

  // AT-14: a rejected file says exactly why.
  if (size > maxBytes) {
    throw new HTTPException(400, {
      message: `This file is ${Math.ceil(size / (1024 * 1024))} MB; the limit is ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
    });
  }

  const extension = getFileExtension(filename).toLowerCase();
  if (
    allowedExtensions &&
    allowedExtensions.length > 0 &&
    !allowedExtensions.map((e) => e.toLowerCase()).includes(extension)
  ) {
    throw new HTTPException(400, {
      message: extension
        ? `".${extension}" files aren't allowed.`
        : "Files with no extension aren't allowed.",
    });
  }

  // B1 security-review fix (2026-09-27, AT-14): the declared contentType must itself be
  // one this extension is allowed to declare -- otherwise a caller could pick one of the
  // no-signature-check MIME types (text/plain, text/csv, text/markdown, application/json)
  // for an unrelated extension (e.g. ".doc") and skip the magic-byte check entirely
  // regardless of the file's real bytes.
  if (!isMimeTypeAllowedForExtension(extension, contentType)) {
    throw new HTTPException(400, {
      message: `"${contentType}" is not an allowed content type for ".${extension}" files.`,
    });
  }

  const [countRow] = await db
    .select({ value: count() })
    .from(attachmentTable)
    .where(
      submissionId
        ? eq(attachmentTable.submissionId, submissionId)
        : eq(attachmentTable.workItemId, workItemId!),
    );
  const existingCount = countRow?.value ?? 0;

  if (existingCount >= maxPerItem) {
    throw new HTTPException(400, {
      message: `This work item already has the maximum of ${maxPerItem} attachments.`,
    });
  }

  // Best-effort actor-to-person resolution (`legal_hold.placed_by`'s own comment: no
  // reliable session->person resolver exists in apps/api yet). Null is a valid,
  // nullable value for `uploaded_by` when no match is found.
  const [person] = await db
    .select({ id: personTable.id })
    .from(personTable)
    .where(eq(personTable.userId, userId))
    .limit(1);

  const sanitizedFilename = `${sanitizePathSegment(filename.replace(/\.[^/.]+$/, "") || "file")}${extension ? `.${extension}` : ""}`;

  // Pre-generated so the object key (which embeds it, for a stable, collision-free
  // path) and the inserted row can be written in one statement.
  const attachmentId = createId();
  const objectKey = [
    "workspace",
    sanitizePathSegment(workspaceId),
    submissionId ? "submission" : "work-item",
    sanitizePathSegment(submissionId ?? workItemId!),
    "attachment",
    attachmentId,
    sanitizedFilename,
  ].join("/");

  // Issue #493: this route had NO in-transaction liveness re-check at all --
  // `requireWorkItemReach()` checks `deletedAt`/`archivedAt` before this request reaches
  // here, but a soft-delete/archive landing in the window between that check and this
  // insert would otherwise still leave a `pending` attachment on a dead item. `.for("share")`
  // locks the row so a concurrent soft-delete blocks until this transaction finishes,
  // closing the same reach-check-to-write race #276 closed for `update-work-item.ts` --
  // read-only here (nothing about the work item row is written), so a shared lock suffices.
  const inserted = await db.transaction(async (tx) => {
    if (submissionId) {
      const [locked] = await tx
        .select({
          organisationId: submissionTable.organisationId,
          state: submissionTable.state,
          workspaceId: schema.requestTypeTable.workspaceId,
          requestTypeId: submissionTable.requestTypeId,
          requestTypeVersionId: submissionTable.requestTypeVersionId,
          formData: submissionTable.formData,
        })
        .from(submissionTable)
        .innerJoin(
          schema.requestTypeTable,
          eq(schema.requestTypeTable.id, submissionTable.requestTypeId),
        )
        .where(eq(submissionTable.id, submissionId))
        .for("update", { of: submissionTable });
      if (
        !locked ||
        locked.state !== "draft" ||
        locked.workspaceId !== workspaceId
      ) {
        throw new HTTPException(404, { message: "Submission not found" });
      }
      const [version] = await tx
        .select({ formSchema: schema.requestTypeVersionTable.formSchema })
        .from(schema.requestTypeVersionTable)
        .where(
          and(
            eq(schema.requestTypeVersionTable.id, locked.requestTypeVersionId),
            eq(
              schema.requestTypeVersionTable.requestTypeId,
              locked.requestTypeId,
            ),
          ),
        )
        .limit(1);
      const formSchema = version?.formSchema as FormSchema | undefined;
      const fileField = formSchema?.fields.find(
        (field) => field.key === submissionFieldKey && field.type === "file",
      );
      const isVisible = formSchema
        ? visibleFields(
            formSchema,
            locked.formData as Record<string, FormValue>,
          ).some((field) => field.key === submissionFieldKey)
        : false;
      if (!fileField || !isVisible) {
        throw new HTTPException(400, {
          message: "The request form file field is unavailable.",
        });
      }
      organisationId = locked.organisationId;
      const [currentCount] = await tx
        .select({ value: count() })
        .from(attachmentTable)
        .where(eq(attachmentTable.submissionId, submissionId));
      if ((currentCount?.value ?? 0) >= maxPerItem) {
        throw new HTTPException(400, {
          message: `This submission already has the maximum of ${maxPerItem} attachments.`,
        });
      }
      if (!fileField.multiple) {
        const [fieldCount] = await tx
          .select({ value: count() })
          .from(attachmentTable)
          .where(
            and(
              eq(attachmentTable.submissionId, submissionId),
              eq(attachmentTable.submissionFieldKey, submissionFieldKey!),
            ),
          );
        if ((fieldCount?.value ?? 0) > 0) {
          throw new HTTPException(409, {
            message: "This request form field already has an upload.",
          });
        }
      }
    } else {
      const [locked] = await tx
        .select({
          projectId: workItemTable.projectId,
          deletedAt: workItemTable.deletedAt,
          archivedAt: workItemTable.archivedAt,
        })
        .from(workItemTable)
        .where(eq(workItemTable.id, workItemId!))
        .for("share");
      assertWorkItemStillLive(locked);
      await assertProjectStillLive(tx, locked.projectId);
    }

    const [row] = await tx
      .insert(attachmentTable)
      .values({
        id: attachmentId,
        workspaceId,
        organisationId,
        workItemId: workItemId ?? null,
        submissionId: submissionId ?? null,
        submissionFieldKey: submissionFieldKey ?? null,
        objectKey,
        filename: filename.slice(0, 255),
        mimeType: contentType,
        size,
        state: "pending",
        customerVisible,
        uploadedBy: person?.id ?? null,
      })
      .returning({ id: attachmentTable.id });

    return row;
  });

  if (!inserted) {
    throw new HTTPException(500, { message: "Failed to create attachment" });
  }

  const upload = await createAttachmentUploadUrl(
    objectKey,
    contentType,
    maxBytes,
    apiBaseUrl,
  );

  return {
    attachmentId: inserted.id,
    uploadUrl: upload.uploadUrl,
    uploadHeaders: upload.headers,
  };
}

export default presignAttachment;
