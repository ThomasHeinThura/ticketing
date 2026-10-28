export type AttachmentDeletionSummary = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  key: string;
  title: string;
  recoveryHours: number;
  alreadyDeleted: boolean;
};

export function parseAttachmentDeletionSummary(
  value: unknown,
): AttachmentDeletionSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    row.redacted === true ||
    typeof row.attachmentId !== "string" ||
    !/^[A-Za-z0-9_-]{1,256}$/u.test(row.attachmentId) ||
    typeof row.filename !== "string" ||
    !row.filename.trim() ||
    row.filename.length > 1024 ||
    typeof row.mimeType !== "string" ||
    !row.mimeType.trim() ||
    row.mimeType.length > 255 ||
    typeof row.size !== "number" ||
    !Number.isSafeInteger(row.size) ||
    row.size < 0 ||
    typeof row.key !== "string" ||
    !/^[A-Z][A-Z0-9]*-[1-9]\d*$/u.test(row.key) ||
    typeof row.title !== "string" ||
    !row.title.trim() ||
    row.title.length > 500 ||
    typeof row.recoveryHours !== "number" ||
    !Number.isSafeInteger(row.recoveryHours) ||
    row.recoveryHours < 24
  )
    return null;
  // Explicit projection excludes storage locators and arbitrary response fields.
  return {
    attachmentId: row.attachmentId,
    filename: row.filename,
    mimeType: row.mimeType,
    size: row.size,
    key: row.key,
    title: row.title,
    recoveryHours: row.recoveryHours,
    alreadyDeleted: row.alreadyDeleted === true,
  };
}
