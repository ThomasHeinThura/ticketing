import { createId } from "@paralleldrive/cuid2";
import { and, count, eq, isNull } from "drizzle-orm";
import {
  EXTENSION_MIME_TYPES,
  isMimeTypeAllowedForExtension,
  magicBytesMatchDeclaredMime,
} from "../../attachment/magic-bytes";
import {
  findAttachmentWorkspaceOrganisation,
  getAttachmentSettings,
} from "../../attachment/repository";
import db, { schema } from "../../database";
import type { Transaction } from "../../database/executor";
import {
  buildAttachmentStorageKey,
  deleteStorageObject,
  getFileExtension,
  putAttachmentObject,
  sanitizePathSegment,
  toFinalAttachmentObjectKey,
} from "../../storage";
import type { ImportAttachment, ImportRecord } from "../schema";
import {
  attachmentExternalId,
  claimEntityProvenance,
  touchEntityProvenance,
} from "./provenance";
import {
  type ImportAttachmentAuth,
  type SafeDownloadResult,
  safeDownload,
} from "./safe-fetch";
import { readSourceTime } from "./time";
import {
  type ImportLoss,
  type ImportWriterContext,
  MAX_REPORTED_LOSSES,
  recordLoss,
} from "./types";

const FALLBACK_MAX_BYTES = 25 * 1024 * 1024;
const FALLBACK_MAX_PER_ITEM = 100;
const SNIFF_BYTES = 512;

