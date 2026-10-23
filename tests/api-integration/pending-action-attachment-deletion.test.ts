import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { cleanAttachment } from "../../apps/api/src/scheduler/attachment-cleanup";

const BYTES = Buffer.from("%PDF-1.7 exact attachment bytes");
let root: string;

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  ATTACHMENT_DELETION_ROUTE,
  approveAttachmentDeletion,
} from "../../apps/api/src/pending-action/attachment-deletion-target";
import {
  createPendingAction,
  decideOwnPendingAction,
  getOwnPendingAction,
} from "../../apps/api/src/pending-action/service";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";

async function fixture(role: "member" | "admin" = "member") {
  const member = await createWorkspaceMember({ role });
  const sourceProject = (
    await createProjectFixture({ workspaceId: member.workspace.id })
  ).project;
  const targetProject = (
    await createProjectFixture({ workspaceId: member.workspace.id })
  ).project;
  for (const project of [sourceProject, targetProject])
    await grantProjectRole(member.user.id, project.id, [
      "project:read",
      "work_item:read",
      "work_item:update",
      "attachment:delete_own",
      "attachment:delete_any",
    ]);
  const person = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, member.user.id)),
    "requester",
  );
  const session = requireRow(
    await db
      .insert(schema.sessionTable)
      .values({
        id: `session-${member.user.id}`,
        token: randomUUID(),
        userId: member.user.id,
        portal: "agent",
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning(),
    "session",
  );
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: member.workspace.id,
        key: `type-${randomUUID()}`,
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
        workspaceId: member.workspace.id,
        key: `state-${randomUUID()}`,
        name: "To Do",
        group: "unstarted",
      })
      .returning(),
    "template",
  );
  const item = async (project: typeof sourceProject) => {
    const state = requireRow(
      await db
        .insert(schema.stateTable)
        .values({
          projectId: project.id,
          stateTemplateId: template.id,
          isDefault: true,
        })
        .returning(),
      "state",
    );
    return requireRow(
      await db
        .insert(schema.workItemTable)
        .values({
          projectId: project.id,
          workspaceId: member.workspace.id,
          typeId: type.id,
          number: 1,
          key: `${project.slug}-1`,
          title: "Relation approval fixture",
          stateId: state.id,
        })
        .returning(),
      "item",
    );
  };
  const source = await item(sourceProject);
  const target = await item(targetProject);
  const relation = requireRow(
    await db
      .insert(schema.attachmentTable)
      .values({
        workspaceId: source.workspaceId,
        workItemId: source.id,
        uploadedBy: person.id,
        objectKey: `files/${randomUUID()}`,
        filename: "Evidence.pdf",
        mimeType: "application/pdf",
        size: BYTES.length,
        state: "ready",
        customerVisible: false,
      })
      .returning(),
    "attachment",
  );
  await mkdir(path.dirname(path.join(root, relation.objectKey)), {
    recursive: true,
  });
  await writeFile(path.join(root, relation.objectKey), BYTES);
  const request = {
    requesterPersonId: person.id,
    credentialType: "session" as const,
    credentialId: session.id,
    origin: "web" as const,
    action: "delete" as const,
    routeKey: ATTACHMENT_DELETION_ROUTE,
    targetType: "attachment",
    targetIds: [relation.id],
    workspaceId: member.workspace.id,
    actorId: member.user.id,
    actorType: "person" as const,
  };
  const approval = (id: string) => ({
    id,
    requesterPersonId: person.id,
    userId: member.user.id,
    sessionId: session.id,
    traceId: randomUUID(),
  });
  return {
    member,
    person,
    session,
    source,
    target,
    relation,
    request,
    approval,
  };
}
async function attachment(id: string) {
  return requireRow(
    await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, id)),
    "attachment",
  );
}
async function pending(id: string) {
  return requireRow(
    await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, id)),
    "pending action",
  );
}

