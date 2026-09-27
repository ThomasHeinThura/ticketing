import { createId } from "@paralleldrive/cuid2";
import { count, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  attachmentTable,
  instanceSettingTable,
  organisationTable,
  personTable,
  workspaceTable,
} from "../../database/schema";
import { createAttachmentUploadUrl } from "../../storage";
import { getFileExtension, sanitizePathSegment } from "../../storage/shared";

export type PresignAttachmentInput = {
  workItemId: string;
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
    workspaceId,
    filename,
    contentType,
    size,
    customerVisible,
    userId,
    apiBaseUrl,
  } = input;

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

  const organisationId =
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

  const [countRow] = await db
    .select({ value: count() })
    .from(attachmentTable)
    .where(eq(attachmentTable.workItemId, workItemId));
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
    "work-item",
    sanitizePathSegment(workItemId),
    "attachment",
    attachmentId,
    sanitizedFilename,
  ].join("/");

  const [inserted] = await db
    .insert(attachmentTable)
    .values({
      id: attachmentId,
      workspaceId,
      organisationId,
      workItemId,
      objectKey,
      filename: filename.slice(0, 255),
      mimeType: contentType,
      size,
      state: "pending",
      customerVisible,
      uploadedBy: person?.id ?? null,
    })
    .returning({ id: attachmentTable.id });

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
