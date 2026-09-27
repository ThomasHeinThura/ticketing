/**
 * Issue #28 (`attachments.md`) -- the work-item attachment slice: presign, complete,
 * download and delete, end to end against the real `filesystem` storage driver and a
 * real Postgres database.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

/**
 * A `person` row for a user (`presign-attachment.ts`/`delete-attachment.ts`'s own
 * comments: there is no reliable session->person resolver anywhere in `apps/api` yet,
 * so `uploaded_by` -- and therefore delete ownership -- resolves only for a user who
 * already has one, exactly like `work-item-assign.test.ts`'s own `addPersonOnRoster`).
 */
async function addPersonForUser(userId: string) {
  const organisation = await ensureInternalOrganisation();
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.personTable)
      .values({
        userId,
        organisationId: organisation.id,
        side: "staff",
        active: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "addPersonForUser",
  );
}

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
const NOT_A_PNG = Buffer.from("this is definitely not a png");

async function makeWorkItemType(workspaceId: string) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeWorkItemType",
  );
}

async function makeDefaultState(workspaceId: string, projectId: string) {
  const now = new Date();
  const stateTemplate = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: `state-${randomUUID()}`,
        name: "Backlog",
        group: "backlog",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeDefaultState: state_template",
  );
  return requireRow(
    await db
      .insert(schema.stateTable)
      .values({
        projectId,
        stateTemplateId: stateTemplate.id,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeDefaultState: state",
  );
}

async function setupProject() {
  const { user: creator, workspace } = await createWorkspaceMember({
    role: "admin",
  });
  const { project } = await createProjectFixture({ workspaceId: workspace.id });
  const type = await makeWorkItemType(workspace.id);
  await makeDefaultState(workspace.id, project.id);
  return { creator, workspace, project, type };
}

async function createWorkItem(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  typeId: string,
) {
  const created = await app.request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ typeId, title: "Attach me" }),
  });
  return (await created.json()) as { key: string };
}