/** Network and storage seams. Production uses the guarded download and the storage driver. */
export type ImportAttachmentDependencies = {
  download: (
    url: string,
    options: { maxBytes: number; auth?: ImportAttachmentAuth | null },
  ) => Promise<SafeDownloadResult>;
  put: (
    key: string,
    bytes: Uint8Array,
    contentType: string,
    maxBytes: number,
  ) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

const defaultDependencies: ImportAttachmentDependencies = {
  // One same-host redirect is followed (re-validated like the first request). A redirect to another
  // host is never followed (SSRF policy): Jira Cloud serves attachments from a media host, so those
  // are reported as `attachment_download_failed` with their source URL.
  download: (url, options) =>
    safeDownload(url, { ...options, maxRedirects: 1 }),
  put: putAttachmentObject,
  remove: deleteStorageObject,
};
let dependencies: ImportAttachmentDependencies = defaultDependencies;

/** Test seam (D6: fixture-only sources). Pass `null` to restore the guarded production client. */
export function setImportAttachmentDependencies(
  overrides: Partial<ImportAttachmentDependencies> | null,
) {
  dependencies = overrides
    ? { ...defaultDependencies, ...overrides }
    : defaultDependencies;
}

/** One attachment to download and store AFTER the chunk transaction has committed. */
export type ImportAttachmentJob = {
  workspaceId: string;
  organisationId: string;
  projectId: string;
  runId: string;
  pluginId: string;
  system: string;
  chunkRowId: string;
  workItemId: string;
  sourceType: string;
  sourceId: string;
  attachment: ImportAttachment;
  uploaderPersonId: string | null;
  /** `attachment.organisation_id`: null for an internal workspace (same rule as the presign route). */
  attachmentOrganisationId: string | null;
};

function extensionOf(filename: string) {
  return getFileExtension(filename).toLowerCase();
}

/**
 * Inside the commit transaction (no network): decide which attachments still need to be fetched.
 * Already-imported ones (provenance exists) are skipped so a rerun downloads nothing. Attachments
 * that can never be stored (type not allowed, declared size over the limit, per-item cap) are
 * reported now, with their source URL, rather than fetched for nothing.
 */
export async function planImportAttachments(
  ctx: ImportWriterContext,
  input: {
    workItemId: string;
    record: ImportRecord;
    chunkRowId: string;
    uploaderPersonId: (
      email: string | undefined,
      name: string | undefined,
    ) => Promise<string | null>;
  },
): Promise<ImportAttachmentJob[]> {
  const { record } = input;
  const attachments = record.attachments ?? [];
  if (!attachments.length) return [];
  const [settings] = await getAttachmentSettings(ctx.tx);
  const [workspaceOrganisation] = await findAttachmentWorkspaceOrganisation(
    ctx.tx,
    ctx.workspaceId,
  );
  const attachmentOrganisationId =
    workspaceOrganisation && !workspaceOrganisation.isInternal
      ? workspaceOrganisation.id
      : null;
  const maxBytes = settings?.maxBytes ?? FALLBACK_MAX_BYTES;
  const maxPerItem = settings?.maxPerItem ?? FALLBACK_MAX_PER_ITEM;
  const allowed = (settings?.allowedExtensions ?? []).map((value) =>
    value.toLowerCase(),
  );
  const [existing] = await ctx.tx
    .select({ value: count() })
    .from(schema.attachmentTable)
    .where(
      and(
        eq(schema.attachmentTable.workItemId, input.workItemId),
        isNull(schema.attachmentTable.deletedAt),
      ),
    );
  let slots = Math.max(0, maxPerItem - (existing?.value ?? 0));
  const jobs: ImportAttachmentJob[] = [];
  for (const attachment of attachments) {
    const loss = (code: ImportLoss["code"]) =>
      recordLoss(ctx, {
        code,
        sourceType: record.sourceType,
        sourceId: record.sourceId,
        entity: "attachment",
        entitySourceId: attachment.sourceId,
        sourceUrl: attachment.url,
      });
    if (
      await touchEntityProvenance(ctx, {
        entityType: "attachment",
        externalId: attachmentExternalId(
          record.sourceType,
          record.sourceId,
          attachment.sourceId,
        ),
      })
    )
      continue;
    const extension = extensionOf(attachment.filename);
    if (
      !extension ||
      (allowed.length > 0 && !allowed.includes(extension)) ||
      !EXTENSION_MIME_TYPES[extension]
    ) {
      loss("attachment_type_not_allowed");
      continue;
    }
    if (attachment.size !== undefined && attachment.size > maxBytes) {
      loss("attachment_too_large");
      continue;
    }
    if (slots <= 0) {
      loss("attachment_limit_reached");
      continue;
    }
    slots -= 1;
    jobs.push({
      workspaceId: ctx.workspaceId,
      organisationId: ctx.organisationId,
      projectId: ctx.projectId,
      runId: ctx.runId,
      pluginId: ctx.pluginId,
      system: ctx.system,
      chunkRowId: input.chunkRowId,
      workItemId: input.workItemId,
      sourceType: record.sourceType,
      sourceId: record.sourceId,
      attachment,
      uploaderPersonId: await input.uploaderPersonId(
        attachment.authorEmail,
        attachment.authorName,
      ),
      attachmentOrganisationId,
    });
  }
  return jobs;
}

export type ImportAttachmentOutcome = {
  written: number;
  skipped: number;
  losses: ImportLoss[];
};

/**
 * AFTER the chunk commit and outside any long transaction: download each attachment through the
 * guarded client, check size, type and content, store it, then insert the row in a short
 * transaction that re-checks the item is live and claims the provenance row (so a concurrent rerun
 * cannot create a second copy). A failure never loses the item: it becomes a loss carrying the
 * source URL, the stored object is removed, and the remaining attachments continue.
 */
export async function processImportAttachmentJobs(
  jobs: readonly ImportAttachmentJob[],
  options: { auth?: ImportAttachmentAuth | null } = {},
): Promise<ImportAttachmentOutcome> {
  const outcome: ImportAttachmentOutcome = {
    written: 0,
    skipped: 0,
    losses: [],
  };
  if (!jobs.length) return outcome;
  const [settings] = await getAttachmentSettings(db);
  const maxBytes = settings?.maxBytes ?? FALLBACK_MAX_BYTES;
  for (const job of jobs) {
    const result = await processOne(job, maxBytes, options.auth ?? null);
    if (result === "written") outcome.written += 1;
    else if (result === "duplicate") outcome.skipped += 1;
    else if (result === "conflict")
      outcome.losses.push({
        code: "provenance_duplicate",
        sourceType: job.sourceType,
        sourceId: job.sourceId,
        entity: "attachment",
        entitySourceId: job.attachment.sourceId,
        sourceUrl: job.attachment.url,
      });
    else outcome.losses.push(result);
  }
  return outcome;
}

async function processOne(
  job: ImportAttachmentJob,
  maxBytes: number,
  auth: ImportAttachmentAuth | null,
): Promise<"written" | "duplicate" | "conflict" | ImportLoss> {
  const { attachment } = job;
  const loss = (code: ImportLoss["code"]): ImportLoss => ({
    code,
    sourceType: job.sourceType,
    sourceId: job.sourceId,
    entity: "attachment",
    entitySourceId: attachment.sourceId,
    sourceUrl: attachment.url,
  });
  const downloaded = await dependencies
    .download(attachment.url, { maxBytes, auth })
    .catch((): SafeDownloadResult => ({ ok: false, code: "failed" }));
  if (!downloaded.ok)
    return loss(
      downloaded.code === "too_large"
        ? "attachment_too_large"
        : "attachment_download_failed",
    );
  const bytes = downloaded.bytes;
  if (bytes.byteLength > maxBytes) return loss("attachment_too_large");
  const extension = extensionOf(attachment.filename);
  const fallbackMime = EXTENSION_MIME_TYPES[extension]?.[0];
  const mime =
    attachment.mimeType &&
    isMimeTypeAllowedForExtension(extension, attachment.mimeType)
      ? attachment.mimeType
      : fallbackMime;
  if (!mime) return loss("attachment_type_not_allowed");
  if (
    !magicBytesMatchDeclaredMime(
      Buffer.from(bytes.subarray(0, SNIFF_BYTES)),
      mime,
    )
  )
    return loss("attachment_content_mismatch");

  const attachmentId = createId();
  const baseName = sanitizePathSegment(
    attachment.filename.replace(/\.[^/.]+$/, "") || "file",
  );
  const pendingKey = [
    "workspace",
    sanitizePathSegment(job.workspaceId),
    "work-item",
    sanitizePathSegment(job.workItemId),
    "attachment",
    attachmentId,
    `${baseName}.${extension}`,
  ].join("/");
  const objectKey = toFinalAttachmentObjectKey(
    buildAttachmentStorageKey(pendingKey),
  );
  try {
    await dependencies.put(objectKey, bytes, mime, maxBytes);
  } catch {
    return loss("attachment_storage_unavailable");
  }
  try {
    const result = await db.transaction(async (tx) =>
      insertAttachment(tx, job, {
        attachmentId,
        objectKey,
        mime,
        size: bytes.byteLength,
      }),
    );
    if (result === "duplicate" || result === "conflict") {
      await dependencies.remove(objectKey).catch(() => {});
      return result;
    }
    return "written";
  } catch {
    await dependencies.remove(objectKey).catch(() => {});
    return loss("attachment_storage_unavailable");
  }
}

async function insertAttachment(
  tx: Transaction,
  job: ImportAttachmentJob,
  stored: {
    attachmentId: string;
    objectKey: string;
    mime: string;
    size: number;
  },
): Promise<"written" | "duplicate" | "conflict"> {
  const { attachment } = job;
  const [item] = await tx
    .select({ id: schema.workItemTable.id })
    .from(schema.workItemTable)
    .where(
      and(
        eq(schema.workItemTable.id, job.workItemId),
        eq(schema.workItemTable.workspaceId, job.workspaceId),
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
      ),
    )
    .for("share")
    .limit(1);
  if (!item) throw new Error("work item no longer available");
  const now = new Date();
  const created = readSourceTime(attachment.createdAt, now, now);
  const ctx: ImportWriterContext = {
    tx,
    workspaceId: job.workspaceId,
    organisationId: job.organisationId,
    projectId: job.projectId,
    runId: job.runId,
    pluginId: job.pluginId,
    system: job.system,
    now,
    people: new Map(),
    losses: [],
    stats: { placeholdersCreated: 0 },
  };
  const claim = await claimEntityProvenance(ctx, {
    entityType: "attachment",
    externalId: attachmentExternalId(
      job.sourceType,
      job.sourceId,
      attachment.sourceId,
    ),
    entityId: stored.attachmentId,
    workItemId: job.workItemId,
    url: attachment.url,
    title: attachment.filename,
    sourceCreatedAt: created.valid ? created.at : null,
  });
  if (claim.conflict) return "conflict";
  if (!claim.claimed) return "duplicate";
  await tx.insert(schema.attachmentTable).values({
    id: stored.attachmentId,
    workspaceId: job.workspaceId,
    organisationId: job.attachmentOrganisationId,
    workItemId: job.workItemId,
    objectKey: stored.objectKey,
    filename: attachment.filename.slice(0, 255),
    mimeType: stored.mime,
    size: stored.size,
    state: "ready",
    // AT-3: imported files are staff-visible only; never customer-visible by default.
    customerVisible: false,
    uploadedBy: job.uploaderPersonId,
    createdAt: created.at,
  });
  await tx.insert(schema.activityTable).values({
    workspaceId: job.workspaceId,
    workItemId: job.workItemId,
    actorId: job.uploaderPersonId,
    actorType: job.uploaderPersonId ? "person" : "system",
    verb: "attachment.added",
    payload: {
      attachmentId: stored.attachmentId,
      filename: attachment.filename.slice(0, 255),
      imported: true,
    },
    visibility: "internal",
    createdAt: created.at,
    origin: "imported",
    importedAt: now,
  });
  return "written";
}

/** Identity of one planned attachment inside a chunk's pending ledger. */
export function importAttachmentJobKey(job: {
  sourceType: string;
  sourceId: string;
  attachment: { sourceId: string };
}) {
  return JSON.stringify([
    job.sourceType,
    job.sourceId,
    job.attachment.sourceId,
  ]);
}

/**
 * Close out planned attachments on the committed chunk's stored report: remove each processed job
 * from the pending ledger (`pendingAttachments`, written inside the commit transaction so a crash
 * between commit and download leaves a durable, resumable record rather than a silent drop) and add
 * what could not be stored to the loss report, next to the in-transaction losses. Bounded; counts
 * keep the full tally.
 */
export async function settleChunkAttachments(
  chunkRowId: string,
  settled: readonly ImportAttachmentJob[],
  losses: readonly ImportLoss[],
) {
  if (!settled.length && !losses.length) return;
  await db.transaction(async (tx) => {
    const [chunk] = await tx
      .select({ report: schema.importChunkTable.report })
      .from(schema.importChunkTable)
      .where(eq(schema.importChunkTable.id, chunkRowId))
      .for("update")
      .limit(1);
    if (!chunk) return;
    const done = new Set(settled.map(importAttachmentJobKey));
    const pending = Array.isArray(chunk.report.pendingAttachments)
      ? (chunk.report.pendingAttachments as ImportAttachmentJob[]).filter(
          (job) => !done.has(importAttachmentJobKey(job)),
        )
      : [];
    const { pendingAttachments: _previous, ...rest } = chunk.report;
    const merged = mergeLossesIntoReport(rest, losses);
    await tx
      .update(schema.importChunkTable)
      .set({
        report: pending.length
          ? { ...merged, pendingAttachments: pending }
          : merged,
      })
      .where(eq(schema.importChunkTable.id, chunkRowId));
  });
}

/** Planned attachments of a run that were committed but not yet stored or reported (crash recovery). */
export async function listPendingImportAttachmentJobs(
  runId: string,
): Promise<ImportAttachmentJob[]> {
  const chunks = await db
    .select({ report: schema.importChunkTable.report })
    .from(schema.importChunkTable)
    .where(
      and(
        eq(schema.importChunkTable.importRunId, runId),
        eq(schema.importChunkTable.state, "committed"),
      ),
    );
  return chunks.flatMap((chunk) =>
    Array.isArray(chunk.report.pendingAttachments)
      ? (chunk.report.pendingAttachments as ImportAttachmentJob[])
      : [],
  );
}

/** Tally of losses by fixed code. */
export function tallyLosses(
  losses: readonly ImportLoss[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const loss of losses) counts[loss.code] = (counts[loss.code] ?? 0) + 1;
  return counts;
}

/** Pure merge shared with the commit path. */
export function mergeLossesIntoReport(
  report: Record<string, unknown>,
  incoming: readonly ImportLoss[],
): Record<string, unknown> {
  const existing = Array.isArray(report.losses)
    ? (report.losses as ImportLoss[])
    : [];
  const counts: Record<string, number> = {
    ...((report.lossCounts as Record<string, number> | undefined) ?? {}),
  };
  for (const loss of incoming) counts[loss.code] = (counts[loss.code] ?? 0) + 1;
  return {
    ...report,
    losses: [...existing, ...incoming].slice(0, MAX_REPORTED_LOSSES),
    lossCounts: counts,
  };
}
