/**
 * PA-12 (review round 2, N4/N5/N13): the workspace hard delete fences every person and
 * organisation the 30-day purge fences (one shared predicate, `utils/legal-hold-scope.ts`), and
 * the stored objects of a hard-deleted workspace are handed to `attachment-gc` through the
 * `attachment_object_gc` queue before their rows cascade away.
 *
 * Every hold case is two-sided: lifting the hold flips the answer, so "held" cannot mean
 * "nothing matched".
 */
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  cleanAttachment,
  collectQueuedAttachmentObjects,
} from "../../apps/api/src/scheduler/attachment-cleanup";
import { queueAttachmentObjectsForWorkspaces } from "../../apps/api/src/utils/attachment-object-queue";
import {
  assertWorkspaceNotUnderLegalHold,
  WorkspaceUnderLegalHoldError,
} from "../../apps/api/src/utils/workspace-legal-hold";
import { deleteWorkspaceRoleDependents } from "../../apps/api/src/workspace/controllers/delete-workspace-role-dependents";
import { buildTenant, type Tenant } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";

const body = { type: "doc", content: [] };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
let root: string;

async function placeHold(scope: "organisation" | "person", scopeId: string) {
  return requireRow(
    await db
      .insert(schema.legalHoldTable)
      .values({
        scope,
        scopeId,
        placedBy: "integration-test",
        reason: "workspace hold scope test",
      })
      .returning(),
    "hold",
  );
}

async function liftHold(id: string) {
  await db
    .update(schema.legalHoldTable)
    .set({ liftedAt: new Date(), liftedBy: "integration-test" })
    .where(eq(schema.legalHoldTable.id, id));
}

async function workspaceIsHeld(t: Tenant): Promise<boolean> {
  return db.transaction(async (tx) => {
    try {
      await assertWorkspaceNotUnderLegalHold(tx, t.workspaceId);
      return false;
    } catch (error) {
      if (error instanceof WorkspaceUnderLegalHoldError) return true;
      throw error;
    }
  });
}

/** A held person with no membership, so only the row under test can fence the workspace. */
async function bystander(t: Tenant) {
  const userId = `user-${randomUUID()}`;
  await db.insert(schema.userTable).values({
    id: userId,
    email: `${userId}@example.com`,
    emailVerified: true,
    name: "Bystander",
  });
  const organisationId = requireRow(
    await db
      .select({ id: schema.personTable.organisationId })
      .from(schema.personTable)
      .where(eq(schema.personTable.id, t.requesterPerson.id)),
    "organisation",
  ).id;
  const person = requireRow(
    await db
      .insert(schema.personTable)
      .values({ userId, organisationId, side: "staff", active: true })
      .returning(),
    "bystander person",
  );
  return { userId, person };
}

async function workspaceRole(t: Tenant) {
  return requireRow(
    await db
      .insert(schema.roleTable)
      .values({
        scope: "workspace",
        workspaceId: t.workspaceId,
        key: `hold-${randomUUID()}`,
        name: "Hold fixture",
        rank: 1,
        capabilities: ["project:read"],
      })
      .returning(),
    "role",
  );
}

async function insertSubmission(
  t: Tenant,
  who: { requesterId: string; claimedBy?: string },
) {
  const requestType = requireRow(
    await db
      .insert(schema.requestTypeTable)
      .values({
        workspaceId: t.workspaceId,
        key: randomUUID(),
        name: "Request",
        group: "Support",
        workItemTypeId: t.type.id,
        formSchema: { fields: [] },
      })
      .returning(),
    "request type",
  );
  const version = requireRow(
    await db
      .insert(schema.requestTypeVersionTable)
      .values({
        workspaceId: t.workspaceId,
        requestTypeId: requestType.id,
        number: 1,
        formSchema: { fields: [] },
        workItemTypeId: t.type.id,
      })
      .returning(),
    "request version",
  );
  const organisationId = requireRow(
    await db
      .select({ id: schema.workspaceTable.organisationId })
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, t.workspaceId)),
    "workspace",
  ).id;
  return requireRow(
    await db
      .insert(schema.submissionTable)
      .values({
        organisationId,
        requesterId: who.requesterId,
        claimedBy: who.claimedBy,
        claimedAt: who.claimedBy ? new Date() : undefined,
        requestTypeId: requestType.id,
        requestTypeVersionId: version.id,
        formData: {},
        state: "new",
        submittedAt: new Date(),
      })
      .returning(),
    "submission",
  );
}

