import { z } from "../openapi";
import { createWorkItemBody } from "../work-item/schema";

const opaque = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) =>
      [...value].every((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code >= 32 && code !== 127;
      }),
    );
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const sourceUrl = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      const credentialLikeQueryKey = [...url.searchParams.keys()].some((key) =>
        /(?:token|secret|password|authorization|api[-_]?key|credential|signature|^sig$)/iu.test(
          key,
        ),
      );
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !credentialLikeQueryKey &&
        !url.hash
      );
    } catch {
      return false;
    }
  });
const canonicalItem = createWorkItemBody
  .pick({
    typeId: true,
    title: true,
    description: true,
    priority: true,
    startDate: true,
    dueDate: true,
    labelIds: true,
    assigneeId: true,
  })
  .strict();

// --- Record schema v2 (P6 Lane B) -------------------------------------------------------------
// Every v2 member is optional and carries no zod default or transform, so a v1 payload still parses,
// canonicalises and digests exactly as before. Defaults (comment visibility `internal`) are applied
// by the writer, never by the schema. Datetimes are ISO strings, never coerced, so a stored preview
// round-trips byte-for-byte.
const noNul = (value: unknown) => !JSON.stringify(value)?.includes("\\u0000");
const isoDateTime = z.string().datetime({ offset: true });
const sourceEmail = z.string().email().max(320);
const personName = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !value.includes("\u0000"));
const sourceEntityRef = z
  .object({ sourceType: opaque(80), sourceId: opaque(512) })
  .strict();
const COMMENT_BODY_MAX_CHARS = 100_000;
const importCommentBody = z.union([
  z
    .string()
    .min(1)
    .max(COMMENT_BODY_MAX_CHARS)
    .refine((value) => !value.includes("\u0000")),
  z
    .object({ type: z.literal("doc") })
    .passthrough()
    .refine(noNul)
    .refine((value) => JSON.stringify(value).length <= 256 * 1024),
]);
export const importCommentSchema = z
  .object({
    sourceId: opaque(512),
    authorEmail: sourceEmail.optional(),
    authorName: personName.optional(),
    createdAt: isoDateTime.optional(),
    updatedAt: isoDateTime.optional(),
    /** Absent means `internal`: the source rarely distinguishes, and internal is the safe default. */
    visibility: z.enum(["public", "internal"]).optional(),
    body: importCommentBody,
  })
  .strict();
export const importAttachmentSchema = z
  .object({
    sourceId: opaque(512),
    url: sourceUrl,
    filename: z
      .string()
      .min(1)
      .max(255)
      .refine(
        (value) =>
          !value.includes("/") &&
          !value.includes("\\") &&
          [...value].every(
            (character) => (character.codePointAt(0) ?? 0) >= 32,
          ),
      ),
    mimeType: z.string().min(1).max(200).optional(),
    size: z.number().int().nonnegative().safe().optional(),
    authorEmail: sourceEmail.optional(),
    authorName: personName.optional(),
    createdAt: isoDateTime.optional(),
  })
  .strict();
export const importRelationSchema = z
  .object({
    type: z.enum(["relates", "blocks", "duplicates", "precedes", "requires"]),
    target: sourceEntityRef,
  })
  .strict();
const historyValue = z.union([
  z.string().max(2000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export const importHistorySchema = z
  .object({
    sourceId: opaque(512),
    at: isoDateTime,
    authorEmail: sourceEmail.optional(),
    authorName: personName.optional(),
    field: opaque(120),
    from: historyValue.optional(),
    to: historyValue.optional(),
  })
  .strict();
export const importCustomFieldSchema = z
  .object({ key: opaque(120), value: z.unknown().refine(noNul) })
  .strict();

export const importRunIdParams = z.object({ id: opaque(128) });
export const createImportRunBody = z
  .object({
    workspaceId: opaque(128),
    projectId: opaque(128),
    pluginId: z.literal("import.mcp"),
    sourceRef: opaque(200),
    profileId: opaque(128).optional(),
  })
  .strict();
export const listImportRunsQuery = z.object({
  workspaceId: opaque(128),
  projectId: opaque(128).optional(),
  state: z
    .enum(["queued", "running", "paused", "completed", "failed"])
    .optional(),
  cursor: opaque(128).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});
export const importRecordsSchema = z
  .array(
    z
      .object({
        sourceType: opaque(80),
        sourceId: opaque(512),
        sourceUrl: sourceUrl.optional(),
        sourceHash: sha256.optional(),
        sourceCreatedAt: isoDateTime.optional(),
        sourceUpdatedAt: isoDateTime.optional(),
        sourceResolvedAt: isoDateTime.optional(),
        sourceAuthorEmail: sourceEmail.optional(),
        sourceAuthorName: personName.optional(),
        /** Imported assignee, matched by email to an eligible project member; never a placeholder. */
        assigneeEmail: sourceEmail.optional(),
        /** An existing state of the target project, chosen by the operator mapping. */
        stateId: opaque(128).optional(),
        parent: sourceEntityRef.optional(),
        comments: z.array(importCommentSchema).max(500).optional(),
        attachments: z.array(importAttachmentSchema).max(100).optional(),
        relations: z.array(importRelationSchema).max(200).optional(),
        customFields: z.array(importCustomFieldSchema).max(100).optional(),
        history: z.array(importHistorySchema).max(1000).optional(),
        item: canonicalItem,
      })
      .strict(),
  )
  .min(1)
  .max(500)
  .superRefine((records, context) => {
    const seen = new Set<string>();
    records.forEach((record, index) => {
      const key = JSON.stringify([record.sourceType, record.sourceId]);
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: [index, "sourceId"],
          message: "Duplicate source identity in import chunk",
        });
      }
      seen.add(key);
    });
  });
export const dryRunImportBody = z
  .object({
    chunkId: opaque(128),
    expectedVersion: z.number().int().positive().safe(),
    records: importRecordsSchema,
  })
  .strict();
export const executeImportBody = dryRunImportBody
  .extend({ previewDigest: sha256 })
  .strict();
export const linkImportBody = z
  .object({
    links: z
      .array(
        z
          .object({
            sourceType: opaque(80),
            sourceId: opaque(512),
            targetType: z.literal("work_item"),
            targetId: opaque(128),
            sourceHash: sha256.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export const listImportLinksQuery = z.object({
  sourceType: opaque(80).optional(),
  sourceId: opaque(512).optional(),
  cursor: opaque(128).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

export type ImportRunRequest = z.infer<typeof createImportRunBody>;
export type ImportRecord = z.infer<typeof dryRunImportBody>["records"][number];
export type ImportItem = ImportRecord["item"];
export type ImportComment = z.infer<typeof importCommentSchema>;
export type ImportAttachment = z.infer<typeof importAttachmentSchema>;
export type ImportRelation = z.infer<typeof importRelationSchema>;
export type ImportHistoryEntry = z.infer<typeof importHistorySchema>;
