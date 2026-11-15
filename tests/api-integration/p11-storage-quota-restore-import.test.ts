import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { setImportAttachmentDependencies } from "../../apps/api/src/imports/writer";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";
import {
  commitChunk,
  createRun,
  getReport,
  record,
  writerFixture,
} from "./imports/writer-fixture";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
]);

async function listFilesRecursively(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

describe("P-11: organisation storage quota on attachment restore and import", () => {
  let root: string;
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: isolated filesystem root for test.
  const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: isolated storage driver for test.
  const originalDriver = process.env.TASKDESK_STORAGE_DRIVER;

  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(path.join(tmpdir(), "p11-quota-"));
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: isolated storage driver for test.
    delete process.env.TASKDESK_STORAGE_DRIVER;
  });

  afterEach(async () => {
    setImportAttachmentDependencies(null);
    await rm(root, { recursive: true, force: true });
    if (originalRoot === undefined)
      // biome-ignore lint/suspicious/noUndeclaredEnvVars: isolated filesystem root for test.
      delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    else process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = originalRoot;
    if (originalDriver === undefined)
      // biome-ignore lint/suspicious/noUndeclaredEnvVars: isolated storage driver for test.
      delete process.env.TASKDESK_STORAGE_DRIVER;
    else process.env.TASKDESK_STORAGE_DRIVER = originalDriver;
  });

  it("refuses attachment restore with 429 at the organisation storage limit and succeeds once below limit", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    mockAuthenticatedSession(f.user);

    const createItemResponse = await app.request(
      `/api/projects/${f.project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          typeId: f.type.id,
          title: "Quota restore item",
        }),
      },
    );
    expect(createItemResponse.status).toBe(200);
    const { key: createdKey } = (await createItemResponse.json()) as {
      key: string;
    };
    const createdItem = requireRow(
      await db
        .select()
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.key, createdKey)),
      "created work item",
    );

    const existingId = randomUUID();
    const recoverableId = randomUUID();
    const existingKey = `workspace/${f.workspace.id}/work-item/${createdItem.id}/attachment/${existingId}/final/existing.png`;
    const recoverableKey = `workspace/${f.workspace.id}/work-item/${createdItem.id}/attachment/${recoverableId}/final/recoverable.png`;
    for (const objectKey of [existingKey, recoverableKey]) {
      const fullPath = path.join(root, objectKey);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, PNG);
    }

    await db.insert(schema.attachmentTable).values({
      id: existingId,
      workspaceId: f.workspace.id,
      workItemId: createdItem.id,
      objectKey: existingKey,
      filename: "existing.png",
      mimeType: "image/png",
      size: PNG.byteLength,
      state: "ready",
      uploadedBy: f.person.id,
    });

    const recoverable = requireRow(
      await db
        .insert(schema.attachmentTable)
        .values({
          id: recoverableId,
          workspaceId: f.workspace.id,
          workItemId: createdItem.id,
          objectKey: recoverableKey,
          filename: "recoverable.png",
          mimeType: "image/png",
          size: PNG.byteLength,
          state: "deleted",
          deletedAt: new Date(Date.now() - 60 * 60 * 1000),
          uploadedBy: f.person.id,
        })
        .returning(),
      "recoverable attachment",
    );

    const organisationId = f.workspace.organisationId;
    if (!organisationId) throw new Error("missing workspace organisationId");

    // Existing ready attachment uses PNG.byteLength bytes; cap at PNG.byteLength + PNG.byteLength - 1
    // so restoring recoverable (PNG.byteLength) exceeds the limit by 1 byte.
    await db
      .insert(schema.organisationQuotaTable)
      .values({
        organisationId,
        maxStorageBytes: PNG.byteLength * 2 - 1,
      })
      .onConflictDoUpdate({
        target: schema.organisationQuotaTable.organisationId,
        set: { maxStorageBytes: PNG.byteLength * 2 - 1 },
      });

    const denied = await app.request(
      `/api/attachments/${recoverable.id}/restore`,
      { method: "POST" },
    );
    expect(denied.status).toBe(429);
    expect(await denied.text()).toContain("storage limit");

    const stillDeleted = await db.query.attachmentTable.findFirst({
      where: eq(schema.attachmentTable.id, recoverable.id),
    });
    expect(stillDeleted?.state).toBe("deleted");
    expect(stillDeleted?.deletedAt).not.toBeNull();

    // Raise limit to exact fit (existing + recoverable); excludeAttachmentId ensures no self-double-count.
    await db
      .update(schema.organisationQuotaTable)
      .set({ maxStorageBytes: PNG.byteLength * 2 })
      .where(eq(schema.organisationQuotaTable.organisationId, organisationId));

    const allowed = await app.request(
      `/api/attachments/${recoverable.id}/restore`,
      { method: "POST" },
    );
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({
      id: recoverable.id,
      state: "ready",
      deletedAt: null,
    });
  });

  it("records attachment_limit_reached, cleans up the uploaded object, and succeeds once below quota during import", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const organisationId = f.workspace.organisationId;
    if (!organisationId) throw new Error("missing workspace organisationId");

    await db
      .insert(schema.organisationQuotaTable)
      .values({
        organisationId,
        maxStorageBytes: PNG.byteLength - 1,
      })
      .onConflictDoUpdate({
        target: schema.organisationQuotaTable.organisationId,
        set: { maxStorageBytes: PNG.byteLength - 1 },
      });

    const download = vi.fn(async () => ({
      ok: true as const,
      bytes: PNG,
      contentType: "image/png",
    }));
    setImportAttachmentDependencies({ download });

    const run = await createRun(app, f, "p11-import-quota");
    const { commit } = await commitChunk(app, f, run.id, "c-over-quota", [
      record(f, "OVER-1", {
        attachments: [
          {
            sourceId: "att-over",
            url: "https://files.source.example.test/over.png",
            filename: "over.png",
            mimeType: "image/png",
          },
        ],
      }),
    ]);

    const overTargetId = commit.rows[0]?.targetId as string;
    expect(overTargetId).toBeTruthy();

    const attachmentsAfterDenial = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.workItemId, overTargetId));
    expect(attachmentsAfterDenial).toHaveLength(0);

    // Uploaded storage object must be cleaned up when quota fails inside insertAttachment.
    expect(await listFilesRecursively(root)).toHaveLength(0);

    // Provenance must also have rolled back with the transaction.
    const provenanceAfterDenial = await db
      .select()
      .from(schema.importProvenanceTable)
      .where(
        sql`${schema.importProvenanceTable.entityType} = 'attachment' AND ${schema.importProvenanceTable.system} = 'p11-import-quota'`,
      );
    expect(provenanceAfterDenial).toHaveLength(0);

    const reportAfterDenial = await getReport(app, f, run.id);
    expect(reportAfterDenial.chunks[0]?.lossCounts).toEqual({
      attachment_limit_reached: 1,
    });

    // Raise quota to fit PNG.byteLength and import a second item -> attachment succeeds cleanly.
    await db
      .update(schema.organisationQuotaTable)
      .set({ maxStorageBytes: PNG.byteLength })
      .where(eq(schema.organisationQuotaTable.organisationId, organisationId));

    const { commit: secondCommit } = await commitChunk(
      app,
      f,
      run.id,
      "c-under-quota",
      [
        record(f, "UNDER-1", {
          attachments: [
            {
              sourceId: "att-under",
              url: "https://files.source.example.test/under.png",
              filename: "under.png",
              mimeType: "image/png",
            },
          ],
        }),
      ],
    );

    const underTargetId = secondCommit.rows[0]?.targetId as string;
    const [saved] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.workItemId, underTargetId));
    expect(saved).toMatchObject({
      state: "ready",
      filename: "under.png",
      size: PNG.byteLength,
    });
    expect(await listFilesRecursively(root)).toHaveLength(1);
  });
});
