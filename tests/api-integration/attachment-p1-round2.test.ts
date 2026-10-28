/**
 * P1 round-2 review fixes for work-item attachments on the real filesystem driver:
 *  - P1R2-3: non-Latin file names download (RFC 5987 `filename*`), the storage key never
 *    carries the display name;
 *  - P1R2-5: the per-organisation storage limit is enforced at presign and at complete (429);
 *  - P1R2-6: the vacated pending key is queued for `attachment-gc` after the credential expires;
 *  - P1R2-13: staff cannot complete another person's pending upload.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { collectQueuedAttachmentObjects } from "../../apps/api/src/scheduler/attachment-cleanup";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";
import { ensureCreationWorkflow } from "./helpers/workflow";

const PDF_BYTES = Buffer.from("%PDF-1.4\n%P1R2 fixture\n%%EOF\n");
type App = ReturnType<typeof createApp>["app"];

async function addPersonForUser(userId: string) {
  const [existing] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .limit(1);
  if (existing) return existing;
  const organisation = await ensureInternalOrganisation();
  return requireRow(
    await db
      .insert(schema.personTable)
      .values({
        userId,
        organisationId: organisation.id,
        side: "staff",
        active: true,
      })
      .returning(),
    "person",
  );
}

async function setupProject() {
  const { user: creator, workspace } = await createWorkspaceMember({
    role: "admin",
  });
  const { project } = await createProjectFixture({ workspaceId: workspace.id });
  await grantWorkItemProjectAccess(creator.id, project.id);
  const now = new Date();
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: workspace.id,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "type",
  );
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: workspace.id,
        key: `state-${randomUUID()}`,
        name: "Backlog",
        group: "backlog",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "state template",
  );
  await db.insert(schema.stateTable).values({
    projectId: project.id,
    stateTemplateId: template.id,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  });
  await ensureCreationWorkflow({
    workspaceId: workspace.id,
    projectId: project.id,
    typeId: type.id,
  });
  return { creator, workspace, project, type };
}

async function createWorkItem(app: App, projectId: string, typeId: string) {
  const created = await app.request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ typeId, title: "Attach me" }),
  });
  expect(created.status).toBe(200);
  return (await created.json()) as { key: string; id: string };
}

async function presign(
  app: App,
  key: string,
  filename: string,
  size = PDF_BYTES.length,
) {
  return app.request(`/api/work-items/${key}/attachments/presign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename, contentType: "application/pdf", size }),
  });
}

async function upload(app: App, key: string, filename: string) {
  const response = await presign(app, key, filename);
  expect(response.status, await response.clone().text()).toBe(200);
  const presigned = (await response.json()) as {
    attachmentId: string;
    uploadUrl: string;
    uploadHeaders: Record<string, string>;
  };
  const put = await app.request(presigned.uploadUrl, {
    method: "PUT",
    headers: presigned.uploadHeaders,
    body: PDF_BYTES,
  });
  expect(put.status).toBe(204);
  return presigned;
}

async function setOrganisationQuota(workspaceId: string, maxBytes: number) {
  const [workspace] = await db
    .select({ organisationId: schema.workspaceTable.organisationId })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, workspaceId));
  const organisationId = workspace?.organisationId as string;
  await db
    .insert(schema.organisationQuotaTable)
    .values({ organisationId, maxStorageBytes: maxBytes })
    .onConflictDoUpdate({
      target: schema.organisationQuotaTable.organisationId,
      set: { maxStorageBytes: maxBytes },
    });
}

describe("P1 round-2 attachment fixes (filesystem driver)", () => {
  let root: string;
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: the test configures storage for itself.
  const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: the test configures storage for itself.
  const originalDriver = process.env.TASKDESK_STORAGE_DRIVER;

  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-p1r2-"));
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: the test configures storage for itself.
    delete process.env.TASKDESK_STORAGE_DRIVER;
  });

  afterEach(async () => {
    if (originalRoot === undefined)
      // biome-ignore lint/suspicious/noUndeclaredEnvVars: the test configures storage for itself.
      delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    else process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = originalRoot;
    if (originalDriver === undefined)
      // biome-ignore lint/suspicious/noUndeclaredEnvVars: the test configures storage for itself.
      delete process.env.TASKDESK_STORAGE_DRIVER;
    else process.env.TASKDESK_STORAGE_DRIVER = originalDriver;
    await rm(root, { recursive: true, force: true });
  });

  it("P1R2-3: downloads Myanmar-script and CJK file names with an RFC 5987 filename* and audits each download", async () => {
    const { creator, project, type } = await setupProject();
    await addPersonForUser(creator.id);
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    for (const filename of ["အစီရင်ခံစာ.pdf", "報告.pdf"]) {
      const presigned = await upload(app, key, filename);
      const complete = await app.request(
        `/api/attachments/${presigned.attachmentId}/complete`,
        { method: "POST" },
      );
      expect(complete.status, await complete.clone().text()).toBe(200);

      const [row] = await db
        .select()
        .from(schema.attachmentTable)
        .where(eq(schema.attachmentTable.id, presigned.attachmentId));
      expect(row?.filename).toBe(filename);
      // The storage key is independent of the display name: ASCII only.
      expect(row?.objectKey).toMatch(/^[\x21-\x7e]+$/u);
      expect(row?.objectKey).not.toContain(filename.replace(/\.pdf$/u, ""));

      const redirect = await app.request(
        `/api/attachments/${presigned.attachmentId}`,
        { redirect: "manual" },
      );
      expect(redirect.status).toBe(302);
      const location = redirect.headers.get("location") as string;
      const download = await app.request(location);
      expect(download.status, await download.clone().text()).toBe(200);
      const disposition = download.headers.get("content-disposition");
      expect(disposition).toContain(
        `filename*=UTF-8''${encodeURIComponent(filename)}`,
      );
      expect(disposition).toMatch(/^attachment; filename="[\x20-\x7e]+";/u);
      expect(Buffer.from(await download.arrayBuffer())).toEqual(PDF_BYTES);

      const audits = await db
        .select()
        .from(schema.auditLogTable)
        .where(
          and(
            eq(schema.auditLogTable.entityId, presigned.attachmentId),
            eq(schema.auditLogTable.action, "attachment.downloaded"),
          ),
        );
      expect(audits).toHaveLength(1);
    }
  });

  it("P1R2-3: a forged download link is refused on the bearer route, which never writes an audit row", async () => {
    const { creator, project, type } = await setupProject();
    await addPersonForUser(creator.id);
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);
    const presigned = await upload(app, key, "報告.pdf");
    await app.request(`/api/attachments/${presigned.attachmentId}/complete`, {
      method: "POST",
    });
    const redirect = await app.request(
      `/api/attachments/${presigned.attachmentId}`,
      { redirect: "manual" },
    );
    const location = new URL(redirect.headers.get("location") as string);
    location.searchParams.set("token", "forged");
    const forged = await app.request(location.toString());
    expect(forged.status).toBe(400);
    const audits = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, presigned.attachmentId));
    expect(
      audits.filter((row) => row.action === "attachment.downloaded"),
    ).toHaveLength(1);
  });

  it("P1R2-5: refuses presign and complete beyond the organisation storage limit with 429", async () => {
    const { creator, workspace, project, type } = await setupProject();
    await addPersonForUser(creator.id);
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key, id: workItemId } = await createWorkItem(
      app,
      project.id,
      type.id,
    );
    // Existing usage: one ready 90-byte file of the same organisation.
    await db.insert(schema.attachmentTable).values({
      workspaceId: workspace.id,
      workItemId,
      objectKey: `workspace/${workspace.id}/existing/${randomUUID()}.pdf`,
      filename: "existing.pdf",
      mimeType: "application/pdf",
      size: 90,
      state: "ready",
    });

    await setOrganisationQuota(workspace.id, 100);
    const refused = await presign(app, key, "too-big.pdf", 20);
    expect(refused.status).toBe(429);
    expect(await refused.text()).toContain("storage limit");

    // Fits at presign; the limit is lowered before complete, so the real size no longer fits.
    await setOrganisationQuota(workspace.id, 1000);
    const presigned = await upload(app, key, "late.pdf");
    await setOrganisationQuota(workspace.id, 95);
    const complete = await app.request(
      `/api/attachments/${presigned.attachmentId}/complete`,
      { method: "POST" },
    );
    expect(complete.status).toBe(429);
    const rows = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));
    expect(rows).toHaveLength(0);

    // Deleted files free their bytes.
    await db
      .update(schema.attachmentTable)
      .set({ state: "deleted", deletedAt: new Date() })
      .where(eq(schema.attachmentTable.filename, "existing.pdf"));
    const fits = await presign(app, key, "fits.pdf", 20);
    expect(fits.status).toBe(200);
  });

  it("P1R2-6: queues the vacated pending key until the upload credential expired, then removes a replayed object", async () => {
    const { creator, project, type } = await setupProject();
    await addPersonForUser(creator.id);
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);
    const presigned = await upload(app, key, "replay.pdf");
    const [pending] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));
    const pendingKey = pending?.objectKey as string;
    const complete = await app.request(
      `/api/attachments/${presigned.attachmentId}/complete`,
      { method: "POST" },
    );
    expect(complete.status).toBe(200);

    const queued = await db.execute<{ due: boolean }>(sql`
      SELECT "queued_at" > now() + interval '5 minutes' AS due
        FROM "attachment_object_gc" WHERE "object_key" = ${pendingKey}
    `);
    expect(queued.rows).toHaveLength(1);
    expect(queued.rows[0]?.due).toBe(true);

    // A replay of the credential after complete re-creates the pending object.
    const replay = await app.request(presigned.uploadUrl, {
      method: "PUT",
      headers: presigned.uploadHeaders,
      body: PDF_BYTES,
    });
    expect(replay.status).toBe(204);
    await expect(stat(path.join(root, pendingKey))).resolves.toBeTruthy();

    // Not yet due: the collector leaves it.
    await collectQueuedAttachmentObjects();
    await expect(stat(path.join(root, pendingKey))).resolves.toBeTruthy();

    await db.execute(
      sql`UPDATE "attachment_object_gc" SET "queued_at" = now() - interval '1 second' WHERE "object_key" = ${pendingKey}`,
    );
    const outcome = await collectQueuedAttachmentObjects();
    expect(outcome.deleted).toBe(1);
    await expect(stat(path.join(root, pendingKey))).rejects.toThrow();

    // The served object is untouched.
    const [ready] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));
    expect(ready?.state).toBe("ready");
    await expect(
      stat(path.join(root, ready?.objectKey as string)),
    ).resolves.toBeTruthy();
  });

  it("P1R2-13: another staff member cannot complete someone else's pending upload", async () => {
    const { creator, workspace, project, type } = await setupProject();
    await addPersonForUser(creator.id);
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);
    const presigned = await upload(app, key, "mine.pdf");

    const colleague = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: `user-${randomUUID()}`,
          email: `colleague-${randomUUID()}@example.com`,
          emailVerified: true,
          name: "Colleague",
        })
        .returning(),
      "colleague",
    );
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: workspace.id,
      userId: colleague.id,
      role: "admin",
      joinedAt: new Date(),
    });
    await addPersonForUser(colleague.id);
    await grantWorkItemProjectAccess(colleague.id, project.id);
    mockAuthenticatedSession(colleague);
    const stolen = await createApp().app.request(
      `/api/attachments/${presigned.attachmentId}/complete`,
      { method: "POST" },
    );
    expect(stolen.status).toBe(404);

    mockAuthenticatedSession(creator);
    const own = await createApp().app.request(
      `/api/attachments/${presigned.attachmentId}/complete`,
      { method: "POST" },
    );
    expect(own.status).toBe(200);
  });
});
