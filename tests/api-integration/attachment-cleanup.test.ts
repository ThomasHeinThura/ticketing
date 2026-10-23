import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeAttachment } from "../../apps/api/src/attachment/controllers/complete-attachment";
import db, { schema } from "../../apps/api/src/database";
import { resolveRequestIdentity } from "../../apps/api/src/permissions/resolve-request-identity";
import {
  cleanAttachment,
  cleanupPendingAttachments,
  collectDeletedAttachments,
} from "../../apps/api/src/scheduler/attachment-cleanup";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000);
let root: string;
async function fixture() {
  const owner = await createWorkspaceMember({ role: "admin" });
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  await grantWorkItemProjectAccess(owner.user.id, project.id);
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: owner.workspace.id,
        key: randomUUID(),
        name: "Task",
        category: "delivery",
      })
      .returning(),
    "type",
  );
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: owner.workspace.id,
        key: randomUUID(),
        name: "Open",
        group: "started",
      })
      .returning(),
    "template",
  );
  const state = requireRow(
    await db
      .insert(schema.stateTable)
      .values({ projectId: project.id, stateTemplateId: template.id })
      .returning(),
    "state",
  );
  const item = requireRow(
    await db
      .insert(schema.workItemTable)
      .values({
        workspaceId: owner.workspace.id,
        projectId: project.id,
        typeId: type.id,
        stateId: state.id,
        number: 1,
        key: `${project.slug}-1`,
        title: "Attachment lifecycle",
      })
      .returning(),
    "item",
  );
  const identity = await resolveRequestIdentity({ userId: owner.user.id });
  if (!identity) throw new Error("Identity missing");
  return { owner, project, item, identity, type };
}
async function attachment(
  f: Awaited<ReturnType<typeof fixture>>,
  options: Partial<typeof schema.attachmentTable.$inferInsert> = {},
) {
  const row = requireRow(
    await db
      .insert(schema.attachmentTable)
      .values({
        workspaceId: f.owner.workspace.id,
        organisationId: f.owner.workspace.organisationId,
        workItemId: f.item.id,
        objectKey: `private/${randomUUID()}/image.png`,
        filename: "image.png",
        mimeType: "image/png",
        size: PNG.length,
        state: "pending",
        createdAt: ago(2),
        uploadedBy: f.identity.personId,
        ...options,
      })
      .returning(),
    "attachment",
  );
  await mkdir(path.dirname(path.join(root, row.objectKey)), {
    recursive: true,
  });
  await writeFile(path.join(root, row.objectKey), PNG);
  return row;
}
async function waitForLocks(raw: Client, count = 1) {
  for (let attempt = 0; attempt < 200; attempt++) {
    await raw.query("SELECT pg_stat_clear_snapshot()");
    const result = await raw.query(
      "SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'",
    );
    if (result.rows[0].n >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Worker did not reach the expected PostgreSQL lock wait");
}
async function rawClient() {
  const client = new Client({
    connectionString: process.env.TASKDESK_DATABASE_URL,
  });
  await client.connect();
  return client;
}

describe("canonical attachment lifecycle workers with real filesystem objects", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-attachment-worker-"));
    vi.stubEnv("TASKDESK_STORAGE_FILESYSTEM_ROOT", root);
    vi.stubEnv("TASKDESK_STORAGE_DRIVER", "filesystem");
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });
  it("removes only expired pending uploads and preserves recent/ready files", async () => {
    const f = await fixture();
    const expired = await attachment(f);
    const recent = await attachment(f, { createdAt: new Date() });
    const ready = await attachment(f, { state: "ready" });
    expect(await cleanupPendingAttachments()).toMatchObject({
      scanned: 1,
      deleted: 1,
      degraded: false,
    });
    await expect(
      readFile(path.join(root, expired.objectKey)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(root, recent.objectKey))).toEqual(PNG);
    expect(await readFile(path.join(root, ready.objectKey))).toEqual(PNG);
    expect(await cleanAttachment(expired.id, "pending")).toBe(false);
  });
  it("GC preserves a full recovery day and physically deletes only old tombstones", async () => {
    const f = await fixture();
    const old = await attachment(f, { state: "deleted", deletedAt: ago(25) });
    const recent = await attachment(f, { state: "deleted", deletedAt: ago(2) });
    const ready = await attachment(f, { state: "ready" });
    expect(await collectDeletedAttachments()).toMatchObject({
      deleted: 1,
      degraded: false,
    });
    await expect(
      readFile(path.join(root, old.objectKey)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(root, recent.objectKey))).toEqual(PNG);
    expect(await readFile(path.join(root, ready.objectKey))).toEqual(PNG);
  });
  it("retains held scopes; lift resumes cleanup and unrelated tenant is unaffected", async () => {
    const f = await fixture();
    const other = await fixture();
    const held = await attachment(f, { state: "deleted", deletedAt: ago(25) });
    const control = await attachment(other, {
      state: "deleted",
      deletedAt: ago(25),
      organisationId: null,
      uploadedBy: null,
    });
    const hold = requireRow(
      await db
        .insert(schema.legalHoldTable)
        .values({
          scope: "person",
          scopeId: f.identity.personId,
          placedBy: f.owner.user.id,
          reason: "Synthetic retention test",
        })
        .returning(),
      "hold",
    );
    expect(await cleanAttachment(held.id, "deleted")).toBe(false);
    expect(await cleanAttachment(control.id, "deleted")).toBe(true);
    expect(await readFile(path.join(root, held.objectKey))).toEqual(PNG);
    await db
      .update(schema.legalHoldTable)
      .set({ liftedAt: new Date(), liftedBy: f.owner.user.id })
      .where(eq(schema.legalHoldTable.id, hold.id));
    expect(await cleanAttachment(held.id, "deleted")).toBe(true);
  });
  it("retains metadata and retries real storage failures without losing the locator", async () => {
    const f = await fixture();
    const row = await attachment(f);
    const target = path.join(root, row.objectKey);
    await rm(target);
    await mkdir(target);
    expect(await cleanupPendingAttachments()).toMatchObject({
      deleted: 0,
      retained: 1,
      degraded: true,
    });
    expect(
      await db
        .select()
        .from(schema.attachmentTable)
        .where(eq(schema.attachmentTable.id, row.id)),
    ).toHaveLength(1);
    await rm(target, { recursive: true });
    await writeFile(target, PNG);
    expect(await cleanupPendingAttachments()).toMatchObject({
      deleted: 1,
      degraded: false,
    });
  });
  it("retries an already-deleted object after metadata transaction failure", async () => {
    const f = await fixture();
    const row = await attachment(f);
    await db.execute(
      sql`CREATE FUNCTION attachment_cleanup_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic delete failure'; END $$`,
    );
    await db.execute(
      sql`CREATE TRIGGER attachment_cleanup_probe BEFORE DELETE ON attachment FOR EACH ROW EXECUTE FUNCTION attachment_cleanup_probe()`,
    );
    try {
      await expect(cleanAttachment(row.id, "pending")).rejects.toThrow();
      expect(
        await db
          .select()
          .from(schema.attachmentTable)
          .where(eq(schema.attachmentTable.id, row.id)),
      ).toHaveLength(1);
      await expect(
        readFile(path.join(root, row.objectKey)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await db.execute(
        sql`DROP TRIGGER attachment_cleanup_probe ON attachment`,
      );
      await db.execute(sql`DROP FUNCTION attachment_cleanup_probe()`);
    }
    expect(await cleanAttachment(row.id, "pending")).toBe(true);
  });
  it("never deletes shared-key objects and concurrent duplicate workers are idempotent", async () => {
    const f = await fixture();
    const shared = await attachment(f, {
      state: "deleted",
      deletedAt: ago(25),
    });
    await attachment(f, { state: "ready", objectKey: shared.objectKey });
    expect(await cleanAttachment(shared.id, "deleted")).toBe(false);
    expect(await readFile(path.join(root, shared.objectKey))).toEqual(PNG);
    const ordinary = await attachment(f);
    expect(
      (
        await Promise.all([
          cleanAttachment(ordinary.id, "pending"),
          cleanAttachment(ordinary.id, "pending"),
        ])
      ).sort(),
    ).toEqual([false, true]);
  });
  it("cleans expired comment and submission attachments using their real parent paths", async () => {
    const f = await fixture();
    const comment = requireRow(
      await db
        .insert(schema.commentTable)
        .values({
          workspaceId: f.owner.workspace.id,
          workItemId: f.item.id,
          authorId: f.owner.user.id,
          actorType: "person",
          body: { type: "doc", content: [] },
        })
        .returning(),
      "comment",
    );
    const onComment = await attachment(f, {
      workItemId: null,
      commentId: comment.id,
    });
    const requestType = requireRow(
      await db
        .insert(schema.requestTypeTable)
        .values({
          workspaceId: f.owner.workspace.id,
          key: randomUUID(),
          name: "Request",
          group: "Support",
          workItemTypeId: f.type.id,
          formSchema: { fields: [] },
        })
        .returning(),
      "request type",
    );
    const version = requireRow(
      await db
        .insert(schema.requestTypeVersionTable)
        .values({
          workspaceId: f.owner.workspace.id,
          requestTypeId: requestType.id,
          number: 1,
          formSchema: { fields: [] },
          workItemTypeId: f.type.id,
        })
        .returning(),
      "request version",
    );
    const submission = requireRow(
      await db
        .insert(schema.submissionTable)
        .values({
          organisationId: f.owner.workspace.organisationId,
          requesterId: f.identity.personId,
          requestTypeId: requestType.id,
          requestTypeVersionId: version.id,
          formData: {},
          state: "new",
          submittedAt: new Date(),
        })
        .returning(),
      "submission",
    );
    const onSubmission = await attachment(f, {
      workItemId: null,
      submissionId: submission.id,
    });
    expect(await cleanAttachment(onComment.id, "pending")).toBe(true);
    expect(await cleanAttachment(onSubmission.id, "pending")).toBe(true);
    await expect(
      readFile(path.join(root, onComment.objectKey)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(path.join(root, onSubmission.objectKey)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("bounds each run and rotates past held rows so later eligible objects are collected", async () => {
    const f = await fixture();
    for (let index = 0; index < 100; index++) {
      await attachment(f, {
        id: `aa-held-${String(index).padStart(3, "0")}`,
        state: "deleted",
        deletedAt: ago(25),
      });
    }
    const control = await attachment(f, {
      id: "zz-cleanup-control",
      state: "deleted",
      deletedAt: ago(25),
      organisationId: null,
      uploadedBy: null,
    });
    await db.insert(schema.legalHoldTable).values({
      scope: "person",
      scopeId: f.identity.personId,
      placedBy: f.owner.user.id,
      reason: "Synthetic bounded-run hold",
    });
    const first = await collectDeletedAttachments();
    expect(first.scanned).toBeLessThanOrEqual(100);
    const second = await collectDeletedAttachments();
    expect(second.scanned).toBeLessThanOrEqual(100);
    expect(first.deleted + second.deleted).toBe(1);
    await expect(
      readFile(path.join(root, control.objectKey)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await db.select().from(schema.attachmentTable)).toHaveLength(100);
  });
  it("does no work while another replica owns the live lease", async () => {
    const f = await fixture();
    const row = await attachment(f);
    await db.insert(schema.jobLeaseTable).values({
      name: "attachment-pending-cleanup",
      owner: "another-replica",
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await cleanupPendingAttachments()).toEqual({
      scanned: 0,
      deleted: 0,
      retained: 0,
      degraded: false,
    });
    expect(await readFile(path.join(root, row.objectKey))).toEqual(PNG);
  });
  it("waits for uncommitted organisation hold insertion and rechecks before deleting bytes", async () => {
    const f = await fixture();
    const row = await attachment(f);
    const raw = await rawClient();
    await raw.query("BEGIN");
    await raw.query(
      "INSERT INTO legal_hold(id,scope,scope_id,placed_by,reason) VALUES($1,'organisation',$2,$3,'Synthetic hold race')",
      [randomUUID(), row.organisationId, f.owner.user.id],
    );
    const started = Date.now();
    const cleanup = cleanAttachment(row.id, "pending");
    try {
      await waitForLocks(raw);
      await raw.query("COMMIT");
      expect(await cleanup).toBe(false);
      expect(await readFile(path.join(root, row.objectKey))).toEqual(PNG);
      process.stderr.write(
        `${JSON.stringify({ test: "attachment hold fence", observedMs: Date.now() - started })}\n`,
      );
    } finally {
      await raw.query("ROLLBACK");
      await cleanup;
      await raw.end();
    }
  });
  it("serializes actual completion with expiry cleanup and preserves the ready object's bytes", async () => {
    const f = await fixture();
    const row = await attachment(f);
    const raw = await rawClient();
    await raw.query("BEGIN");
    await raw.query("SELECT id FROM attachment WHERE id=$1 FOR UPDATE", [
      row.id,
    ]);
    const completion = completeAttachment({
      attachmentId: row.id,
      workspaceId: row.workspaceId,
      workItemId: f.item.id,
      actorId: f.owner.user.id,
      actorType: "person",
      identity: f.identity,
    });
    let cleanup: Promise<boolean> | undefined;
    try {
      await waitForLocks(raw);
      cleanup = cleanAttachment(row.id, "pending");
      await waitForLocks(raw, 2);
      await raw.query("COMMIT");
      const ready = await completion;
      expect(await cleanup).toBe(false);
      expect(ready.state).toBe("ready");
      expect(await readFile(path.join(root, ready.objectKey))).toEqual(PNG);
    } finally {
      await raw.query("ROLLBACK");
      await Promise.allSettled([completion, ...(cleanup ? [cleanup] : [])]);
      await raw.end();
    }
  });
});