async function expectHeldThenFree(t: Tenant, personId: string) {
  expect(await workspaceIsHeld(t)).toBe(false);
  const hold = await placeHold("person", personId);
  expect(await workspaceIsHeld(t)).toBe(true);
  await liftHold(hold.id);
  expect(await workspaceIsHeld(t)).toBe(false);
}

describe("workspace hard delete fences the same people as the purge (N4)", () => {
  beforeEach(() => resetTestDatabase());

  it("a held request participant fences the workspace", async () => {
    const t = await buildTenant("ws-hold-participant");
    const by = await bystander(t);
    await db.insert(schema.requestParticipantTable).values({
      workItemId: t.workItem.id,
      personId: by.person.id,
      addedBy: t.requesterPerson.id,
    });
    await expectHeldThenFree(t, by.person.id);
  });

  it("the person who added a request participant fences the workspace", async () => {
    const t = await buildTenant("ws-hold-adder");
    const by = await bystander(t);
    await db.insert(schema.requestParticipantTable).values({
      workItemId: t.workItem.id,
      personId: t.requesterPerson.id,
      addedBy: by.person.id,
    });
    await expectHeldThenFree(t, by.person.id);
  });

  it("a held legacy task assignee (a raw user id) fences the workspace", async () => {
    const t = await buildTenant("ws-hold-legacy-task");
    const by = await bystander(t);
    const [column] = await db
      .select()
      .from(schema.columnTable)
      .where(eq(schema.columnTable.projectId, t.project.id))
      .limit(1);
    if (!column) throw new Error("expected a project column");
    await db.insert(schema.taskTable).values({
      projectId: t.project.id,
      title: "Legacy task",
      description: "d",
      priority: "medium",
      status: column.slug,
      columnId: column.id,
      number: 1,
      position: 1,
      userId: by.userId,
    });
    await expectHeldThenFree(t, by.person.id);
  });

  it("a held comment deleter fences the workspace", async () => {
    const t = await buildTenant("ws-hold-comment-deleter");
    const by = await bystander(t);
    await db.insert(schema.commentTable).values({
      workspaceId: t.workspaceId,
      workItemId: t.workItem.id,
      authorId: t.requesterPerson.id,
      // comment.deleted_by holds a USER id in production (M9); the predicate resolves it.
      deletedBy: by.userId,
      actorType: "person",
      body,
      visibility: "internal",
    });
    await expectHeldThenFree(t, by.person.id);
  });

  it("a held watcher still fences the workspace", async () => {
    const t = await buildTenant("ws-hold-watcher");
    const by = await bystander(t);
    await db.insert(schema.watcherTable).values({
      workItemId: t.workItem.id,
      personId: by.person.id,
      source: "explicit",
    });
    await expectHeldThenFree(t, by.person.id);
  });
  it("a held comment version editor (a user id, M9) fences the workspace", async () => {
    const t = await buildTenant("ws-hold-comment-editor");
    const by = await bystander(t);
    const comment = requireRow(
      await db
        .insert(schema.commentTable)
        .values({
          workspaceId: t.workspaceId,
          workItemId: t.workItem.id,
          authorId: t.requesterPerson.id,
          actorType: "person",
          body,
          visibility: "internal",
        })
        .returning(),
      "comment",
    );
    await db.insert(schema.commentVersionTable).values({
      commentId: comment.id,
      number: 1,
      body,
      editedBy: by.userId,
    });
    await expectHeldThenFree(t, by.person.id);
  });

  it("a held submission requester fences the workspace (M8)", async () => {
    const t = await buildTenant("ws-hold-sub-requester");
    const by = await bystander(t);
    await insertSubmission(t, { requesterId: by.person.id });
    await expectHeldThenFree(t, by.person.id);
  });

  it("a held submission claimer fences the workspace (M8)", async () => {
    const t = await buildTenant("ws-hold-sub-claimer");
    const by = await bystander(t);
    await insertSubmission(t, {
      requesterId: t.requesterPerson.id,
      claimedBy: by.person.id,
    });
    await expectHeldThenFree(t, by.person.id);
  });

  it("a held uploader of a submission attachment fences the workspace (M8)", async () => {
    const t = await buildTenant("ws-hold-sub-uploader");
    const by = await bystander(t);
    const submission = await insertSubmission(t, {
      requesterId: t.requesterPerson.id,
    });
    await db.insert(schema.attachmentTable).values({
      workspaceId: t.workspaceId,
      workItemId: null,
      submissionId: submission.id,
      objectKey: `ws/${randomUUID()}/sub.png`,
      filename: "sub.png",
      mimeType: "image/png",
      size: PNG.length,
      state: "ready",
      customerVisible: false,
      uploadedBy: by.person.id,
    });
    await expectHeldThenFree(t, by.person.id);
  });

  it("a person known only through a workspace-scoped membership fences the workspace (M8)", async () => {
    const t = await buildTenant("ws-hold-membership-only");
    const by = await bystander(t);
    const role = await workspaceRole(t);
    await db.insert(schema.membershipTable).values({
      personId: by.person.id,
      scope: "workspace",
      scopeId: t.workspaceId,
      roleId: role.id,
    });
    await expectHeldThenFree(t, by.person.id);
  });

  it("a person known only through a project-scoped membership grant fences the workspace (M8)", async () => {
    const t = await buildTenant("ws-hold-grant-only");
    const by = await bystander(t);
    const role = await workspaceRole(t);
    await db.insert(schema.membershipGrantTable).values({
      personId: by.person.id,
      scope: "project",
      scopeId: t.project.id,
      roleId: role.id,
      sourceKind: "direct",
      directOrigin: "project_creator",
    });
    await expectHeldThenFree(t, by.person.id);
  });

  it("a membership of ANOTHER workspace does not fence this one (M8 control)", async () => {
    const t = await buildTenant("ws-hold-membership-other");
    const other = await buildTenant("ws-hold-membership-other-b");
    const by = await bystander(t);
    const role = await workspaceRole(other);
    await db.insert(schema.membershipTable).values({
      personId: by.person.id,
      scope: "workspace",
      scopeId: other.workspaceId,
      roleId: role.id,
    });
    await placeHold("person", by.person.id);
    expect(await workspaceIsHeld(t)).toBe(false);
    expect(await workspaceIsHeld(other)).toBe(true);
  });
});

