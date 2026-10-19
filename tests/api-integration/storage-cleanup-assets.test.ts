/**
 * #580 batch 3: asset clean-up behaviour once its statements live in the storage
 * repository -- an asset is removed only when no description, task comment or activity of
 * the same task still references it, only that task's assets are considered, a failed
 * storage delete keeps its row, and `getTaskAssetKeys` runs on the handle it is given.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";

const storage = vi.hoisted(() => ({
  deleteStorageObject: vi.fn(async (_key: string) => {}),
}));
vi.mock("../../apps/api/src/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../apps/api/src/storage")>()),
  deleteStorageObject: storage.deleteStorageObject,
}));

import db, { schema } from "../../apps/api/src/database";
import {
  deleteOrphanedAssets,
  getTaskAssetKeys,
} from "../../apps/api/src/storage/cleanup-assets";
import { lockTaskAndAssertProjectLiveForIdentity } from "../../apps/api/src/task/assert-task-project-live";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectAccessForWorkspaceRole,
  requireRow,
} from "./helpers/fixtures";

async function seed() {
  const member = await createWorkspaceMember({ role: "owner" });
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  await grantProjectAccessForWorkspaceRole(
    member.user.id,
    member.workspace.id,
    "owner",
  );
  const identity = await resolveIdentity({
    userId: member.user.id,
    credential: "session",
  });
  if (!identity) throw new Error("member session identity should resolve");
  const task = async (number: number, description = "") =>
    requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          title: `Task ${number}`,
          description,
          status: "to-do",
          columnId: columns.todo.id,
          priority: "medium",
          number,
          position: number,
        })
        .returning(),
      "task",
    );
  const asset = async (taskId: string, id: string, objectKey: string) =>
    requireRow(
      await db
        .insert(schema.assetTable)
        .values({
          id,
          workspaceId: member.workspace.id,
          projectId: project.id,
          taskId,
          objectKey,
          filename: `${id}.png`,
          mimeType: "image/png",
          size: 1,
        })
        .returning(),
      "asset",
    );
  return { member, identity, project, task, asset };
}

const url = (id: string) => `![x](/api/asset/${id})`;
const remaining = async () =>
  (await db.select({ id: schema.assetTable.id }).from(schema.assetTable))
    .map((r) => r.id)
    .sort();

async function clean(
  identity: NonNullable<Awaited<ReturnType<typeof resolveIdentity>>>,
  taskId: string,
  oldContent: string | null | undefined,
  newContent: string | null | undefined,
) {
  await db.transaction(async (tx) => {
    await lockTaskAndAssertProjectLiveForIdentity(tx, taskId, identity);
    await deleteOrphanedAssets(tx, identity, oldContent, newContent, {
      taskId,
    });
  });
}

describe("API integration: asset clean-up through the storage repository", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    storage.deleteStorageObject.mockReset();
    storage.deleteStorageObject.mockResolvedValue(undefined);
  });

  it("deletes an orphaned asset's object and row, scoped to the task", async () => {
    const { identity, task, asset } = await seed();
    const t1 = await task(1);
    const t2 = await task(2);
    await asset(t1.id, "orphan1", "key/orphan1");
    await asset(t2.id, "orphan1b", "key/other-task");

    await clean(identity, t1.id, url("orphan1"), "");

    expect(storage.deleteStorageObject).toHaveBeenCalledTimes(1);
    expect(storage.deleteStorageObject).toHaveBeenCalledWith("key/orphan1");
    expect(await remaining()).toEqual(["orphan1b"]);

    // An id that belongs to another task is never touched through this task's scope.
    await clean(identity, t1.id, url("orphan1b"), "");
    expect(await remaining()).toEqual(["orphan1b"]);
  });

  it("keeps an asset still referenced by the description, a task comment or an activity of that task", async () => {
    const { identity, member, task, asset } = await seed();
    const t = await task(1, `desc ${url("indesc")}`);
    await asset(t.id, "indesc", "key/indesc");
    await asset(t.id, "incomment", "key/incomment");
    await asset(t.id, "inactivity", "key/inactivity");
    await asset(t.id, "free", "key/free");
    await db.insert(schema.taskCommentTable).values({
      taskId: t.id,
      userId: member.user.id,
      content: url("incomment"),
    });
    await db.insert(schema.taskActivityTable).values({
      taskId: t.id,
      type: "comment",
      userId: member.user.id,
      content: url("inactivity"),
    });

    await clean(
      identity,
      t.id,
      [url("indesc"), url("incomment"), url("inactivity"), url("free")].join(
        " ",
      ),
      "",
    );

    expect(await remaining()).toEqual(["inactivity", "incomment", "indesc"]);
    expect(storage.deleteStorageObject).toHaveBeenCalledTimes(1);
    expect(storage.deleteStorageObject).toHaveBeenCalledWith("key/free");
  });

  it("ignores references that live in another task", async () => {
    const { identity, member, task, asset } = await seed();
    const t1 = await task(1);
    const t2 = await task(2, url("mine"));
    await asset(t1.id, "mine", "key/mine");
    await db.insert(schema.taskCommentTable).values({
      taskId: t2.id,
      userId: member.user.id,
      content: url("mine"),
    });

    await clean(identity, t1.id, url("mine"), "");
    expect(await remaining()).toEqual([]);
  });

  it("keeps the row when the storage delete fails, and does nothing when no id was removed", async () => {
    const { identity, task, asset } = await seed();
    const t = await task(1);
    await asset(t.id, "stuck", "key/stuck");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    storage.deleteStorageObject.mockRejectedValueOnce(new Error("s3 down"));

    await clean(identity, t.id, url("stuck"), "");
    expect(await remaining()).toEqual(["stuck"]);

    storage.deleteStorageObject.mockClear();
    await clean(identity, t.id, url("stuck"), url("stuck"));
    expect(storage.deleteStorageObject).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("getTaskAssetKeys lists the task's keys and honours a transaction handle", async () => {
    const { identity, task, asset } = await seed();
    const t1 = await task(1);
    const t2 = await task(2);
    await asset(t1.id, "a1", "key/a1");
    await asset(t2.id, "a2", "key/a2");

    expect(await getTaskAssetKeys(db, identity, t1.id)).toEqual(["key/a1"]);

    const rollback = new Error("rollback");
    await expect(
      db.transaction(async (tx) => {
        await tx
          .update(schema.assetTable)
          .set({ taskId: t1.id })
          .where(eq(schema.assetTable.id, "a2"));
        expect((await getTaskAssetKeys(tx, identity, t1.id)).sort()).toEqual([
          "key/a1",
          "key/a2",
        ]);
        expect(await getTaskAssetKeys(db, identity, t1.id)).toEqual(["key/a1"]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it("does not delete an asset or call storage after persisted project reach is revoked", async () => {
    const { identity, project, task, asset } = await seed();
    const t = await task(1);
    await asset(t.id, "revoked", "key/revoked");
    await db
      .delete(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, identity.personId),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, project.id),
        ),
      );

    await deleteOrphanedAssets(db, identity, url("revoked"), "", {
      taskId: t.id,
    });

    expect(storage.deleteStorageObject).not.toHaveBeenCalled();
    expect(await remaining()).toEqual(["revoked"]);
    expect(await getTaskAssetKeys(db, identity, t.id)).toEqual([]);
  });
});
