/**
 * Issue #493: `presign-attachment.ts`/`complete-attachment.ts` had NO in-transaction
 * liveness re-check at all -- `requireWorkItemReach()`/`requireAttachmentReach()` check
 * the work item's `deletedAt`/`archivedAt` before the request reaches either controller,
 * but neither controller re-checked those columns inside its own write, so a soft-delete
 * landing in the window between that check and the write let a `pending`/`ready`
 * attachment (plus, for a successful `complete`, its `attachment.added` activity row)
 * land on a dead item. Each DB write now locks and checks its work item and project inside
 * its own transaction -- these are real concurrency races (a rival holds an uncommitted
 * transaction on the row, the racing request blocks on it, then the rival commits mid-
 * flight), not a sequential "soft-delete then call".
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";
import {
  raceProjectArchive,
  raceProjectSoftDelete,
  raceWorkItemSoftDelete,
} from "./helpers/race-soft-delete";

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
  return (await created.json()) as { key: string; id: string };
}

function presignRequest(app: ReturnType<typeof createApp>["app"], key: string) {
  return app.request(`/api/work-items/${key}/attachments/presign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filename: "photo.png",
      contentType: "image/png",
      size: PNG_BYTES.length,
    }),
  });
}

describe("API integration: attachment liveness race (#493)", () => {
  let root: string;
  const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;

  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-attachment-493-"));
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

  it("presign-attachment: a concurrent soft-delete cannot slip past the new locked read and insert a pending attachment on a dead item", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key, id: workItemId } = await createWorkItem(
      app,
      project.id,
      type.id,
    );

    const race = await raceWorkItemSoftDelete(
      workItemId,
      async () => await presignRequest(app, key),
    );
    expect(race.blockedOnRowLock).toBe(true);
    if (race.operation.status === "rejected") throw race.operation.reason;
    const response = race.operation.value;

    // Pre-fix: this route had no in-transaction liveness re-check at all, so the insert
    // landed anyway. Post-fix: the locked re-read sees the now-committed soft-delete.
    expect((response as Response).status).toBe(404);

    const attachments = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.workItemId, workItemId));
    expect(attachments).toHaveLength(0);
  });

  it("#499: presign waits for project deletion and refuses to insert a pending attachment", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key, id: workItemId } = await createWorkItem(
      app,
      project.id,
      type.id,
    );

    const race = await raceProjectSoftDelete(
      project.id,
      async () => await presignRequest(app, key),
    );
    expect(race.blockedOnRowLock).toBe(true);
    if (race.operation.status === "rejected") throw race.operation.reason;
    expect(race.operation.value.status).toBe(404);

    const attachments = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.workItemId, workItemId));
    expect(attachments).toHaveLength(0);
  });

  it("complete-attachment: a concurrent soft-delete cannot slip past the new locked read and mark an attachment ready on a dead item", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key, id: workItemId } = await createWorkItem(
      app,
      project.id,
      type.id,
    );

    const presignResponse = await presignRequest(app, key);
    expect(presignResponse.status).toBe(200);
    const presigned = (await presignResponse.json()) as {
      attachmentId: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    };

    const uploadResponse = await app.request(presigned.uploadUrl, {
      method: "PUT",
      headers: presigned.uploadHeaders,
      body: PNG_BYTES,
    });
    expect(uploadResponse.status).toBe(204);

    const race = await raceWorkItemSoftDelete(
      workItemId,
      async () =>
        await app.request(
          `/api/attachments/${presigned.attachmentId}/complete`,
          {
            method: "POST",
          },
        ),
    );
    expect(race.blockedOnRowLock).toBe(true);
    if (race.operation.status === "rejected") throw race.operation.reason;
    const response = race.operation.value;

    // Pre-fix: this route had no in-transaction liveness re-check at all before flipping
    // the row to `ready`, so the write landed anyway. Post-fix: the locked re-read sees
    // the now-committed soft-delete and refuses before the `ready` UPDATE ever runs.
    expect((response as Response).status).toBe(404);

    const [row] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));
    expect(row?.state).toBe("pending");

    const activityRows = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, workItemId));
    expect(
      activityRows.filter((r) => r.verb === "attachment.added"),
    ).toHaveLength(0);
  });

  it("#499: complete waits for project deletion and leaves the attachment pending", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key, id: workItemId } = await createWorkItem(
      app,
      project.id,
      type.id,
    );

    const presignResponse = await presignRequest(app, key);
    expect(presignResponse.status).toBe(200);
    const presigned = (await presignResponse.json()) as {
      attachmentId: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    };
    const uploadResponse = await app.request(presigned.uploadUrl, {
      method: "PUT",
      headers: presigned.uploadHeaders,
      body: PNG_BYTES,
    });
    expect(uploadResponse.status).toBe(204);

    const race = await raceProjectSoftDelete(
      project.id,
      async () =>
        await app.request(
          `/api/attachments/${presigned.attachmentId}/complete`,
          {
            method: "POST",
          },
        ),
    );
    expect(race.blockedOnRowLock).toBe(true);
    if (race.operation.status === "rejected") throw race.operation.reason;
    expect(race.operation.value.status).toBe(404);

    const [row] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));
    expect(row?.state).toBe("pending");
    const activityRows = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, workItemId));
    expect(
      activityRows.filter((activity) => activity.verb === "attachment.added"),
    ).toHaveLength(0);
  });

  it("invalid complete waits for project archive before deleting its pending row", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key, id: workItemId } = await createWorkItem(
      app,
      project.id,
      type.id,
    );

    const presignResponse = await presignRequest(app, key);
    expect(presignResponse.status).toBe(200);
    const presigned = (await presignResponse.json()) as {
      attachmentId: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    };
    const uploadResponse = await app.request(presigned.uploadUrl, {
      method: "PUT",
      headers: presigned.uploadHeaders,
      body: NOT_A_PNG,
    });
    expect(uploadResponse.status).toBe(204);

    const race = await raceProjectArchive(
      project.id,
      async () =>
        await app.request(
          `/api/attachments/${presigned.attachmentId}/complete`,
          { method: "POST" },
        ),
    );
    expect(race.blockedOnRowLock).toBe(true);
    if (race.operation.status === "rejected") throw race.operation.reason;
    expect(race.operation.value.status).toBe(404);

    const [row] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));
    expect(row?.state).toBe("pending");

    const activityRows = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, workItemId));
    expect(
      activityRows.filter((activity) => activity.verb === "attachment.added"),
    ).toHaveLength(0);
  });
});
