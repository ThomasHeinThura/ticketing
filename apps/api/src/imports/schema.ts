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
        sourceCreatedAt: z.string().datetime({ offset: true }).optional(),
        sourceAuthorEmail: z.string().email().max(320).optional(),
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
