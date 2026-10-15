/**
 * #580 batch 3: asset clean-up behaviour once its statements live in the storage
 * repository -- an asset is removed only when no description, task comment or activity of
 * the same task still references it, only that task's assets are considered, a failed
 * storage delete keeps its row, and `getTaskAssetKeys` runs on the handle it is given.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

async function seed() {
  const member = await createWorkspaceMember({ role: "owner" });
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
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
  return { member, task, asset };
}

const url = (id: string) => `![x](/api/asset/${id})`;
const remaining = async () =>
  (await db.select({ id: schema.assetTable.id }).from(schema.assetTable))
    .map((r) => r.id)
    .sort();

describe("API integration: asset clean-up through the storage repository", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    storage.deleteStorageObject.mockReset();
    storage.deleteStorageObject.mockResolvedValue(undefined);
  });

  it("deletes an orphaned asset's object and row, scoped to the task", async () => {
    const { task, asset } = await seed();
    const t1 = await task(1);
    const t2 = await task(2);
    await asset(t1.id, "orphan1", "key/orphan1");
    await asset(t2.id, "orphan1b", "key/other-task");

    await deleteOrphanedAssets(url("orphan1"), "", { taskId: t1.id });

    expect(storage.deleteStorageObject).toHaveBeenCalledTimes(1);
    expect(storage.deleteStorageObject).toHaveBeenCalledWith("key/orphan1");
    expect(await remaining()).toEqual(["orphan1b"]);

    // An id that belongs to another task is never touched through this task's scope.
    await deleteOrphanedAssets(url("orphan1b"), "", { taskId: t1.id });
    expect(await remaining()).toEqual(["orphan1b"]);
  });

  it("keeps an asset still referenced by the description, a task comment or an activity of that task", async () => {
    const { member, task, asset } = await seed();
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

    await deleteOrphanedAssets(
      [url("indesc"), url("incomment"), url("inactivity"), url("free")].join(
        " ",
      ),
      "",
      { taskId: t.id },
    );

    expect(await remaining()).toEqual(["inactivity", "incomment", "indesc"]);
    expect(storage.deleteStorageObject).toHaveBeenCalledTimes(1);
    expect(storage.deleteStorageObject).toHaveBeenCalledWith("key/free");
  });

  it("ignores references that live in another task", async () => {
    const { member, task, asset } = await seed();
    const t1 = await task(1);
    const t2 = await task(2, url("mine"));
    await asset(t1.id, "mine", "key/mine");
    await db.insert(schema.taskCommentTable).values({
      taskId: t2.id,
      userId: member.user.id,
      content: url("mine"),
    });

    await deleteOrphanedAssets(url("mine"), "", { taskId: t1.id });
    expect(await remaining()).toEqual([]);
  });

  it("keeps the row when the storage delete fails, and does nothing when no id was removed", async () => {
    const { task, asset } = await seed();
    const t = await task(1);
    await asset(t.id, "stuck", "key/stuck");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    storage.deleteStorageObject.mockRejectedValueOnce(new Error("s3 down"));

    await deleteOrphanedAssets(url("stuck"), "", { taskId: t.id });
    expect(await remaining()).toEqual(["stuck"]);

    storage.deleteStorageObject.mockClear();
    await deleteOrphanedAssets(url("stuck"), url("stuck"), { taskId: t.id });
    expect(storage.deleteStorageObject).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("getTaskAssetKeys lists the task's keys and honours a transaction handle", async () => {
    const { task, asset } = await seed();
    const t1 = await task(1);
    const t2 = await task(2);
    await asset(t1.id, "a1", "key/a1");
    await asset(t2.id, "a2", "key/a2");

    expect(await getTaskAssetKeys(t1.id)).toEqual(["key/a1"]);

    const rollback = new Error("rollback");
    await expect(
      db.transaction(async (tx) => {
        await tx
          .update(schema.assetTable)
          .set({ taskId: t1.id })
          .where(eq(schema.assetTable.id, "a2"));
        expect((await getTaskAssetKeys(t1.id, tx)).sort()).toEqual([
          "key/a1",
          "key/a2",
        ]);
        expect(await getTaskAssetKeys(t1.id)).toEqual(["key/a1"]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
