/**
 * Issue #28 (`attachments.md`) -- the work-item attachment slice: presign, complete,
 * download and delete, end to end against the real `filesystem` storage driver and a
 * real Postgres database.
 */
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findWorkItemAttachment,
  listWorkItemAttachments,
} from "../../apps/api/src/attachment/repository";
import { auth } from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { cleanAttachment } from "../../apps/api/src/scheduler/attachment-cleanup";
import { deleteStorageObject } from "../../apps/api/src/storage";
import { apiKeyCapabilitySubset } from "../../apps/api/src/utils/require-api-key-permission-scope";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  grantWorkItemProjectAccess,
  prepareAuthenticatedApiFixture,
  requireRow,
} from "./helpers/fixtures";
import { raceProjectArchive } from "./helpers/race-soft-delete";
import { makeApiKey, setAmbientHeaders } from "./helpers/reach-world";
import { ensureCreationWorkflow } from "./helpers/workflow";

const originalAgentUrl = process.env.TASKDESK_AGENT_URL;

function restoreAgentUrl() {
  if (originalAgentUrl === undefined) delete process.env.TASKDESK_AGENT_URL;
  else process.env.TASKDESK_AGENT_URL = originalAgentUrl;
}

/**
 * A `person` row for a user (`presign-attachment.ts`/`delete-attachment.ts`'s own
 * comments: there is no reliable session->person resolver anywhere in `apps/api` yet,
 * so `uploaded_by` -- and therefore delete ownership -- resolves only for a user who
 * already has one, exactly like `work-item-assign.test.ts`'s own `addPersonOnRoster`).
 */
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
  await grantWorkItemProjectAccess(creator.id, project.id);
  const type = await makeWorkItemType(workspace.id);
  await makeDefaultState(workspace.id, project.id);
  await ensureCreationWorkflow({
    workspaceId: workspace.id,
    projectId: project.id,
    typeId: type.id,
  });
  return { creator, workspace, project, type };
}

