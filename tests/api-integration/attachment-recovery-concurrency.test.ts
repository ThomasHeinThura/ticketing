import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const objectReadGate = vi.hoisted(() => ({
  wait: null as null | (() => Promise<void>),
}));

vi.mock("../../apps/api/src/storage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../apps/api/src/storage")>();
  return {
    ...actual,
    getObjectSizeAndHeader: async (
      ...args: Parameters<typeof actual.getObjectSizeAndHeader>
    ) => {
      await objectReadGate.wait?.();
      return actual.getObjectSizeAndHeader(...args);
    },
  };
});

import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { cleanAttachment } from "../../apps/api/src/scheduler/attachment-cleanup";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";
import { ensureCreationWorkflow } from "./helpers/workflow";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
let root: string;

async function makeWorkItemType(workspaceId: string) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `recover-${randomUUID()}`,
        name: "Task",
        category: "delivery",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeWorkItemType",
  );
}

async function createWorkItem(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  typeId: string,
) {
  const response = await app.request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ typeId, title: "Restore versus GC" }),
  });
  if (!response.ok) throw new Error("work-item fixture creation failed");
  return (await response.json()) as { key: string };
}

describe("API integration: attachment recovery versus garbage collection", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(
      path.join(tmpdir(), "taskdesk-attachment-recovery-race-"),
    );
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
    delete process.env.TASKDESK_STORAGE_DRIVER;
    objectReadGate.wait = null;
  });

  afterEach(async () => {
    objectReadGate.wait = null;
    if (originalRoot === undefined)
      delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    else process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = originalRoot;
    await rm(root, { recursive: true, force: true });
  });

  it("AT-7 makes GC wait for an in-progress restore, then rechecks expiry and removes the object", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantWorkItemProjectAccess(member.user.id, project.id);
    const type = await makeWorkItemType(member.workspace.id);
    await db.insert(schema.stateTemplateTable).values({
      workspaceId: member.workspace.id,
      key: `state-${randomUUID()}`,
      name: "Backlog",
      group: "backlog",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const [stateTemplate] = await db
      .select()
      .from(schema.stateTemplateTable)
      .where(eq(schema.stateTemplateTable.workspaceId, member.workspace.id));
    if (!stateTemplate) throw new Error("state template fixture missing");
    await db.insert(schema.stateTable).values({
      projectId: project.id,
      stateTemplateId: stateTemplate.id,
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await ensureCreationWorkflow({
      workspaceId: member.workspace.id,
      projectId: project.id,
      typeId: type.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    const presign = await app.request(
      `/api/work-items/${key}/attachments/presign`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: "race.png",
          contentType: "image/png",
          size: PNG_BYTES.length,
        }),
      },
    );
    expect(presign.status).toBe(200);
    const presigned = (await presign.json()) as {
      attachmentId: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    };
    const upload = await app.request(presigned.uploadUrl, {
      method: "PUT",
      headers: presigned.uploadHeaders,
      body: PNG_BYTES,
    });
    expect(upload.ok).toBe(true);
    expect(
      (
        await app.request(
          `/api/attachments/${presigned.attachmentId}/complete`,
          {
            method: "POST",
          },
        )
      ).status,
    ).toBe(200);
    await db
      .update(schema.attachmentTable)
      .set({
        state: "deleted",
        // Give restore three seconds to lock the row. GC becomes eligible while its
        // HEAD check is paused, then must wait for that same attachment lock.
        deletedAt: new Date(Date.now() - 24 * 60 * 60 * 1000 + 3_000),
      })
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));

    let enterHead!: () => void;
    let releaseHead!: () => void;
    const headEntered = new Promise<void>((resolve) => {
      enterHead = resolve;
    });
    const headRelease = new Promise<void>((resolve) => {
      releaseHead = resolve;
    });
    objectReadGate.wait = async () => {
      enterHead();
      await headRelease;
    };

    const restoring = app.request(
      `/api/attachments/${presigned.attachmentId}/restore`,
      { method: "POST" },
    );
    await headEntered; // The route has locked the parent and attachment row.
    await new Promise((resolve) => setTimeout(resolve, 3_100));
    const collecting = cleanAttachment(presigned.attachmentId, "deleted");
    await new Promise((resolve) => setTimeout(resolve, 40));
    releaseHead();

    const [restoreResponse, collected] = await Promise.all([
      restoring,
      collecting,
    ]);
    expect(restoreResponse.status).toBe(409);
    expect(collected).toBe(true);
    const saved = await db.query.attachmentTable.findFirst({
      where: eq(schema.attachmentTable.id, presigned.attachmentId),
    });
    expect(saved).toBeUndefined();
  });
});