describe("workspace hard delete hands attachment objects to attachment-gc (N5)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-ws-gc-"));
    vi.stubEnv("TASKDESK_STORAGE_FILESYSTEM_ROOT", root);
    vi.stubEnv("TASKDESK_STORAGE_DRIVER", "filesystem");
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  async function attach(t: Tenant, objectKey: string) {
    await db.insert(schema.attachmentTable).values({
      workspaceId: t.workspaceId,
      workItemId: t.workItem.id,
      objectKey,
      filename: "f.png",
      mimeType: "image/png",
      size: PNG.length,
      state: "ready",
      customerVisible: false,
    });
    await mkdir(path.dirname(path.join(root, objectKey)), { recursive: true });
    await writeFile(path.join(root, objectKey), PNG);
  }

  const queued = async () =>
    (
      await db.execute<{ object_key: string }>(
        sql`SELECT object_key FROM attachment_object_gc ORDER BY object_key`,
      )
    ).rows.map((row) => row.object_key);

  async function hardDeleteWorkspace(t: Tenant) {
    await db.transaction(async (tx) => {
      await deleteWorkspaceRoleDependents(tx, [t.workspaceId]);
      await tx
        .delete(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, t.workspaceId));
    });
  }

  it("queues every object key in the delete transaction and the gc then removes the files", async () => {
    const t = await buildTenant("ws-gc-queue");
    const a = `ws/${randomUUID()}/a.png`;
    const b = `ws/${randomUUID()}/b.png`;
    await attach(t, a);
    await attach(t, b);

    await hardDeleteWorkspace(t);

    expect(
      await db
        .select()
        .from(schema.attachmentTable)
        .where(eq(schema.attachmentTable.workspaceId, t.workspaceId)),
    ).toHaveLength(0);
    expect(await queued()).toEqual([a, b].sort());
    // The files are still there: only the gc may remove them.
    expect(await readFile(path.join(root, a))).toEqual(PNG);

    expect(await collectQueuedAttachmentObjects()).toMatchObject({
      scanned: 2,
      deleted: 2,
      degraded: false,
    });
    await expect(readFile(path.join(root, a))).rejects.toThrow();
    await expect(readFile(path.join(root, b))).rejects.toThrow();
    expect(await queued()).toEqual([]);
  });

  it("a rolled-back delete queues nothing", async () => {
    const t = await buildTenant("ws-gc-rollback");
    await attach(t, `ws/${randomUUID()}/c.png`);
    await expect(
      db.transaction(async (tx) => {
        await queueAttachmentObjectsForWorkspaces(tx, [t.workspaceId]);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await queued()).toEqual([]);
  });

  it("never removes an object a surviving row still names", async () => {
    const t = await buildTenant("ws-gc-shared");
    const other = await buildTenant("ws-gc-shared-other");
    const key = `ws/${randomUUID()}/shared.png`;
    await attach(t, key);
    await attach(other, key);

    await hardDeleteWorkspace(t);
    expect(await collectQueuedAttachmentObjects()).toMatchObject({
      scanned: 1,
      deleted: 0,
      retained: 1,
    });
    expect(await readFile(path.join(root, key))).toEqual(PNG);
    expect(await queued()).toEqual([]);
  });
});

