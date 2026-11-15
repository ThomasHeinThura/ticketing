import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { DEFAULT_MAX_IMAGE_UPLOAD_BYTES } from "../../apps/api/src/storage/shared";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";

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

describe("P-23: task image upload quota accounting and HEAD size verification", () => {
  let root: string;
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: isolated filesystem root for test.
  const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: isolated storage driver for test.
  const originalDriver = process.env.TASKDESK_STORAGE_DRIVER;

  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(path.join(tmpdir(), "p23-task-image-"));
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: isolated storage driver for test.
    delete process.env.TASKDESK_STORAGE_DRIVER;
  });

  afterEach(async () => {
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

  async function setupTaskFixture() {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantWorkItemProjectAccess(member.user.id, project.id);

    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          userId: member.user.id,
          title: "P-23 task",
          status: "to-do",
          columnId: columns.todo.id,
          priority: "medium",
          number: 1,
          position: 1,
        })
        .returning(),
      "task",
    );

    const organisationId = member.workspace.organisationId;
    if (!organisationId) throw new Error("missing workspace organisationId");

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    return { member, project, task, organisationId, app };
  }

  async function stageFile(key: string, byteLength: number) {
    const filePath = path.join(root, key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, Buffer.alloc(byteLength, 0x5a));
    return filePath;
  }

  it("counts live attachmentTable + live assetTable rows (ignoring detached assets) when enforcing org quota at presign", async () => {
    const { member, project, task, organisationId, app } =
      await setupTaskFixture();

    await db
      .insert(schema.organisationQuotaTable)
      .values({ organisationId, maxStorageBytes: 1_000 })
      .onConflictDoUpdate({
        target: schema.organisationQuotaTable.organisationId,
        set: { maxStorageBytes: 1_000 },
      });

    // Seed 400 bytes in attachmentTable + 500 bytes in live assetTable + 500 bytes in detached assetTable.
    // Live usage = 900 bytes; remaining quota = 100 bytes.
    const workItemType = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId: member.workspace.id,
          key: `type-${randomUUID()}`,
          name: "Task",
          category: "delivery",
        })
        .returning(),
      "work item type",
    );
    const stateTemplate = requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: member.workspace.id,
          key: `st-${randomUUID()}`,
          name: "Todo",
          group: "backlog",
        })
        .returning(),
      "state template",
    );
    const state = requireRow(
      await db
        .insert(schema.stateTable)
        .values({
          projectId: project.id,
          stateTemplateId: stateTemplate.id,
          isDefault: true,
        })
        .returning(),
      "state",
    );
    const workItem = requireRow(
      await db
        .insert(schema.workItemTable)
        .values({
          workspaceId: member.workspace.id,
          projectId: project.id,
          typeId: workItemType.id,
          stateId: state.id,
          key: `P23-${randomUUID().slice(0, 8).toUpperCase()}`,
          number: 1,
          title: "Attachment holder",
        })
        .returning(),
      "work item",
    );

    await db.insert(schema.attachmentTable).values({
      workspaceId: member.workspace.id,
      workItemId: workItem.id,
      objectKey: `att/${randomUUID()}.png`,
      filename: "att.png",
      mimeType: "image/png",
      size: 400,
      state: "ready",
    });

    await db.insert(schema.assetTable).values([
      {
        workspaceId: member.workspace.id,
        projectId: project.id,
        taskId: task.id,
        objectKey: `asset-live/${randomUUID()}.png`,
        filename: "live.png",
        mimeType: "image/png",
        size: 500,
        kind: "image",
        surface: "description",
        detachedAt: null,
      },
      {
        workspaceId: member.workspace.id,
        projectId: project.id,
        taskId: task.id,
        objectKey: `asset-detached/${randomUUID()}.png`,
        filename: "detached.png",
        mimeType: "image/png",
        size: 500,
        kind: "image",
        surface: "description",
        detachedAt: new Date(),
      },
    ]);

    const overQuota = await app.request(`/api/task/image-upload/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "too-much.png",
        contentType: "image/png",
        size: 101,
        surface: "description",
      }),
    });
    expect(overQuota.status).toBe(429);

    const exactFit = await app.request(`/api/task/image-upload/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "fits.png",
        contentType: "image/png",
        size: 100,
        surface: "description",
      }),
    });
    expect(exactFit.status).toBe(200);
  });

  it("verifies HEAD size on finalize, rejects missing/oversize objects, enforces quota with cleanup, and preserves existing assets", async () => {
    const { member, project, task, organisationId, app } =
      await setupTaskFixture();

    const basePrefix = `workspace/${member.workspace.id}/project/${project.id}/task/${task.id}/descriptions`;

    // 1. Missing object in storage -> 400.
    const missingRes = await app.request(
      `/api/task/image-upload/${task.id}/finalize`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: `${basePrefix}/missing.png`,
          filename: "missing.png",
          contentType: "image/png",
          size: 128,
          surface: "description",
        }),
      },
    );
    expect(missingRes.status).toBe(400);

    // 2. Client declares size=100, actual stored file on disk is 777 bytes -> persists storedSize=777.
    const realKey = `${basePrefix}/real-777.png`;
    const realFilePath = await stageFile(realKey, 777);
    const finalizeReal = await app.request(
      `/api/task/image-upload/${task.id}/finalize`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: realKey,
          filename: "real-777.png",
          contentType: "image/png",
          size: 100,
          surface: "description",
        }),
      },
    );
    expect(finalizeReal.status).toBe(200);
    const { id: realAssetId } = (await finalizeReal.json()) as { id: string };
    const savedAsset = await db.query.assetTable.findFirst({
      where: eq(schema.assetTable.id, realAssetId),
    });
    expect(savedAsset?.size).toBe(777);

    // 3. Oversize stored object (> DEFAULT_MAX_IMAGE_UPLOAD_BYTES) -> 400 and deletes newly uploaded object.
    const oversizeKey = `${basePrefix}/oversize.png`;
    await stageFile(oversizeKey, DEFAULT_MAX_IMAGE_UPLOAD_BYTES + 16);
    const oversizeRes = await app.request(
      `/api/task/image-upload/${task.id}/finalize`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: oversizeKey,
          filename: "oversize.png",
          contentType: "image/png",
          size: 100,
          surface: "description",
        }),
      },
    );
    expect(oversizeRes.status).toBe(400);
    await expect(stat(path.join(root, oversizeKey))).rejects.toThrow();

    // 4. Quota exceeded on finalize for a newly uploaded object -> 429 and deletes newly uploaded object.
    await db
      .insert(schema.organisationQuotaTable)
      .values({ organisationId, maxStorageBytes: 777 })
      .onConflictDoUpdate({
        target: schema.organisationQuotaTable.organisationId,
        set: { maxStorageBytes: 777 },
      });

    const overQuotaKey = `${basePrefix}/over-quota.png`;
    await stageFile(overQuotaKey, 50);
    const overQuotaRes = await app.request(
      `/api/task/image-upload/${task.id}/finalize`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: overQuotaKey,
          filename: "over-quota.png",
          contentType: "image/png",
          size: 50,
          surface: "description",
        }),
      },
    );
    expect(overQuotaRes.status).toBe(429);
    await expect(stat(path.join(root, overQuotaKey))).rejects.toThrow();

    // 5. Re-finalizing existing 777-byte asset at maxStorageBytes=777 succeeds (excludeAssetId prevents self-counting).
    const refinalizeOk = await app.request(
      `/api/task/image-upload/${task.id}/finalize`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: realKey,
          filename: "real-777.png",
          contentType: "image/png",
          size: 777,
          surface: "description",
        }),
      },
    );
    expect(refinalizeOk.status).toBe(200);

    // Lowering quota below 777 rejects re-finalize with 429 WITHOUT deleting the existing asset's file!
    await db
      .update(schema.organisationQuotaTable)
      .set({ maxStorageBytes: 100 })
      .where(eq(schema.organisationQuotaTable.organisationId, organisationId));
    const refinalizeOver = await app.request(
      `/api/task/image-upload/${task.id}/finalize`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: realKey,
          filename: "real-777.png",
          contentType: "image/png",
          size: 777,
          surface: "description",
        }),
      },
    );
    expect(refinalizeOver.status).toBe(429);
    expect((await stat(realFilePath)).size).toBe(777);
    expect(await listFilesRecursively(root)).toEqual([realFilePath]);
  });
});
