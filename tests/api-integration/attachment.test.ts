/**
 * Issue #28 (`attachments.md`) -- the work-item attachment slice: presign, complete,
 * download and delete, end to end against the real `filesystem` storage driver and a
 * real Postgres database.
 */
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

  it("a review finding (2026-09-27): complete rejects an object whose actual stored size exceeds attachment_max_bytes, and it is not left ready", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator);

    // Lower the instance's own limit well below what we're about to upload so the
    // test is practical -- no real 25MB file needed.
    await db
      .insert(schema.instanceSettingTable)
      .values({ id: "singleton", attachmentMaxBytes: 20 })
      .onConflictDoUpdate({
        target: schema.instanceSettingTable.id,
        set: { attachmentMaxBytes: 20 },
      });

    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    const oversizedText = Buffer.from("x".repeat(100));

    const presignResponse = await app.request(
      `/api/work-items/${key}/attachments/presign`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        // `size` here is the CLAIMED size, capped at the same limit at presign time --
        // this test's whole point is that the S3-style driver's presigned PUT has no
        // size-range condition, so what actually lands in storage can still exceed it.
        // The filesystem driver used by this test suite DOES enforce a token-bound
        // ceiling on write, so the claimed size must already be within the (lowered)
        // limit for the PUT to even succeed -- the real gap this test proves closed is
        // the SERVER re-checking the object it reads back at complete time, not merely
        // trusting whatever size was originally claimed.
        body: JSON.stringify({
          filename: "notes.txt",
          contentType: "text/plain",
          size: 20,
        }),
      },
    );
    expect(presignResponse.status).toBe(200);
    const presigned = (await presignResponse.json()) as {
      attachmentId: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    };

    // Simulate the actual stored object being larger than what was declared/allowed at
    // presign time by writing directly to the filesystem driver's own root, bypassing
    // the token-bound ceiling the way an S3 caller bypasses S3's own presigned-PUT
    // constraints (`storage/s3.ts`'s own comment: no `content-length-range` condition).
    const [pendingRow] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));
    expect(pendingRow?.state).toBe("pending");

    const objectPath = path.join(root, pendingRow?.objectKey ?? "");
    await mkdir(path.dirname(objectPath), { recursive: true });
    await writeFile(objectPath, oversizedText);

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

  it("a review finding (2026-09-27, B1): a declared no-signature-check MIME type unrelated to the file's extension is rejected at presign, before any bytes are uploaded", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    // Previously: text/plain (one of the four types magic-bytes.ts never sniffs, by
    // design -- plain text has no reliable magic bytes) could be declared for a ".doc"
    // upload, skipping the magic-byte check entirely regardless of the file's real bytes.
    const response = await app.request(
      `/api/work-items/${key}/attachments/presign`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: "malware.doc",
          contentType: "text/plain",
          size: 10,
        }),
      },
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("not an allowed content type");

    const rows = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.filename, "malware.doc"));
    expect(rows).toHaveLength(0);
  });

  it("a review finding (2026-09-27, B2): a second PUT to the presigned upload URL after complete cannot replace the checked bytes -- the download still serves the original", async () => {
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

    const firstPut = await app.request(presigned.uploadUrl, {
      method: "PUT",
      headers: presigned.uploadHeaders,
      body: PNG_BYTES,
    });
    expect(firstPut.status).toBe(204);

    const completeResponse = await app.request(
      `/api/attachments/${presigned.attachmentId}/complete`,
      { method: "POST" },
    );
    expect(completeResponse.status).toBe(200);

    // The object's row-stored key must have moved -- proof the finalize step actually ran,
    // not merely that the response looked right.
    const [readyRow] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));
    expect(readyRow?.state).toBe("ready");
    expect(readyRow?.objectKey).not.toBe(undefined);
    expect(readyRow?.objectKey?.endsWith("/final/photo.png")).toBe(true);

    // The exact replay the review used: the presigned URL (same key, same HMAC token)
    // has not expired, so the write route itself still accepts a second PUT -- what
    // matters is that this can no longer change what gets served.
    const MALICIOUS_REPLACEMENT = Buffer.from(
      "this would have silently replaced the checked bytes",
    );
    const secondPut = await app.request(presigned.uploadUrl, {
      method: "PUT",
      headers: presigned.uploadHeaders,
      body: MALICIOUS_REPLACEMENT,
    });
    // The write route itself has no notion of "already completed" (it is a bare signed
    // token, exactly like a real S3 presigned PUT) -- it succeeds, but only against the
    // now-vacated pending key, which nothing serves from any more.
    expect(secondPut.status).toBe(204);

    const downloadResponse = await app.request(
      `/api/attachments/${presigned.attachmentId}`,
      { redirect: "manual" },
    );
    expect(downloadResponse.status).toBe(302);
    const downloadLocation = downloadResponse.headers.get("location") ?? "";
    const servedResponse = await app.request(downloadLocation);
    expect(servedResponse.status).toBe(200);
    const servedBytes = Buffer.from(await servedResponse.arrayBuffer());

    // The proof: what is actually served is still the ORIGINAL bytes, not the replay.
    expect(servedBytes.equals(PNG_BYTES)).toBe(true);
    expect(servedBytes.equals(MALICIOUS_REPLACEMENT)).toBe(false);
  });

  it("a review finding (2026-09-27, N1 delta 2): a slow upload still writing to the pending key when complete finalizes cannot land its bytes in the served final file", async () => {
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

    // A controllable request body: `enqueue`d chunks are delivered to the write route as
    // soon as they arrive, and nothing closes the stream (so the upload never finishes)
    // until this test explicitly says so -- the exact "slow PUT opens the pending file
    // and stalls" shape the security review reproduced.
    let releaseController!: ReadableStreamDefaultController<Uint8Array>;
    const slowBody = new ReadableStream<Uint8Array>({
      start(controller) {
        releaseController = controller;
      },
    });
    const slowPut = app.request(presigned.uploadUrl, {
      method: "PUT",
      headers: presigned.uploadHeaders,
      body: slowBody,
      duplex: "half",
    } as RequestInit);

    // Give the slow request's own handler a real turn of the event loop to start
    // (open its temp file and begin awaiting stream data) before the fast request races
    // past it -- otherwise the two requests would not actually be concurrent.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const fastPut = await app.request(presigned.uploadUrl, {
      method: "PUT",
      headers: presigned.uploadHeaders,
      body: PNG_BYTES,
    });
    expect(fastPut.status).toBe(204);

    const completeResponse = await app.request(
      `/api/attachments/${presigned.attachmentId}/complete`,
      { method: "POST" },
    );
    expect(completeResponse.status).toBe(200);
    const completed = (await completeResponse.json()) as { state: string };
    expect(completed.state).toBe("ready");

    // Only NOW does the slow request finish -- its remaining bytes arrive after
    // `complete` has already finalized and checked the object, exactly as the review
    // reproduced it ("the stalled PUT then sends malicious bytes").
    const MALICIOUS_PE_HEADER = Buffer.from([
      0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00,
    ]);
    releaseController.enqueue(MALICIOUS_PE_HEADER);
    releaseController.close();
    const slowResult = await slowPut;
    expect(slowResult.status).toBe(204);

    const downloadResponse = await app.request(
      `/api/attachments/${presigned.attachmentId}`,
      { redirect: "manual" },
    );
    expect(downloadResponse.status).toBe(302);
    const location = downloadResponse.headers.get("location") ?? "";
    const servedResponse = await app.request(location);
    expect(servedResponse.status).toBe(200);
    const servedBytes = Buffer.from(await servedResponse.arrayBuffer());

    // The proof: the served bytes are still the checked PNG -- never the slow request's
    // late-arriving bytes, regardless of the fact that both PUTs targeted the exact same
    // presigned key.
    expect(servedBytes.equals(PNG_BYTES)).toBe(true);
    expect(servedBytes.equals(MALICIOUS_PE_HEADER)).toBe(false);
  });

  it("a review finding (2026-09-27, B4): a custom role without work_item:read is refused the work item's attachment list, matching the single-attachment download route", async () => {
    const { creator, workspace, project, type } = await setupProject();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    // A second workspace member on a custom role holding ONLY workspace:read -- no
    // work_item:read at all. This is the exact shape the review used to get 200 from the
    // list route while the single-attachment download route correctly 403'd for the same
    // identity.
    const restrictedUser = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: `user-${randomUUID()}`,
          email: `restricted-${randomUUID()}@example.com`,
          emailVerified: true,
          name: "Attachment List Probe",
        })
        .returning(),
      "restricted user",
    );
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: workspace.id,
      userId: restrictedUser.id,
      role: "attachment-list-probe",
      joinedAt: new Date(),
    });
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: workspace.id,
      role: "attachment-list-probe",
      permission: JSON.stringify({ workspace: ["read"] }),
    });

    mockAuthenticatedSession(restrictedUser);
    const listResponse = await app.request(
      `/api/work-items/${key}/attachments`,
    );
    expect(listResponse.status).toBe(403);
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