describe("canonical attachment durable deletion", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-attachment-pa-"));
    vi.stubEnv("TASKDESK_STORAGE_FILESYSTEM_ROOT", root);
    vi.stubEnv("TASKDESK_STORAGE_DRIVER", "filesystem");
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });
  it("real DELETE202 preserves the named file/download until real requester approval, then tombstones without storage I/O", async () => {
    const f = await fixture();
    mockAuthenticatedSession(f.member.user);
    const { app } = createApp();
    const before = await app.request(
      `/api/work-items/${f.source.key}/attachments`,
    );
    expect(await before.json()).toEqual([
      expect.objectContaining({
        id: f.relation.id,
        canDelete: true,
        filename: "Evidence.pdf",
      }),
    ]);
    const response = await app.request(`/api/attachments/${f.relation.id}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(202);
    const action = (await response.json()) as {
      pendingActionId: string;
      summary: Record<string, unknown>;
    };
    expect(action.summary).toMatchObject({
      attachmentId: f.relation.id,
      filename: "Evidence.pdf",
      mimeType: "application/pdf",
      size: BYTES.length,
      key: f.source.key,
      recoveryHours: 24,
    });
    expect(JSON.stringify(action)).not.toContain(f.relation.objectKey);
    expect((await attachment(f.relation.id)).state).toBe("ready");
    expect(
      (await app.request(`/api/attachments/${f.relation.id}`)).status,
    ).toBe(302);
    const approved = await app.request(
      `/api/me/pending-actions/${action.pendingActionId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(approved.status).toBe(200);
    expect((await attachment(f.relation.id)).state).toBe("deleted");
    expect(
      (await app.request(`/api/attachments/${f.relation.id}`)).status,
    ).toBe(404);
    expect(await readFile(path.join(root, f.relation.objectKey))).toEqual(
      BYTES,
    );
    expect(await cleanAttachment(f.relation.id, "deleted")).toBe(false);
    expect(await readFile(path.join(root, f.relation.objectKey))).toEqual(
      BYTES,
    );
  });
  it("concurrent requester approvals produce one tombstone/activity and retain the original recovery clock on no-op", async () => {
    const f = await fixture();
    const action = await createPendingAction(f.request);
    const results = await Promise.allSettled([
      approveAttachmentDeletion(f.approval(action.pendingActionId)),
      approveAttachmentDeletion(f.approval(action.pendingActionId)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const deleted = await attachment(f.relation.id);
    expect(
      await db
        .select()
        .from(schema.activityTable)
        .where(
          and(
            eq(schema.activityTable.workItemId, f.source.id),
            eq(schema.activityTable.verb, "attachment.deleted"),
          ),
        ),
    ).toHaveLength(1);
    const next = await createPendingAction(f.request);
    await approveAttachmentDeletion(f.approval(next.pendingActionId));
    expect(await attachment(f.relation.id)).toEqual(deleted);
  });
  it.each(["filename", "locator", "completed"])(
    "a changed exact target (%s) invalidates instead of deleting",
    async (change) => {
      const f = await fixture();
      if (change === "completed")
        await db
          .update(schema.attachmentTable)
          .set({ state: "pending" })
          .where(eq(schema.attachmentTable.id, f.relation.id));
      const action = await createPendingAction(f.request);
      await db
        .update(schema.attachmentTable)
        .set(
          change === "filename"
            ? { filename: "New name.pdf" }
            : change === "locator"
              ? { objectKey: `files/${randomUUID()}` }
              : { state: "ready" },
        )
        .where(eq(schema.attachmentTable.id, f.relation.id));
      await expect(
        approveAttachmentDeletion(f.approval(action.pendingActionId)),
      ).rejects.toMatchObject({ status: 409 });
      expect((await pending(action.pendingActionId)).invalidationReason).toBe(
        "version_changed",
      );
      expect((await attachment(f.relation.id)).state).not.toBe("deleted");
      expect(await readFile(path.join(root, f.relation.objectKey))).toEqual(
        BYTES,
      );
    },
  );
  it("pending attachments also require approval and remain untouched on expiry/cancellation", async () => {
    const f = await fixture();
    await db
      .update(schema.attachmentTable)
      .set({ state: "pending" })
      .where(eq(schema.attachmentTable.id, f.relation.id));
    const action = await createPendingAction(f.request);
    expect((await attachment(f.relation.id)).state).toBe("pending");
    await decideOwnPendingAction({
      id: action.pendingActionId,
      requesterPersonId: f.person.id,
      outcome: "cancelled",
      sessionId: f.session.id,
    });
    await expect(
      approveAttachmentDeletion(f.approval(action.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    const next = await createPendingAction(f.request);
    await db
      .update(schema.pendingActionTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.pendingActionTable.id, next.pendingActionId));
    expect(
      await approveAttachmentDeletion(f.approval(next.pendingActionId)),
    ).toMatchObject({ state: "expired" });
    expect((await attachment(f.relation.id)).state).toBe("pending");
  });
  it("delete-own cannot moderate another uploader, while existing delete-any can", async () => {
    const f = await fixture();
    const other = await fixture("admin");
    await db
      .update(schema.attachmentTable)
      .set({ uploadedBy: other.person.id })
      .where(eq(schema.attachmentTable.id, f.relation.id));
    await expect(createPendingAction(f.request)).rejects.toMatchObject({
      status: 403,
    });
    mockAuthenticatedSession(f.member.user);
    const { app } = createApp();
    const list = await app.request(
      `/api/work-items/${f.source.key}/attachments`,
    );
    expect(await list.json()).toEqual([
      expect.objectContaining({ canDelete: false }),
    ]);
    // Keep the manager's scoped work-item/project authority and change only uploader ownership.
    await db
      .update(schema.attachmentTable)
      .set({ uploadedBy: f.person.id })
      .where(eq(schema.attachmentTable.id, other.relation.id));
    const action = await createPendingAction(other.request);
    await approveAttachmentDeletion(other.approval(action.pendingActionId));
    expect((await attachment(other.relation.id)).state).toBe("deleted");
  });
  it("read loss redacts filename/parent/IDs and refuses approval", async () => {
    const f = await fixture();
    const action = await createPendingAction(f.request);
    await db
      .delete(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, f.person.id),
          eq(schema.membershipTable.scopeId, f.source.projectId),
        ),
      );
    const read = await getOwnPendingAction(
      f.member.user.id,
      action.pendingActionId,
      undefined,
      { apiKeyId: null, traceId: randomUUID() },
    );
    expect(read).toMatchObject({
      summary: { redacted: true, targetCount: 1 },
      targetIds: [],
    });
    expect(JSON.stringify(read)).not.toContain("Evidence.pdf");
    expect(JSON.stringify(read)).not.toContain(f.source.key);
    await expect(
      approveAttachmentDeletion(f.approval(action.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    expect((await attachment(f.relation.id)).state).toBe("ready");
  });
  it.each(["disabled", "ceiling"])(
    "original API-key %s cannot be replaced by browser authority",
    async (change) => {
      const f = await fixture();
      const key = requireRow(
        await db
          .insert(schema.apikeyTable)
          .values({
            id: randomUUID(),
            key: randomUUID(),
            userId: f.member.user.id,
            referenceId: f.member.user.id,
            name: "attachment key",
            enabled: true,
            permissions: JSON.stringify({
              project: ["read"],
              work_item: ["read"],
              attachment: ["delete_own"],
            }),
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning(),
        "key",
      );
      const request = {
        ...f.request,
        credentialType: "api_key" as const,
        credentialId: key.id,
        origin: "api" as const,
        actorType: "api_key" as const,
      };
      const action = await createPendingAction(request);
      await db
        .update(schema.apikeyTable)
        .set(
          change === "disabled"
            ? { enabled: false }
            : {
                permissions: JSON.stringify({
                  project: ["read"],
                  work_item: ["read"],
                }),
              },
        )
        .where(eq(schema.apikeyTable.id, key.id));
      await expect(
        approveAttachmentDeletion(f.approval(action.pendingActionId)),
      ).rejects.toMatchObject({ status: 409 });
      expect((await attachment(f.relation.id)).state).toBe("ready");
    },
  );
  it("parent changes/archive and removed requester authority cannot execute frozen actions", async () => {
    const f = await fixture();
    const action = await createPendingAction(f.request);
    await db
      .update(schema.workItemTable)
      .set({ version: f.source.version + 1 })
      .where(eq(schema.workItemTable.id, f.source.id));
    await expect(
      approveAttachmentDeletion(f.approval(action.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    const next = await createPendingAction(f.request);
    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, f.source.projectId));
    await expect(
      approveAttachmentDeletion(f.approval(next.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    expect((await attachment(f.relation.id)).state).toBe("ready");
  });
  it("the GC's recovery day and legal hold fence still govern physical removal after approval", async () => {
    const f = await fixture();
    const action = await createPendingAction(f.request);
    await approveAttachmentDeletion(f.approval(action.pendingActionId));
    expect(await cleanAttachment(f.relation.id, "deleted")).toBe(false);
    await db
      .update(schema.attachmentTable)
      .set({ deletedAt: new Date(Date.now() - 25 * 3600000) })
      .where(eq(schema.attachmentTable.id, f.relation.id));
    const hold = requireRow(
      await db
        .insert(schema.legalHoldTable)
        .values({
          scope: "person",
          scopeId: f.person.id,
          reason: "retain evidence",
          placedBy: f.member.user.id,
        })
        .returning(),
      "hold",
    );
    expect(await cleanAttachment(f.relation.id, "deleted")).toBe(false);
    expect(await readFile(path.join(root, f.relation.objectKey))).toEqual(
      BYTES,
    );
    await db
      .update(schema.legalHoldTable)
      .set({ liftedAt: new Date() })
      .where(eq(schema.legalHoldTable.id, hold.id));
    expect(await cleanAttachment(f.relation.id, "deleted")).toBe(true);
    await expect(
      readFile(path.join(root, f.relation.objectKey)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("a frozen attachment cannot disclose a former parent after reparenting", async () => {
    const f = await fixture();
    const action = await createPendingAction(f.request);
    await db
      .update(schema.attachmentTable)
      .set({ workItemId: f.target.id })
      .where(eq(schema.attachmentTable.id, f.relation.id));
    const read = await getOwnPendingAction(
      f.member.user.id,
      action.pendingActionId,
      undefined,
      { apiKeyId: null, traceId: randomUUID() },
    );
    expect(read).toMatchObject({
      summary: { redacted: true, targetCount: 1 },
      targetIds: [],
    });
    await expect(
      approveAttachmentDeletion(f.approval(action.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    expect((await attachment(f.relation.id)).state).toBe("ready");
  });
  it("an actual concurrent revision committing while approval waits on the attachment lock invalidates it", async () => {
    const f = await fixture();
    const action = await createPendingAction(f.request);
    const raw = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await raw.connect();
    try {
      await raw.query("BEGIN");
      await raw.query("SELECT id FROM attachment WHERE id=$1 FOR UPDATE", [
        f.relation.id,
      ]);
      const approving = approveAttachmentDeletion(
        f.approval(action.pendingActionId),
      );
      // Observe the actual waiter before committing the competing edit; no timing-only race.
      let waited = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        await raw.query("SELECT pg_stat_clear_snapshot()");
        const result = await raw.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'",
        );
        if (result.rows[0].n > 0) {
          waited = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(waited).toBe(true);
      await raw.query("UPDATE attachment SET filename=$2 WHERE id=$1", [
        f.relation.id,
        "Concurrent replacement.pdf",
      ]);
      await raw.query("COMMIT");
      await expect(approving).rejects.toMatchObject({ status: 409 });
      expect((await attachment(f.relation.id)).state).toBe("ready");
      expect((await pending(action.pendingActionId)).invalidationReason).toBe(
        "version_changed",
      );
    } finally {
      await raw.query("ROLLBACK");
      await raw.end();
    }
  });
});
