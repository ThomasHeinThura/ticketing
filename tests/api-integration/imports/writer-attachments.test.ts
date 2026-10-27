import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import {
  commitImportChunk,
  drainImportAttachmentJobs,
  resumePendingImportAttachments,
} from "../../../apps/api/src/imports/service";
import {
  type ImportAttachmentJob,
  markMissingImportSourcesStale,
  setImportAttachmentDependencies,
} from "../../../apps/api/src/imports/writer";
import { createApp } from "../../../apps/api/src/index";
import { resetTestDatabase } from "../helpers/database";
import {
  commitChunk,
  createRun,
  getReport,
  previewChunk,
  record,
  writerFixture,
} from "./writer-fixture";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8,
]);
const URL_OK = "https://files.source.example.test/a/diagram.png";

let root: string;
// biome-ignore lint/suspicious/noUndeclaredEnvVars: the test sets this environment value for itself.
const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
// biome-ignore lint/suspicious/noUndeclaredEnvVars: the test sets this environment value for itself.
const originalDriver = process.env.TASKDESK_STORAGE_DRIVER;

beforeEach(async () => {
  await resetTestDatabase();
  root = await mkdtemp(path.join(tmpdir(), "p6b-attachments-"));
  process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: the test sets this environment value for itself.
  delete process.env.TASKDESK_STORAGE_DRIVER;
});

afterEach(async () => {
  setImportAttachmentDependencies(null);
  await rm(root, { recursive: true, force: true });
  if (originalRoot === undefined)
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: the test sets this environment value for itself.
    delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
  else process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = originalRoot;
  if (originalDriver !== undefined)
    process.env.TASKDESK_STORAGE_DRIVER = originalDriver;
});

function attachmentRecord(
  f: Awaited<ReturnType<typeof writerFixture>>,
  sourceId: string,
  attachments: Array<Record<string, unknown>>,
) {
  return record(f, sourceId, { attachments });
}