describe("API integration: work-item attachments (#28, attachments.md)", () => {
  let root: string;
  const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;

  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-attachment-"));
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
    delete process.env.TASKDESK_STORAGE_DRIVER;
  });

  afterEach(async () => {
    if (originalRoot === undefined) {
      delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    } else {
      process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = originalRoot;
    }
    await rm(root, { recursive: true, force: true });
  });

  it("AT-2: presigns, uploads and completes a genuine PNG, and it appears in the work item's list", async () => {
    const { creator, workspace, project, type } = await setupProject();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    const presignResponse = await app.request(
      `/api/work-items/${key}/attachments/presign`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: "photo.png",
          contentType: "image/png",
          size: PNG_BYTES.length,
        }),
      },
    );
    expect(presignResponse.status).toBe(200);
    const presigned = (await presignResponse.json()) as {
      attachmentId: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    };
    expect(presigned.attachmentId).toBeTruthy();

    const [pendingRow] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));
    expect(pendingRow?.state).toBe("pending");
    expect(pendingRow?.workspaceId).toBe(workspace.id);

    const uploadResponse = await app.request(presigned.uploadUrl, {
      method: "PUT",
      headers: presigned.uploadHeaders,
      body: PNG_BYTES,
    });
    expect(uploadResponse.status).toBe(204);

    const completeResponse = await app.request(
      `/api/attachments/${presigned.attachmentId}/complete`,
      { method: "POST" },
    );
    expect(completeResponse.status).toBe(200);
    const completed = (await completeResponse.json()) as { state: string };
    expect(completed.state).toBe("ready");

    const listResponse = await app.request(
      `/api/work-items/${key}/attachments`,
    );
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as Array<{ id: string }>;
    expect(list.map((a) => a.id)).toContain(presigned.attachmentId);

    const activityRows = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.verb, "attachment.added"));
    expect(activityRows).toHaveLength(1);
    expect(activityRows[0]?.visibility).toBe("internal");
  });

  it("AT-2 edge case: a declared image/png whose bytes are NOT a png is rejected at complete, and the object is deleted", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    const presignResponse = await app.request(
      `/api/work-items/${key}/attachments/presign`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: "fake.png",
          contentType: "image/png",
          size: NOT_A_PNG.length,
        }),
      },
    );
    const presigned = (await presignResponse.json()) as {
      attachmentId: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    };

    await app.request(presigned.uploadUrl, {
      method: "PUT",
      headers: presigned.uploadHeaders,
      body: NOT_A_PNG,
    });

    const completeResponse = await app.request(
      `/api/attachments/${presigned.attachmentId}/complete`,
      { method: "POST" },
    );
    expect(completeResponse.status).toBe(400);

    const rows = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));
    expect(rows).toHaveLength(0);
  });

  it("AT-14: rejects a disallowed extension at presign with a clear reason", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    const response = await app.request(
      `/api/work-items/${key}/attachments/presign`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: "virus.exe",
          contentType: "application/octet-stream",
          size: 10,
        }),
      },
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("exe");
  });

  it("AT-5/AT-6: download redirects to a presigned URL and writes an audit row; AT-7 delete then hides it from download and the list", async () => {
    const { creator, workspace, project, type } = await setupProject();
    await addPersonForUser(creator.id);
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    const presignResponse = await app.request(
      `/api/work-items/${key}/attachments/presign`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: "photo.png",
          contentType: "image/png",
          size: PNG_BYTES.length,
        }),
      },
    );
    const presigned = (await presignResponse.json()) as {
      attachmentId: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    };
    await app.request(presigned.uploadUrl, {
      method: "PUT",
      headers: presigned.uploadHeaders,
      body: PNG_BYTES,
    });
    await app.request(`/api/attachments/${presigned.attachmentId}/complete`, {
      method: "POST",
    });

    const downloadResponse = await app.request(
      `/api/attachments/${presigned.attachmentId}`,
      { redirect: "manual" },
    );
    expect(downloadResponse.status).toBe(302);
    expect(downloadResponse.headers.get("location")).toContain(
      "/storage/filesystem-download",
    );

    const auditRows = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityId, presigned.attachmentId),
          eq(schema.auditLogTable.action, "attachment.downloaded"),
        ),
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.workspaceId).toBe(workspace.id);

    const deleteResponse = await app.request(
      `/api/attachments/${presigned.attachmentId}`,
      { method: "DELETE" },
    );
    expect(deleteResponse.status).toBe(200);
    const deleted = (await deleteResponse.json()) as { state: string };
    expect(deleted.state).toBe("deleted");

    const afterDeleteDownload = await app.request(
      `/api/attachments/${presigned.attachmentId}`,
      { redirect: "manual" },
    );
    expect(afterDeleteDownload.status).toBe(404);

    const listAfterDelete = await app.request(
      `/api/work-items/${key}/attachments`,
    );
    const list = (await listAfterDelete.json()) as Array<{ id: string }>;
    expect(list.map((a) => a.id)).not.toContain(presigned.attachmentId);
  });

  it("only the uploader may delete their own attachment (structural ownership check)", async () => {
    const { creator, workspace, project, type } = await setupProject();
    await addPersonForUser(creator.id);
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    const presignResponse = await app.request(
      `/api/work-items/${key}/attachments/presign`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: "photo.png",
          contentType: "image/png",
          size: PNG_BYTES.length,
        }),
      },
    );
    const presigned = (await presignResponse.json()) as {
      attachmentId: string;
    };

    // A second admin, on the same workspace, who never uploaded this attachment.
    const otherUser = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: `user-${randomUUID()}`,
          email: `other-${randomUUID()}@example.com`,
          emailVerified: true,
          name: "Other Admin",
        })
        .returning(),
      "other user",
    );
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: workspace.id,
      userId: otherUser.id,
      role: "admin",
      joinedAt: new Date(),
    });
    await addPersonForUser(otherUser.id);

    mockAuthenticatedSession(otherUser);
    const deleteResponse = await app.request(
      `/api/attachments/${presigned.attachmentId}`,
      { method: "DELETE" },
    );
    expect(deleteResponse.status).toBe(403);
  });
});
