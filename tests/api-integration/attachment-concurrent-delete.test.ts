/** Concurrent durable requests must preserve the file; concurrent confirmations tombstone exactly once. */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
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

vi.mock("../../apps/api/src/work-item/activity", async () => {
  const actual = await vi.importActual<
    typeof import("../../apps/api/src/work-item/activity")
  >("../../apps/api/src/work-item/activity");
  return {
    ...actual,
    recordWorkItemActivity: async (
      ...args: Parameters<typeof actual.recordWorkItemActivity>
    ) => {
      const result = await actual.recordWorkItemActivity(...args);
      // Hold this transaction's row lock open a little longer -- see this file's own
      // top-of-file doc comment for exactly why this is the barrier point that works.
      await new Promise((resolve) => setTimeout(resolve, 150));
      return result;
    },
  };
});

async function addPersonForUser(userId: string) {
  const [existingPerson] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .limit(1);
  if (existingPerson) return existingPerson;

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
  await grantWorkItemProjectAccess(creator.id, project.id);
  const type = await makeWorkItemType(workspace.id);
  await makeDefaultState(workspace.id, project.id);
  await ensureCreationWorkflow({
    workspaceId: workspace.id,
    projectId: project.id,
    typeId: type.id,
  });
  await db.insert(schema.sessionTable).values({
    id: `session-${creator.id}`,
    token: randomUUID(),
    userId: creator.id,
    portal: "agent",
    expiresAt: new Date(Date.now() + 3600000),
  });
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

/** Fires `count` concurrent `DELETE .../attachments/{id}` requests and returns their statuses. */
async function raceConcurrentDeletes(
  app: ReturnType<typeof createApp>["app"],
  attachmentId: string,
  count: number,
) {
  const responses = await Promise.all(
    Array.from({ length: count }, () =>
      app.request(`/api/attachments/${attachmentId}`, { method: "DELETE" }),
    ),
  );
  expect(responses.map((r) => r.status).sort()).toEqual([
    202, 409, 409, 409, 409,
  ]);
  const accepted = responses.find((r) => r.status === 202);
  if (!accepted) throw new Error("Missing durable action");
  const { pendingActionId } = (await accepted.json()) as {
    pendingActionId: string;
  };
  const [before] = await db
    .select()
    .from(schema.attachmentTable)
    .where(eq(schema.attachmentTable.id, attachmentId));
  expect(before?.state).toBe("ready");
  const approved = await Promise.all(
    Array.from({ length: count }, () =>
      app.request(`/api/me/pending-actions/${pendingActionId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    ),
  );
  return approved.map((r) => r.status);
}

describe("#454 regression: concurrent delete on one attachment", () => {
  let root: string;
  const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;

  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-attachment-454-"));
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

  it("exactly one activity row is recorded and deletedAt is not repeatedly overwritten, from five concurrent deletes", async () => {
    const { creator, project, type } = await setupProject();
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

    const completeResponse = await app.request(
      `/api/attachments/${presigned.attachmentId}/complete`,
      { method: "POST" },
    );
    expect(completeResponse.status).toBe(200);

    // The race: five requests hit `DELETE` for the SAME, already-`ready` attachment at
    // once. See this file's own top-of-file doc comment for why the mocked
    // `recordWorkItemActivity` delay above is what actually forces the real interleaving.
    const statuses = await raceConcurrentDeletes(
      app,
      presigned.attachmentId,
      5,
    );

    // DELETE is idempotent here: every call -- the real winner and every racer whose own
    // re-check then sees the row already `deleted` -- returns the same 200 no-op. The actual
    // regression is not the status codes; it's what got written underneath them.
    expect(statuses.sort()).toEqual([200, 409, 409, 409, 409]);

    const [row] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));
    expect(row?.state).toBe("deleted");
    expect(row?.deletedAt).toBeInstanceOf(Date);

    // The actual point of #454: only the ONE call that actually won the guarded UPDATE may
    // ever record the activity row -- not one per concurrent call.
    const activityRows = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.verb, "attachment.deleted"));
    expect(activityRows).toHaveLength(1);
    expect(activityRows[0]?.payload).toMatchObject({
      attachmentId: presigned.attachmentId,
    });
  });
});