describe("import writer: attachments (IM-4, download failure edge case)", () => {
  it("downloads, stores and records an attachment with provenance, staff-visible only", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const download = vi.fn(async () => ({
      ok: true as const,
      bytes: PNG,
      contentType: "image/png",
    }));
    setImportAttachmentDependencies({ download });
    const run = await createRun(app, f, "att-ok");
    const { commit } = await commitChunk(app, f, run.id, "c1", [
      attachmentRecord(f, "A-1", [
        {
          sourceId: "att-1",
          url: URL_OK,
          filename: "diagram.png",
          mimeType: "image/png",
          authorEmail: "gone.author@example.test",
          authorName: "Gone Author",
          createdAt: "2022-02-02T02:02:02.000Z",
        },
      ]),
    ]);
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith(
      URL_OK,
      expect.objectContaining({ maxBytes: expect.any(Number) }),
    );
    const targetId = commit.rows[0]?.targetId as string;
    const [attachment] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.workItemId, targetId));
    expect(attachment).toMatchObject({
      state: "ready",
      filename: "diagram.png",
      mimeType: "image/png",
      size: PNG.byteLength,
      customerVisible: false,
    });
    expect(attachment?.createdAt.toISOString()).toBe(
      "2022-02-02T02:02:02.000Z",
    );
    const stored = await readFile(
      path.join(root, attachment?.objectKey as string),
    );
    expect(new Uint8Array(stored)).toEqual(PNG);
    const [placeholder] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.isPlaceholder, true));
    expect(attachment?.uploadedBy).toBe(placeholder?.id);
    const [provenance] = await db
      .select()
      .from(schema.importProvenanceTable)
      .where(
        eq(schema.importProvenanceTable.entityId, attachment?.id as string),
      );
    expect(provenance).toMatchObject({
      entityType: "attachment",
      system: "att-ok",
      externalId: "issue:A-1#attachment:att-1",
      url: URL_OK,
      origin: "imported",
    });
    const activity = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.verb, "attachment.added"));
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      visibility: "internal",
      origin: "imported",
    });
    const report = await getReport(app, f, run.id);
    expect(report.chunks[0]?.lossCounts).toBeUndefined();
  });

  it("imports the item and reports a failed download as a loss carrying the source URL", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    setImportAttachmentDependencies({
      download: async () => ({ ok: false as const, code: "failed" as const }),
    });
    const run = await createRun(app, f, "att-fail");
    const { commit } = await commitChunk(app, f, run.id, "c1", [
      record(f, "A-2", {
        comments: [{ sourceId: "c", body: "Comment survives" }],
        attachments: [
          {
            sourceId: "gone",
            url: "https://files.source.example.test/missing.png",
            filename: "missing.png",
          },
        ],
      }),
    ]);
    expect(commit.counts).toMatchObject({ created: 1 });
    expect(await db.select().from(schema.attachmentTable)).toHaveLength(0);
    expect(await db.select().from(schema.commentTable)).toHaveLength(1);
    const report = await getReport(app, f, run.id);
    expect(report.chunks[0]?.lossCounts).toEqual({
      attachment_download_failed: 1,
    });
    expect(report.chunks[0]?.losses).toEqual([
      expect.objectContaining({
        code: "attachment_download_failed",
        entity: "attachment",
        sourceId: "A-2",
        entitySourceId: "gone",
        sourceUrl: "https://files.source.example.test/missing.png",
      }),
    ]);
  });

  it("reports a refused destination from the real guarded client (SSRF) as a download loss", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const run = await createRun(app, f, "att-ssrf");
    await commitChunk(app, f, run.id, "c1", [
      attachmentRecord(f, "S-1", [
        {
          sourceId: "loop",
          url: "https://127.0.0.1/secret.png",
          filename: "secret.png",
        },
        {
          sourceId: "meta",
          url: "https://169.254.169.254/latest.png",
          filename: "latest.png",
        },
        {
          sourceId: "local",
          url: "https://localhost/x.png",
          filename: "x.png",
        },
      ]),
    ]);
    expect(await db.select().from(schema.attachmentTable)).toHaveLength(0);
    const report = await getReport(app, f, run.id);
    expect(report.chunks[0]?.lossCounts).toEqual({
      attachment_download_failed: 3,
    });
  });

  it("reports oversized, disallowed and mismatching attachments without storing anything", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    await db
      .update(schema.instanceSettingTable)
      .set({ attachmentMaxBytes: 64 });
    const put = vi.fn(async () => {});
    const download = vi.fn(async (url: string) =>
      url.includes("text-as-png")
        ? {
            ok: true as const,
            bytes: new TextEncoder().encode("not a png at all"),
            contentType: null,
          }
        : url.includes("big")
          ? { ok: false as const, code: "too_large" as const }
          : { ok: true as const, bytes: PNG, contentType: "image/png" },
    );
    setImportAttachmentDependencies({ download, put });
    const run = await createRun(app, f, "att-limits");
    await commitChunk(app, f, run.id, "c1", [
      attachmentRecord(f, "L-1", [
        {
          sourceId: "declared-big",
          url: "https://files.source.example.test/big-declared.png",
          filename: "big-declared.png",
          size: 999,
        },
        {
          sourceId: "streamed-big",
          url: "https://files.source.example.test/big.png",
          filename: "big.png",
        },
        {
          sourceId: "exe",
          url: "https://files.source.example.test/run.exe",
          filename: "run.exe",
        },
        {
          sourceId: "mismatch",
          url: "https://files.source.example.test/text-as-png.png",
          filename: "text-as-png.png",
        },
        { sourceId: "fine", url: URL_OK, filename: "fine.png" },
      ]),
    ]);
    const report = await getReport(app, f, run.id);
    expect(report.chunks[0]?.lossCounts).toEqual({
      attachment_too_large: 2,
      attachment_type_not_allowed: 1,
      attachment_content_mismatch: 1,
    });
    // the declared-oversize and disallowed ones were never fetched
    expect(download.mock.calls.map((call) => call[0])).toEqual([
      "https://files.source.example.test/big.png",
      "https://files.source.example.test/text-as-png.png",
      URL_OK,
    ]);
    expect(put).toHaveBeenCalledTimes(1);
    expect(await db.select().from(schema.attachmentTable)).toHaveLength(1);
    for (const loss of report.chunks[0]?.losses ?? [])
      expect(loss.sourceUrl).toMatch(
        /^https:\/\/files\.source\.example\.test\//u,
      );
  });

  it("does not download again on a rerun and never duplicates the attachment", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const download = vi.fn(async () => ({
      ok: true as const,
      bytes: PNG,
      contentType: "image/png",
    }));
    setImportAttachmentDependencies({ download });
    const records = () => [
      attachmentRecord(f, "RR-1", [
        { sourceId: "same", url: URL_OK, filename: "diagram.png" },
      ]),
    ];
    const run1 = await createRun(app, f, "att-rerun");
    await commitChunk(app, f, run1.id, "c1", records());
    const run2 = await createRun(app, f, "att-rerun");
    await commitChunk(app, f, run2.id, "c1", records());
    expect(download).toHaveBeenCalledTimes(1);
    expect(await db.select().from(schema.attachmentTable)).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.importProvenanceTable)
        .where(eq(schema.importProvenanceTable.entityType, "attachment")),
    ).toHaveLength(1);
  });

  it("keeps an attachment fresh on a rerun and marks a removed one stale (P6-R1-05)", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    setImportAttachmentDependencies({
      download: vi.fn(async () => ({
        ok: true as const,
        bytes: PNG,
        contentType: "image/png",
      })),
    });
    const both = [
      { sourceId: "keep", url: URL_OK, filename: "keep.png" },
      { sourceId: "drop", url: URL_OK, filename: "drop.png" },
    ];
    const run1 = await createRun(app, f, "att-stale");
    await commitChunk(app, f, run1.id, "c1", [
      attachmentRecord(f, "ST-1", both),
    ]);
    // The source no longer lists "drop"; "keep" is still there (its download is skipped).
    const run2 = await createRun(app, f, "att-stale");
    await commitChunk(app, f, run2.id, "c1", [
      attachmentRecord(f, "ST-1", [both[0] as (typeof both)[number]]),
    ]);
    await db.transaction((tx) =>
      markMissingImportSourcesStale(tx, {
        workspaceId: f.workspace.id,
        pluginId: "import.mcp",
        sourceRef: "att-stale",
        currentRunId: run2.id,
      }),
    );
    const rows = await db
      .select()
      .from(schema.importProvenanceTable)
      .where(eq(schema.importProvenanceTable.entityType, "attachment"));
    const keep = rows.find((row) =>
      row.externalId.endsWith("#attachment:keep"),
    );
    const drop = rows.find((row) =>
      row.externalId.endsWith("#attachment:drop"),
    );
    expect(keep).toMatchObject({ importRunId: run2.id, staleAt: null });
    expect(drop?.staleAt).not.toBeNull();
    expect(drop?.importRunId).toBe(run1.id);
  });

  it("reports a storage failure and removes the stored object when the row cannot be written", async () => {
    const f = await writerFixture();
    const remove = vi.fn(async () => {});
    setImportAttachmentDependencies({
      download: async () => ({
        ok: true as const,
        bytes: PNG,
        contentType: null,
      }),
      put: async () => {
        throw new Error("storage offline");
      },
      remove,
    });
    const job = (workItemId: string): ImportAttachmentJob => ({
      workspaceId: f.workspace.id,
      organisationId: f.workspace.organisationId,
      projectId: f.project.id,
      runId: randomUUID(),
      pluginId: "import.mcp",
      system: "att-storage",
      chunkRowId: randomUUID(),
      workItemId,
      sourceType: "issue",
      sourceId: "ST-1",
      attachment: { sourceId: "a", url: URL_OK, filename: "diagram.png" },
      uploaderPersonId: null,
      attachmentOrganisationId: null,
    });
    const failed = await drainImportAttachmentJobs([job("whatever")]);
    expect(failed.losses).toEqual([
      expect.objectContaining({
        code: "attachment_storage_unavailable",
        sourceUrl: URL_OK,
      }),
    ]);

    // storage works, but the item vanished before the row was written: the object is removed again
    setImportAttachmentDependencies({
      download: async () => ({
        ok: true as const,
        bytes: PNG,
        contentType: null,
      }),
      put: async () => {},
      remove,
    });
    const orphaned = await drainImportAttachmentJobs([job("missing-item")]);
    expect(orphaned.losses).toEqual([
      expect.objectContaining({ code: "attachment_storage_unavailable" }),
    ]);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(await db.select().from(schema.attachmentTable)).toHaveLength(0);
  });
  it("keeps planned attachments durable across a crash between commit and download, then resumes", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const download = vi.fn(async (url: string) =>
      url.includes("broken")
        ? { ok: false as const, code: "failed" as const }
        : { ok: true as const, bytes: PNG, contentType: "image/png" },
    );
    setImportAttachmentDependencies({ download });
    const run = await createRun(app, f, "att-crash");
    const records = [
      attachmentRecord(f, "CR-1", [
        { sourceId: "good", url: URL_OK, filename: "good.png" },
        {
          sourceId: "bad",
          url: "https://files.source.example.test/broken.png",
          filename: "broken.png",
        },
      ]),
    ];
    const preview = await previewChunk(app, f, run.id, "c1", records);
    // the process "dies" right after the commit: no publish, no drain
    const committed = await db.transaction((tx) =>
      commitImportChunk(tx, {
        actor: {
          userId: f.user.id,
          actorType: "api_key",
          apiKeyId: f.fullKey.id,
          apiKey: { id: f.fullKey.id },
          impersonatedBy: null,
        },
        runId: run.id,
        chunkId: "c1",
        expectedVersion: preview.runVersion,
        previewDigest: preview.previewDigest,
        records: records as never,
      }),
    );
    expect(committed.kind).toBe("committed");
    expect(download).not.toHaveBeenCalled();
    expect(await db.select().from(schema.attachmentTable)).toHaveLength(0);
    let report = await getReport(app, f, run.id);
    expect(report.chunks[0]).toMatchObject({ pendingAttachments: 2 });

    const resumed = await resumePendingImportAttachments(run.id);
    expect(resumed.written).toBe(1);
    expect(await db.select().from(schema.attachmentTable)).toHaveLength(1);
    report = await getReport(app, f, run.id);
    expect(report.chunks[0]?.pendingAttachments).toBeUndefined();
    expect(report.chunks[0]?.lossCounts).toEqual({
      attachment_download_failed: 1,
    });
    // resuming again is a no-op
    expect((await resumePendingImportAttachments(run.id)).written).toBe(0);
    expect(download).toHaveBeenCalledTimes(2);
  });
});