/** Existing deletion cases traverse real request202 + explicit approval before inspecting tombstones. */
async function requestAndApproveAttachmentDeletion(
  app: ReturnType<typeof createApp>["app"],
  id: string,
) {
  const current = await auth.api.getSession({ headers: new Headers() });
  if (current)
    await db
      .insert(schema.sessionTable)
      .values({ ...current.session, portal: "agent" })
      .onConflictDoNothing();
  const request = await app.request(`/api/attachments/${id}`, {
    method: "DELETE",
  });
  if (request.status !== 202) return request;
  const action = (await request.json()) as { pendingActionId: string };
  const approval = await app.request(
    `/api/me/pending-actions/${action.pendingActionId}/approve`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  );
  if (approval.status !== 200) return approval;
  const row = requireRow(
    await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, id)),
    "confirmed attachment",
  );
  return Response.json(row);
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

  it("scopes direct attachment repository reads to the resolved project reach", async () => {
    const { creator, workspace, project, type } = await setupProject();
    const { app } = createApp();
    mockAuthenticatedSession(creator);
    const { key } = await createWorkItem(app, project.id, type.id);
    const [item] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    if (!item) throw new Error("fixture work item missing");
    const row = requireRow(
      await db
        .insert(schema.attachmentTable)
        .values({
          workspaceId: workspace.id,
          organisationId: project.organisationId,
          workItemId: item.id,
          objectKey: `scope/${randomUUID()}`,
          filename: "reachable.txt",
          mimeType: "text/plain",
          size: 1,
          state: "ready",
          customerVisible: false,
          uploadedBy: null,
        })
        .returning(),
      "scoped attachment",
    );
    await db.insert(schema.attachmentTable).values({
      workspaceId: workspace.id,
      organisationId: project.organisationId,
      workItemId: item.id,
      objectKey: `scope/${randomUUID()}`,
      filename: "deleted-control.txt",
      mimeType: "text/plain",
      size: 1,
      state: "deleted",
      customerVisible: false,
      uploadedBy: null,
      deletedAt: new Date(),
    });
    // Same workspace, deliberately unreachable project: grant only long enough to create
    // a real work item, then revoke it before resolving the tested identity.
    const sameWorkspaceProject = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await makeDefaultState(workspace.id, sameWorkspaceProject.project.id);
    const hiddenType = await makeWorkItemType(workspace.id);
    await ensureCreationWorkflow({
      workspaceId: workspace.id,
      projectId: sameWorkspaceProject.project.id,
      typeId: hiddenType.id,
    });
    await grantWorkItemProjectAccess(
      creator.id,
      sameWorkspaceProject.project.id,
    );
    const { key: hiddenKey } = await createWorkItem(
      app,
      sameWorkspaceProject.project.id,
      hiddenType.id,
    );
    const [hiddenItem] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, hiddenKey));
    if (!hiddenItem) throw new Error("unreached work item fixture missing");
    const hiddenRow = requireRow(
      await db
        .insert(schema.attachmentTable)
        .values({
          workspaceId: workspace.id,
          organisationId: sameWorkspaceProject.project.organisationId,
          workItemId: hiddenItem.id,
          objectKey: `scope/${randomUUID()}`,
          filename: "unreached.txt",
          mimeType: "text/plain",
          size: 1,
          state: "ready",
          customerVisible: true,
          uploadedBy: null,
        })
        .returning(),
      "unreached attachment",
    );
    const [creatorPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, creator.id));
    if (!creatorPerson) throw new Error("creator person fixture missing");
    await db
      .delete(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, creatorPerson.id),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, sameWorkspaceProject.project.id),
        ),
      );
    // A second organisation/workspace supplies a real foreign parent and row.
    const foreign = await setupProject();
    const foreignOrganisation = requireRow(
      await db
        .insert(schema.organisationTable)
        .values({
          key: `scope-foreign-${randomUUID()}`,
          name: "Scope Foreign Customer",
        })
        .returning(),
      "foreign customer organisation",
    );
    await db
      .update(schema.projectTable)
      .set({ organisationId: foreignOrganisation.id })
      .where(eq(schema.projectTable.id, foreign.project.id));
    mockAuthenticatedSession(foreign.creator);
    const { key: foreignKey } = await createWorkItem(
      app,
      foreign.project.id,
      foreign.type.id,
    );
    const [foreignItem] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, foreignKey));
    if (!foreignItem) throw new Error("foreign work item fixture missing");
    const foreignRow = requireRow(
      await db
        .insert(schema.attachmentTable)
        .values({
          workspaceId: foreign.workspace.id,
          organisationId: foreignOrganisation.id,
          workItemId: foreignItem.id,
          objectKey: `scope/${randomUUID()}`,
          filename: "foreign.txt",
          mimeType: "text/plain",
          size: 1,
          state: "ready",
          customerVisible: true,
          uploadedBy: null,
        })
        .returning(),
      "foreign attachment",
    );
    mockAuthenticatedSession(creator);
    const identity = await resolveIdentity({
      userId: creator.id,
      credential: "session",
    });
    expect(identity).not.toBeNull();
    const visible = await listWorkItemAttachments(db, identity, item.id);
    expect(visible.map((entry) => entry.filename)).toContain("reachable.txt");
    expect(visible.map((entry) => entry.filename)).not.toContain(
      "deleted-control.txt",
    );
    expect(visible.map((entry) => entry.filename)).not.toContain(
      "unreached.txt",
    );
    expect(visible.map((entry) => entry.filename)).not.toContain("foreign.txt");
    expect(await listWorkItemAttachments(db, null, item.id)).toEqual([]);
    expect(await listWorkItemAttachments(db, identity, randomUUID())).toEqual(
      [],
    );
    expect(
      await findWorkItemAttachment(db, identity, {
        id: row.id,
        workspaceId: workspace.id,
        workItemId: randomUUID(),
      }),
    ).toEqual([]);
    expect(
      await findWorkItemAttachment(db, null, {
        id: row.id,
        workspaceId: workspace.id,
        workItemId: item.id,
      }),
    ).toEqual([]);
    expect(
      await findWorkItemAttachment(db, identity, {
        id: hiddenRow.id,
        workspaceId: workspace.id,
        workItemId: hiddenItem.id,
      }),
    ).toEqual([]);
    expect(
      await findWorkItemAttachment(db, identity, {
        id: foreignRow.id,
        workspaceId: foreign.workspace.id,
        workItemId: foreignItem.id,
      }),
    ).toEqual([]);
  });

  afterEach(async () => {
    setAmbientHeaders({});
    if (originalRoot === undefined) {
      delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    } else {
      process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = originalRoot;
    }
    restoreAgentUrl();
    await rm(root, { recursive: true, force: true });
  });

  it("keeps attachment list API keys inside both stored scope and owner reach", async () => {
    const { creator, project, type } = await setupProject();
    const { app } = createApp();
    mockAuthenticatedSession(creator);
    const { key } = await createWorkItem(app, project.id, type.id);
    const [item] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    if (!item) throw new Error("fixture work item missing");
    await db.insert(schema.attachmentTable).values({
      workspaceId: item.workspaceId,
      organisationId: project.organisationId,
      workItemId: item.id,
      objectKey: `scope/${randomUUID()}`,
      filename: "api-key-readable.txt",
      mimeType: "text/plain",
      size: 1,
      state: "ready",
      customerVisible: false,
      uploadedBy: null,
    });
    mockAnonymousSession();
    const readableKey = await makeApiKey(creator.id, { work_item: ["read"] });
    const requestWithApiKey = (url: string, key: string) => {
      const headers = new Headers({ "x-api-key": key });
      expect(headers.get("x-api-key")).toBe(key);
      return app.request(url, { headers });
    };
    const [storedReadableKey] = await db
      .select()
      .from(schema.apikeyTable)
      .where(eq(schema.apikeyTable.userId, creator.id))
      .orderBy(schema.apikeyTable.createdAt);
    if (!storedReadableKey) throw new Error("stored API key fixture missing");
    const storedPermissions = storedReadableKey.permissions
      ? (JSON.parse(storedReadableKey.permissions) as Record<string, string[]>)
      : null;
    const keyIdentity = await resolveIdentity({
      userId: creator.id,
      credential: "api_key",
      apiKey: {
        enabled: storedReadableKey.enabled === true,
        ownerUserId: storedReadableKey.userId ?? "",
        capabilities: apiKeyCapabilitySubset({
          permissions: storedPermissions,
        }),
      },
    });
    expect(
      (await listWorkItemAttachments(db, keyIdentity, item.id)).map(
        ({ filename }) => filename,
      ),
    ).toContain("api-key-readable.txt");
    const positive = await requestWithApiKey(
      `/api/work-items/${key}/attachments`,
      readableKey,
    );
    expect(positive.status, await positive.clone().text()).toBe(200);
    expect(await positive.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filename: "api-key-readable.txt" }),
      ]),
    );
    const insufficientScopeKey = await makeApiKey(creator.id, {});
    const insufficientStoredScope = await requestWithApiKey(
      `/api/work-items/${key}/attachments`,
      insufficientScopeKey,
    );
    expect(insufficientStoredScope.status).toBe(403);
    expect(await insufficientStoredScope.text()).not.toContain(
      "api-key-readable.txt",
    );

    // This owner has workspace membership but no project membership: even a key whose
    // stored scope names work_item:read cannot exceed the owner's current project reach.
    const nonOwner = await createWorkspaceMember({ role: "member" });
    const keyWithoutOwnerReach = await makeApiKey(nonOwner.user.id, {
      work_item: ["read"],
    });
    const ownerCeiling = await requestWithApiKey(
      `/api/work-items/${key}/attachments`,
      keyWithoutOwnerReach,
    );
    expect(ownerCeiling.status).toBe(404);
    expect(await ownerCeiling.text()).not.toContain("api-key-readable.txt");
  });

  it("AT-2: presigns, uploads and completes a genuine PNG, and it appears in the work item's list", async () => {
    // The integration harness initializes Better Auth for localhost:1337.
    // Keep that authority while changing only the configured public scheme so
    // this request exercises HTTPS URL generation without inventing a host.
    process.env.TASKDESK_AGENT_URL = "https://localhost:1337";
    const { creator, workspace, project, type } = await setupProject();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    const presignResponse = await app.request(
      new Request(
        `http://localhost:1337/api/work-items/${key}/attachments/presign`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            host: "localhost:1337",
            "x-forwarded-host": "attacker.example",
            "x-forwarded-proto": "http",
          },
          body: JSON.stringify({
            filename: "photo.png",
            contentType: "image/png",
            size: PNG_BYTES.length,
          }),
        },
      ),
    );
    expect(presignResponse.status).toBe(200);
    const presigned = (await presignResponse.json()) as {
      attachmentId: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    };
    expect(presigned.attachmentId).toBeTruthy();
    expect(presigned.uploadUrl).toMatch(
      /^https:\/\/localhost:1337\/api\/storage\/filesystem-attachment-upload\?/u,
    );
    expect(presigned.uploadUrl.match(/\/api\//gu)).toHaveLength(1);
    expect(new URL(presigned.uploadUrl).searchParams.get("key")).toBeTruthy();
    expect(
      new URL(presigned.uploadUrl).searchParams.get("expires"),
    ).toBeTruthy();
    expect(new URL(presigned.uploadUrl).searchParams.get("token")).toBeTruthy();

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

    const downloadResponse = await app.request(
      new Request(
        `http://localhost:1337/api/attachments/${presigned.attachmentId}`,
        {
          headers: {
            host: "localhost:1337",
            "x-forwarded-host": "attacker.example",
            "x-forwarded-proto": "http",
          },
        },
      ),
    );
    expect(downloadResponse.status).toBe(302);
    const downloadUrl = downloadResponse.headers.get("location");
    expect(downloadUrl).toMatch(
      /^https:\/\/localhost:1337\/api\/storage\/filesystem-download\?/u,
    );
    if (!downloadUrl) throw new Error("Missing signed download URL");
    expect(downloadUrl.match(/\/api\//gu)).toHaveLength(1);
    expect(new URL(downloadUrl).searchParams.get("key")).toBeTruthy();
    expect(new URL(downloadUrl).searchParams.get("expires")).toBeTruthy();
    expect(new URL(downloadUrl).searchParams.get("token")).toBeTruthy();

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

    const deleteResponse = await requestAndApproveAttachmentDeletion(
      app,
      presigned.attachmentId,
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

  it("#454 B1 regression: the uploader can delete their own PENDING (never completed) attachment", async () => {
    const { creator, project, type } = await setupProject();
    await addPersonForUser(creator.id);
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    // Presign only -- never upload, never call `complete`. The row stays `pending`, same
    // as a real abandoned upload (no cleanup job for stuck pending rows exists yet).
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

    const [pendingRow] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));
    expect(pendingRow?.state).toBe("pending");

    // Before the #454 fix over-narrowed the guarded UPDATE's WHERE clause to
    // `state = 'ready'`, this returned a wrong 403 ("Only the attachment's own uploader
    // may delete it") even though `creator` genuinely IS the uploader -- the guard simply
    // didn't accept `pending` as a state its own UPDATE could match, despite the
    // pre-transaction check a few lines above it explicitly allowing both `pending` and
    // `ready` through (Opus security review, first pass: B1).
    const deleteResponse = await requestAndApproveAttachmentDeletion(
      app,
      presigned.attachmentId,
    );
    expect(deleteResponse.status).toBe(200);
    const deleted = (await deleteResponse.json()) as { state: string };
    expect(deleted.state).toBe("deleted");

    const [row] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));
    expect(row?.state).toBe("deleted");
    expect(row?.deletedAt).toBeInstanceOf(Date);
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
    // N5 security-review fix (2026-09-28): the final key now embeds a fresh per-call
    // token (`toFinalAttachmentObjectKey`), so it is no longer a fixed, predictable
    // filename -- only the shape (a sibling "final" directory, original filename kept
    // as a suffix) is guaranteed.
    expect(readyRow?.objectKey).toMatch(/\/final\/[A-Za-z0-9]+-photo\.png$/);

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
    await prepareAuthenticatedApiFixture(restrictedUser.id);
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
    await grantProjectRole(restrictedUser.id, project.id, ["project:read"]);

    mockAuthenticatedSession(restrictedUser);
    const listResponse = await app.request(
      `/api/work-items/${key}/attachments`,
    );
    expect(listResponse.status).toBe(403);
  });

  it("own-only colleagues cannot delete another uploader’s attachment, including its tombstone", async () => {
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
          name: "Other Member",
        })
        .returning(),
      "other user",
    );
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: workspace.id,
      userId: otherUser.id,
      role: "member",
      joinedAt: new Date(),
    });
    await addPersonForUser(otherUser.id);
    // In project reach (a staff colleague): the ownership check, not reach, must refuse.
    await grantWorkItemProjectAccess(otherUser.id, project.id);

    mockAuthenticatedSession(otherUser);
    const deleteResponse = await requestAndApproveAttachmentDeletion(
      app,
      presigned.attachmentId,
    );
    expect(deleteResponse.status).toBe(403);

    mockAuthenticatedSession(creator);
    const ownerDelete = await requestAndApproveAttachmentDeletion(
      app,
      presigned.attachmentId,
    );
    expect(ownerDelete.status).toBe(200);
    await ownerDelete.text();

    mockAuthenticatedSession(otherUser);
    const tombstoneDelete = await requestAndApproveAttachmentDeletion(
      app,
      presigned.attachmentId,
    );
    expect(tombstoneDelete.status).toBe(403);
    await tombstoneDelete.text();
  });

  it("issue #480: 404s download and delete against an attachment whose work item is soft-deleted", async () => {
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

    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.key, key));

    const downloadResponse = await app.request(
      `/api/attachments/${presigned.attachmentId}`,
      { redirect: "manual" },
    );
    expect(downloadResponse.status).toBe(404);

    const deleteResponse = await requestAndApproveAttachmentDeletion(
      app,
      presigned.attachmentId,
    );
    expect(deleteResponse.status).toBe(404);

    const [row] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));
    expect(row?.state).toBe("ready");
  });

  it("issue #480: 404s download and delete against an attachment whose work item is archived", async () => {
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

    await db
      .update(schema.workItemTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.workItemTable.key, key));

    const downloadResponse = await app.request(
      `/api/attachments/${presigned.attachmentId}`,
      { redirect: "manual" },
    );
    expect(downloadResponse.status).toBe(404);

    const deleteResponse = await requestAndApproveAttachmentDeletion(
      app,
      presigned.attachmentId,
    );
    expect(deleteResponse.status).toBe(404);

    const [row] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));
    expect(row?.state).toBe("ready");
  });

  it("#499: attachment delete waits for project archive and leaves the attachment unchanged", async () => {
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
    const { attachmentId } = (await presignResponse.json()) as {
      attachmentId: string;
    };

    const race = await raceProjectArchive(
      project.id,
      async () =>
        await app.request(`/api/attachments/${attachmentId}`, {
          method: "DELETE",
        }),
    );
    expect(race.blockedOnRowLock).toBe(true);
    if (race.operation.status === "rejected") throw race.operation.reason;
    expect(race.operation.value.status).toBe(404);

    const [row] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, attachmentId));
    if (!row) throw new Error("expected attachment row after rejected delete");
    expect(row?.state).toBe("pending");
    const activityRows = await db.select().from(schema.activityTable);
    expect(
      activityRows.some(
        (activity) =>
          activity.workItemId === row.workItemId &&
          activity.verb === "attachment.deleted",
      ),
    ).toBe(false);
  });

  it("issue #480 (F3): 404s POST /api/attachments/{id}/complete against a soft-deleted work item, and the row stays pending", async () => {
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
    await app.request(presigned.uploadUrl, {
      method: "PUT",
      headers: presigned.uploadHeaders,
      body: PNG_BYTES,
    });

    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.key, key));

    const completeResponse = await app.request(
      `/api/attachments/${presigned.attachmentId}/complete`,
      { method: "POST" },
    );
    expect(completeResponse.status).toBe(404);

    const [row] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));
    expect(row?.state).toBe("pending");
  });

  /** Presign, PUT, complete one PNG; returns the presign + complete responses' decoded bodies. */
  async function uploadPng(
    app: ReturnType<typeof createApp>["app"],
    key: string,
    extra: Record<string, unknown>,
  ) {
    const presign = await app.request(
      `/api/work-items/${key}/attachments/presign`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: "shot.png",
          contentType: "image/png",
          size: PNG_BYTES.length,
          ...extra,
        }),
      },
    );
    if (presign.status !== 200) return { presign };
    const presigned = (await presign.json()) as {
      attachmentId: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    };
    await app.request(presigned.uploadUrl, {
      method: "PUT",
      headers: presigned.uploadHeaders,
      body: PNG_BYTES,
    });
    const complete = await app.request(
      `/api/attachments/${presigned.attachmentId}/complete`,
      { method: "POST" },
    );
    return { presign, presigned, complete };
  }

  async function insertComment(input: {
    workspaceId: string;
    key: string;
    authorId: string;
    visibility: "public" | "internal";
  }) {
    const [item] = await db
      .select({ id: schema.workItemTable.id })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, input.key));
    return requireRow(
      await db
        .insert(schema.commentTable)
        .values({
          workspaceId: input.workspaceId,
          workItemId: requireRow([item], "comment parent").id,
          authorId: input.authorId,
          actorType: "person",
          body: { type: "doc", content: [{ type: "paragraph" }] },
          visibility: input.visibility,
        })
        .returning(),
      "insertComment",
    );
  }

  it("AT-1/AT-4: a comment file presigns, completes, lists under its comment and is internal on an internal comment whatever its flag says", async () => {
    const { creator, workspace, project, type } = await setupProject();
    const person = await addPersonForUser(creator.id);
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);
    const internal = await insertComment({
      workspaceId: workspace.id,
      key,
      authorId: person.id,
      visibility: "internal",
    });
    const publicComment = await insertComment({
      workspaceId: workspace.id,
      key,
      authorId: person.id,
      visibility: "public",
    });

    const onInternal = await uploadPng(app, key, {
      commentId: internal.id,
      customerVisible: true,
    });
    expect(onInternal.presign.status).toBe(200);
    expect(onInternal.complete?.status).toBe(200);
    // AT-3: a public comment's file is customer-visible only on explicit opt-in.
    const onPublic = await uploadPng(app, key, {
      commentId: publicComment.id,
      customerVisible: true,
    });
    expect(onPublic.complete?.status).toBe(200);

    const rows = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.commentId, internal.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.workItemId).toBeNull();
    // AT-4: stored internal although the request asked for a customer-visible file.
    expect(rows[0]?.customerVisible).toBe(false);
    const publicRows = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.commentId, publicComment.id));
    expect(publicRows[0]?.customerVisible).toBe(true);

    const list = (await (
      await app.request(`/api/work-items/${key}/attachments`)
    ).json()) as Array<{
      id: string;
      commentId: string | null;
      workItemId: string;
      customerVisible: boolean;
      canDelete: boolean;
    }>;
    const listed = list.find(
      (a) => a.id === onInternal.presigned?.attachmentId,
    );
    expect(listed?.commentId).toBe(internal.id);
    expect(listed?.workItemId).toBeTruthy();
    expect(listed?.customerVisible).toBe(false);
    // Deletion approval resolves work-item parents only.
    expect(listed?.canDelete).toBe(false);

    // Reach resolves through the comment: download works, and the activity row follows AT-4.
    const download = await app.request(
      `/api/attachments/${onInternal.presigned?.attachmentId}`,
      { redirect: "manual" },
    );
    expect(download.status).toBe(302);
    const activity = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.verb, "attachment.added"));
    expect(activity).toHaveLength(2);
    expect(
      activity.find(
        (row) =>
          (row.payload as { commentId?: string } | null)?.commentId ===
          internal.id,
      )?.visibility,
    ).toBe("internal");
    expect(
      activity.find(
        (row) =>
          (row.payload as { commentId?: string } | null)?.commentId ===
          publicComment.id,
      )?.visibility,
    ).toBe("public");
  });

  it("P1-22 / AT-3 (UNRUN: DB integration): a staff file on a public comment defaults to NOT customer-visible", async () => {
    const { creator, workspace, project, type } = await setupProject();
    const person = await addPersonForUser(creator.id);
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);
    const publicComment = await insertComment({
      workspaceId: workspace.id,
      key,
      authorId: person.id,
      visibility: "public",
    });
    const upload = await uploadPng(app, key, { commentId: publicComment.id });
    expect(upload.complete?.status).toBe(200);
    const [row] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.commentId, publicComment.id));
    expect(row?.customerVisible).toBe(false);
  });

  it("AT-1: only the comment's author can attach, the comment must belong to the item and be live, and a tombstone hides its files", async () => {
    const { creator, workspace, project, type } = await setupProject();
    const person = await addPersonForUser(creator.id);
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);
    const { key: otherKey } = await createWorkItem(app, project.id, type.id);

    // A different person (own workspace is irrelevant: comment.author_id has no FK).
    const other = await createWorkspaceMember({ role: "admin" });
    const otherPerson = await addPersonForUser(other.user.id);
    const theirs = await insertComment({
      workspaceId: workspace.id,
      key,
      authorId: otherPerson.id,
      visibility: "internal",
    });
    const mine = await insertComment({
      workspaceId: workspace.id,
      key,
      authorId: person.id,
      visibility: "internal",
    });

    const foreign = await uploadPng(app, key, { commentId: theirs.id });
    expect(foreign.presign.status).toBe(403);
    const wrongItem = await uploadPng(app, otherKey, { commentId: mine.id });
    expect(wrongItem.presign.status).toBe(404);
    const unknown = await uploadPng(app, key, { commentId: randomUUID() });
    expect(unknown.presign.status).toBe(404);

    const ok = await uploadPng(app, key, { commentId: mine.id });
    expect(ok.complete?.status).toBe(200);
    await db
      .update(schema.commentTable)
      .set({ deletedAt: new Date(), body: null })
      .where(eq(schema.commentTable.id, mine.id));

    const list = (await (
      await app.request(`/api/work-items/${key}/attachments`)
    ).json()) as Array<{ id: string }>;
    expect(list.map((a) => a.id)).not.toContain(ok.presigned?.attachmentId);
    expect(
      (
        await app.request(`/api/attachments/${ok.presigned?.attachmentId}`, {
          redirect: "manual",
        })
      ).status,
    ).toBe(404);
    const afterTombstone = await uploadPng(app, key, { commentId: mine.id });
    expect(afterTombstone.presign.status).toBe(404);
  });

  it("AT-7: recoverable list is explicit, restore preserves the object, audits safe identifiers, and GC skips the restored row", async () => {
    const { creator, workspace, project, type } = await setupProject();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);
    const upload = await uploadPng(app, key, {});
    expect(upload.complete?.status).toBe(200);
    const id = upload.presigned?.attachmentId;
    if (!id) throw new Error("attachment upload did not return an id");
    await db
      .update(schema.attachmentTable)
      .set({
        state: "deleted",
        deletedAt: sql`(clock_timestamp() AT TIME ZONE 'UTC') - interval '23 hours'`,
      })
      .where(eq(schema.attachmentTable.id, id));

    const ordinary = (await (
      await app.request(`/api/work-items/${key}/attachments`)
    ).json()) as Array<{ id: string }>;
    expect(ordinary.map((row) => row.id)).not.toContain(id);

    const recoverableResponse = await app.request(
      `/api/work-items/${key}/attachments?lifecycle=recoverable`,
    );
    expect(recoverableResponse.status).toBe(200);
    const recoverable = (await recoverableResponse.json()) as Array<{
      id: string;
      state: string;
      canRestore: boolean;
      objectKey?: string;
    }>;
    expect(recoverable).toContainEqual(
      expect.objectContaining({ id, state: "deleted", canRestore: true }),
    );
    expect(JSON.stringify(recoverable)).not.toContain("objectKey");

    const restoredResponse = await app.request(
      `/api/attachments/${id}/restore`,
      { method: "POST" },
    );
    expect(restoredResponse.status).toBe(200);
    expect(await restoredResponse.json()).toMatchObject({
      id,
      state: "ready",
      deletedAt: null,
      canRestore: false,
    });
    const saved = await db.query.attachmentTable.findFirst({
      where: eq(schema.attachmentTable.id, id),
    });
    expect(saved).toMatchObject({ state: "ready", deletedAt: null });
    expect(
      (await app.request(`/api/attachments/${id}`, { redirect: "manual" }))
        .status,
    ).toBe(302);
    expect(await cleanAttachment(id, "deleted")).toBe(false);
    const audit = await db.query.auditLogTable.findFirst({
      where: eq(schema.auditLogTable.action, "attachment.restored"),
    });
    expect(audit?.after).toMatchObject({
      attachmentId: id,
      workspaceId: workspace.id,
    });
    expect(JSON.stringify(audit?.after)).not.toContain("shot.png");
  });

  it("AT-7: exact 24-hour expiry, revoked reach, and deleted parents fail closed", async () => {
    const { creator, workspace, project, type } = await setupProject();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);
    const expiredUpload = await uploadPng(app, key, {});
    const expiredId = expiredUpload.presigned?.attachmentId;
    if (!expiredId)
      throw new Error("expired attachment upload did not return an id");
    await db
      .update(schema.attachmentTable)
      .set({
        state: "deleted",
        deletedAt: sql`(clock_timestamp() AT TIME ZONE 'UTC') - interval '24 hours'`,
      })
      .where(eq(schema.attachmentTable.id, expiredId));

    const expiredList = (await (
      await app.request(
        `/api/work-items/${key}/attachments?lifecycle=recoverable`,
      )
    ).json()) as Array<{ id: string }>;
    expect(expiredList.map((row) => row.id)).not.toContain(expiredId);
    const expiredRestore = await app.request(
      `/api/attachments/${expiredId}/restore`,
      { method: "POST" },
    );
    expect(expiredRestore.status).toBe(404);

    const liveUpload = await uploadPng(app, key, {});
    const liveId = liveUpload.presigned?.attachmentId;
    if (!liveId) throw new Error("live attachment upload did not return an id");
    await db
      .update(schema.attachmentTable)
      .set({
        state: "deleted",
        deletedAt: sql`clock_timestamp() AT TIME ZONE 'UTC'`,
      })
      .where(eq(schema.attachmentTable.id, liveId));
    const [item] = await db
      .select({ id: schema.workItemTable.id })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    if (!item) throw new Error("recovery fixture work item missing");

    const actor = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: workspace.id,
      userId: actor.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await grantProjectRole(actor.user.id, project.id, [
      "project:read",
      "work_item:read",
      "attachment:delete_own",
    ]);
    const [actorPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, actor.user.id));
    if (!actorPerson) throw new Error("recovery actor person missing");
    const actorUpload = await uploadPng(app, key, {});
    const actorAttachmentId = actorUpload.presigned?.attachmentId;
    if (!actorAttachmentId)
      throw new Error("actor attachment upload did not return an id");
    await db
      .update(schema.attachmentTable)
      .set({
        uploadedBy: actorPerson.id,
        state: "deleted",
        deletedAt: sql`clock_timestamp() AT TIME ZONE 'UTC'`,
      })
      .where(eq(schema.attachmentTable.id, actorAttachmentId));
    mockAuthenticatedSession(actor.user);
    const actorList = (await (
      await app.request(
        `/api/work-items/${key}/attachments?lifecycle=recoverable`,
      )
    ).json()) as Array<{ id: string; canRestore: boolean }>;
    expect(actorList).toContainEqual(
      expect.objectContaining({ id: actorAttachmentId, canRestore: true }),
    );

    const viewer = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: workspace.id,
      userId: viewer.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await grantProjectRole(viewer.user.id, project.id, [
      "project:read",
      "work_item:read",
    ]);
    mockAuthenticatedSession(viewer.user);
    const noRestoreAuthority = await app.request(
      `/api/attachments/${actorAttachmentId}/restore`,
      { method: "POST" },
    );
    expect(noRestoreAuthority.status).toBe(403);

    mockAuthenticatedSession(actor.user);
    await db
      .delete(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, actorPerson.id),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, project.id),
        ),
      );
    const revoked = await app.request(
      `/api/attachments/${actorAttachmentId}/restore`,
      { method: "POST" },
    );
    expect(revoked.status).toBe(404);

    mockAuthenticatedSession(creator);
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.id, item.id));
    const parentDeleted = await app.request(
      `/api/attachments/${liveId}/restore`,
      { method: "POST" },
    );
    expect(parentDeleted.status).toBe(404);
    const stillDeleted = await db.query.attachmentTable.findFirst({
      where: eq(schema.attachmentTable.id, liveId),
    });
    expect(stillDeleted?.state).toBe("deleted");

    // GC's expired-row winner is serialized with restore's row lock; once collection
    // removes the row/object, the route cannot resurrect its metadata.
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: null })
      .where(eq(schema.workItemTable.id, item.id));
    await db
      .update(schema.attachmentTable)
      .set({
        deletedAt: sql`(clock_timestamp() AT TIME ZONE 'UTC') - interval '25 hours'`,
      })
      .where(eq(schema.attachmentTable.id, liveId));
    expect(await cleanAttachment(liveId, "deleted")).toBe(true);
    const afterGc = await app.request(`/api/attachments/${liveId}/restore`, {
      method: "POST",
    });
    expect(afterGc.status).toBe(404);

    // A different workspace cannot address the other tenant's attachment by id.
    const other = await setupProject();
    mockAuthenticatedSession(other.creator);
    const foreign = await app.request(`/api/attachments/${expiredId}/restore`, {
      method: "POST",
    });
    expect(foreign.status).toBe(404);
  });

  it("AT-7: restores a live comment file without widening its audience and refuses a tombstoned comment", async () => {
    const { creator, workspace, project, type } = await setupProject();
    const person = await addPersonForUser(creator.id);
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);
    const comment = await insertComment({
      workspaceId: workspace.id,
      key,
      authorId: person.id,
      visibility: "internal",
    });
    const upload = await uploadPng(app, key, {
      commentId: comment.id,
      customerVisible: true,
    });
    expect(upload.complete?.status).toBe(200);
    const id = upload.presigned?.attachmentId;
    if (!id) throw new Error("comment attachment upload did not return an id");
    await db
      .update(schema.attachmentTable)
      .set({
        state: "deleted",
        deletedAt: sql`clock_timestamp() AT TIME ZONE 'UTC'`,
      })
      .where(eq(schema.attachmentTable.id, id));

    const recoverable = (await (
      await app.request(
        `/api/work-items/${key}/attachments?lifecycle=recoverable`,
      )
    ).json()) as Array<{
      id: string;
      commentId: string | null;
      customerVisible: boolean;
    }>;
    expect(recoverable).toContainEqual(
      expect.objectContaining({
        id,
        commentId: comment.id,
        customerVisible: false,
      }),
    );
    const restored = await app.request(`/api/attachments/${id}/restore`, {
      method: "POST",
    });
    expect(restored.status).toBe(200);
    const saved = await db.query.attachmentTable.findFirst({
      where: eq(schema.attachmentTable.id, id),
    });
    expect(saved).toMatchObject({ state: "ready", customerVisible: false });

    await db
      .update(schema.commentTable)
      .set({ deletedAt: new Date(), body: null })
      .where(eq(schema.commentTable.id, comment.id));
    await db
      .update(schema.attachmentTable)
      .set({
        state: "deleted",
        deletedAt: sql`clock_timestamp() AT TIME ZONE 'UTC'`,
      })
      .where(eq(schema.attachmentTable.id, id));
    const tombstoned = await app.request(`/api/attachments/${id}/restore`, {
      method: "POST",
    });
    expect(tombstoned.status).toBe(404);
    const hiddenRecoverable = (await (
      await app.request(
        `/api/work-items/${key}/attachments?lifecycle=recoverable`,
      )
    ).json()) as Array<{ id: string }>;
    expect(hiddenRecoverable.map((row) => row.id)).not.toContain(id);
  });

  it("AT-7: does not restore an upload that never passed completion checks", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);
    const presign = await app.request(
      `/api/work-items/${key}/attachments/presign`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: "unchecked.png",
          contentType: "image/png",
          size: PNG_BYTES.length,
        }),
      },
    );
    const upload = (await presign.json()) as {
      attachmentId: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    };
    await app.request(upload.uploadUrl, {
      method: "PUT",
      headers: upload.uploadHeaders,
      body: PNG_BYTES,
    });
    await db
      .update(schema.attachmentTable)
      .set({
        state: "deleted",
        deletedAt: sql`clock_timestamp() AT TIME ZONE 'UTC'`,
      })
      .where(eq(schema.attachmentTable.id, upload.attachmentId));

    const response = await app.request(
      `/api/attachments/${upload.attachmentId}/restore`,
      { method: "POST" },
    );
    expect(response.status).toBe(409);
    const row = await db.query.attachmentTable.findFirst({
      where: eq(schema.attachmentTable.id, upload.attachmentId),
    });
    expect(row?.state).toBe("deleted");
  });

  it("AT-7: refuses recovery when the stored object is already missing without exposing its locator", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);
    const upload = await uploadPng(app, key, {});
    expect(upload.complete?.status).toBe(200);
    const id = upload.presigned?.attachmentId;
    if (!id) throw new Error("attachment upload did not return an id");
    const attachment = await db.query.attachmentTable.findFirst({
      where: eq(schema.attachmentTable.id, id),
    });
    if (!attachment) throw new Error("attachment row missing");
    await deleteStorageObject(attachment.objectKey);
    await db
      .update(schema.attachmentTable)
      .set({
        state: "deleted",
        deletedAt: sql`clock_timestamp() AT TIME ZONE 'UTC'`,
      })
      .where(eq(schema.attachmentTable.id, id));

    const response = await app.request(`/api/attachments/${id}/restore`, {
      method: "POST",
    });
    expect(response.status).toBe(409);
    const body = await response.text();
    expect(body).not.toContain(attachment.objectKey);
    const unchanged = await db.query.attachmentTable.findFirst({
      where: eq(schema.attachmentTable.id, id),
    });
    expect(unchanged?.state).toBe("deleted");
  });

  it("AT-9: streams only signature-checked, reachable ready PDFs and audits the preview", async () => {
    const { creator, workspace, project, type } = await setupProject();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);
    const [item] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    if (!item) throw new Error("preview fixture work item missing");

    const pdfBytes = Buffer.from(
      "%PDF-1.4\n%TaskDesk preview fixture\n%%EOF\n",
    );
    const objectKey = `pdf-preview/${randomUUID()}.pdf`;
    await mkdir(path.join(root, "pdf-preview"), { recursive: true });
    await writeFile(path.join(root, objectKey), pdfBytes);
    const ready = requireRow(
      await db
        .insert(schema.attachmentTable)
        .values({
          workspaceId: workspace.id,
          organisationId: project.organisationId,
          workItemId: item.id,
          objectKey,
          filename: "evidence.pdf",
          mimeType: "application/pdf",
          size: pdfBytes.byteLength,
          state: "ready",
          customerVisible: false,
          uploadedBy: null,
        })
        .returning(),
      "ready preview PDF",
    );

    const response = await app.request(`/api/attachments/${ready.id}/preview`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe("attachment");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-length")).toBe(
      String(pdfBytes.byteLength),
    );
    expect(response.headers.get("location")).toBeNull();
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pdfBytes);

    const foreignWorkspaceAdmin = await createWorkspaceMember({
      role: "admin",
    });
    mockAuthenticatedSession(foreignWorkspaceAdmin.user);
    const unreachablePreview = await app.request(
      `/api/attachments/${ready.id}/preview`,
    );
    expect(unreachablePreview.status).toBe(404);
    expect(await unreachablePreview.text()).not.toContain("PDF preview");
    mockAuthenticatedSession(creator);

    const auditRows = await db
      .select({ id: schema.auditLogTable.id })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityId, ready.id),
          eq(schema.auditLogTable.action, "attachment.downloaded"),
        ),
      );
    expect(auditRows).toHaveLength(1);

    const invalidKey = `pdf-preview/${randomUUID()}.pdf`;
    const invalidBytes = Buffer.from("not a PDF document");
    await writeFile(path.join(root, invalidKey), invalidBytes);
    const invalid = requireRow(
      await db
        .insert(schema.attachmentTable)
        .values({
          workspaceId: workspace.id,
          organisationId: project.organisationId,
          workItemId: item.id,
          objectKey: invalidKey,
          filename: "invalid.pdf",
          mimeType: "application/pdf",
          size: invalidBytes.byteLength,
          state: "ready",
          customerVisible: false,
          uploadedBy: null,
        })
        .returning(),
      "invalid preview PDF",
    );
    expect(
      (await app.request(`/api/attachments/${invalid.id}/preview`)).status,
    ).toBe(415);

    const oversized = requireRow(
      await db
        .insert(schema.attachmentTable)
        .values({
          workspaceId: workspace.id,
          organisationId: project.organisationId,
          workItemId: item.id,
          objectKey: `pdf-preview/${randomUUID()}.pdf`,
          filename: "large.pdf",
          mimeType: "application/pdf",
          size: 25 * 1024 * 1024 + 1,
          state: "ready",
          customerVisible: false,
          uploadedBy: null,
        })
        .returning(),
      "oversized preview PDF",
    );
    expect(
      (await app.request(`/api/attachments/${oversized.id}/preview`)).status,
    ).toBe(413);

    await db
      .update(schema.attachmentTable)
      .set({ state: "deleted", deletedAt: new Date() })
      .where(eq(schema.attachmentTable.id, ready.id));
    expect(
      (await app.request(`/api/attachments/${ready.id}/preview`)).status,
    ).toBe(404);
  });
});