describe("attachment-gc re-checks the shared hold predicate and shares by live rows (N13)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-gc-hold-"));
    vi.stubEnv("TASKDESK_STORAGE_FILESYSTEM_ROOT", root);
    vi.stubEnv("TASKDESK_STORAGE_DRIVER", "filesystem");
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000);
  async function deletedAttachment(
    t: Tenant,
    objectKey = `gc/${randomUUID()}/x.png`,
  ) {
    const row = requireRow(
      await db
        .insert(schema.attachmentTable)
        .values({
          workspaceId: t.workspaceId,
          workItemId: t.workItem.id,
          objectKey,
          filename: "x.png",
          mimeType: "image/png",
          size: PNG.length,
          state: "deleted",
          deletedAt: ago(25),
          customerVisible: false,
        })
        .returning(),
      "attachment",
    );
    await mkdir(path.dirname(path.join(root, objectKey)), { recursive: true });
    await writeFile(path.join(root, objectKey), PNG);
    return row;
  }

  it("a hold on a request participant of a purge-released item, placed after release, keeps the object", async () => {
    const t = await buildTenant("gc-hold-participant");
    // The purge soft-deletes the item before releasing its attachments to the gc.
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: ago(24 * 31) })
      .where(eq(schema.workItemTable.id, t.workItem.id));
    await db.insert(schema.requestParticipantTable).values({
      workItemId: t.workItem.id,
      personId: t.approverPerson.id,
      addedBy: t.requesterPerson.id,
    });
    const row = await deletedAttachment(t);
    const hold = await placeHold("person", t.approverPerson.id);
    expect(await cleanAttachment(row.id, "deleted")).toBe(false);
    expect(await readFile(path.join(root, row.objectKey))).toEqual(PNG);
    await liftHold(hold.id);
    expect(await cleanAttachment(row.id, "deleted")).toBe(true);
  });

  it("a hold on a participant does not fence a single deleted attachment of a live item", async () => {
    const t = await buildTenant("gc-live-item");
    await db.insert(schema.requestParticipantTable).values({
      workItemId: t.workItem.id,
      personId: t.approverPerson.id,
      addedBy: t.requesterPerson.id,
    });
    const row = await deletedAttachment(t);
    await placeHold("person", t.approverPerson.id);
    expect(await cleanAttachment(row.id, "deleted")).toBe(true);
  });

  it("two deleted rows sharing an object collect together; the object goes with the last", async () => {
    const t = await buildTenant("gc-shared-deleted");
    const first = await deletedAttachment(t);
    const second = await deletedAttachment(t, first.objectKey);
    expect(await cleanAttachment(first.id, "deleted")).toBe(true);
    expect(await cleanAttachment(second.id, "deleted")).toBe(true);
    await expect(readFile(path.join(root, first.objectKey))).rejects.toThrow();
  });

  it("a live row sharing the object keeps it; a held deleted sibling keeps it too", async () => {
    const t = await buildTenant("gc-shared-live");
    const first = await deletedAttachment(t);
    const live = await deletedAttachment(t, first.objectKey);
    await db
      .update(schema.attachmentTable)
      .set({ state: "ready", deletedAt: null })
      .where(eq(schema.attachmentTable.id, live.id));
    expect(await cleanAttachment(first.id, "deleted")).toBe(false);
    await db
      .update(schema.attachmentTable)
      .set({ state: "deleted", deletedAt: ago(25) })
      .where(eq(schema.attachmentTable.id, live.id));
    await db
      .update(schema.attachmentTable)
      .set({ uploadedBy: t.approverPerson.id })
      .where(eq(schema.attachmentTable.id, live.id));
    const hold = await placeHold("person", t.approverPerson.id);
    expect(await cleanAttachment(first.id, "deleted")).toBe(false);
    await liftHold(hold.id);
    expect(await cleanAttachment(first.id, "deleted")).toBe(true);
  });
});
