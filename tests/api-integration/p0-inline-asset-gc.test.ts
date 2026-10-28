/**
 * P0R1-01: editing a description or comment never hard-deletes an embedded image. The asset is
 * marked detached; `attachment-gc` removes object and row only after the recovery window,
 * skips assets under an open legal hold, and a re-reference restores the asset.
 */
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  deleteStorageObject: vi.fn(async (_key: string) => {}),
}));
vi.mock("../../apps/api/src/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../apps/api/src/storage")>()),
  deleteStorageObject: storage.deleteStorageObject,
}));

import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  cleanDetachedAsset,
  collectDetachedAssets,
} from "../../apps/api/src/scheduler/attachment-cleanup";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  json,
  makeApiKey,
  seedLegacy,
  setAmbientHeaders,
  setupWorld,
} from "./helpers/reach-world";

const FULL_SCOPE = {
  project: ["read", "update"],
  task: ["read", "create", "update", "delete"],
  work_item: ["read", "update", "delete", "assign"],
  comment: ["create", "create_internal", "update_own", "delete_own"],
};
const img = (id: string) => `![x](/api/asset/${id})`;

async function arrange() {
  const world = await setupWorld();
  const { app } = createApp();
  const s = await seedLegacy(world, world.projectMember.user.id);
  const asset = async (id: string, taskId = s.taskId) => {
    await db.insert(schema.assetTable).values({
      id,
      workspaceId: world.workspaceId,
      projectId: world.project.id,
      taskId,
      objectKey: `key/${id}`,
      filename: `${id}.png`,
      mimeType: "image/png",
      size: 1,
      createdBy: world.projectMember.user.id,
    });
  };
  const setDescription = (description: string) =>
    db
      .update(schema.taskTable)
      .set({ description })
      .where(eq(schema.taskTable.id, s.taskId));
  return { world, app, s, asset, setDescription };
}

const row = async (id: string) =>
  (
    await db
      .select()
      .from(schema.assetTable)
      .where(eq(schema.assetTable.id, id))
  )[0];
const purgeAudits = (id: string) =>
  db
    .select()
    .from(schema.auditLogTable)
    .where(
      sql`${schema.auditLogTable.action} = 'asset.purged' AND ${schema.auditLogTable.entityId} = ${id}`,
    );
const ageDetached = (id: string, interval = "25 hours") =>
  db.execute(
    sql`UPDATE asset SET detached_at = now() - ${interval}::interval WHERE id = ${id}`,
  );

describe("API integration: inline asset detach, recovery window and GC", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    storage.deleteStorageObject.mockReset();
    storage.deleteStorageObject.mockResolvedValue(undefined);
  });
  afterEach(() => {
    setAmbientHeaders({});
    vi.restoreAllMocks();
  });

  it("a session description edit detaches the image: object and row stay", async () => {
    const { world, app, s, asset, setDescription } = await arrange();
    await asset("img1");
    await setDescription(`see ${img("img1")}`);
    mockAuthenticatedSession(world.projectMember.user);

    const res = await json(app, "PUT", `/api/task/description/${s.taskId}`, {
      description: "no image any more",
    });
    expect(res.status, await res.clone().text()).toBe(200);

    expect(storage.deleteStorageObject).not.toHaveBeenCalled();
    const stored = await row("img1");
    expect(stored).toBeDefined();
    expect(stored?.detachedAt).toBeInstanceOf(Date);
  });

  it("an API-key description edit detaches the image the same way", async () => {
    const { world, app, s, asset, setDescription } = await arrange();
    await asset("imgkey");
    await setDescription(`see ${img("imgkey")}`);
    mockAnonymousSession();
    setAmbientHeaders({
      "x-api-key": await makeApiKey(world.projectMember.user.id, FULL_SCOPE),
    });

    const res = await json(app, "PUT", `/api/task/description/${s.taskId}`, {
      description: "gone",
    });
    expect(res.status, await res.clone().text()).toBe(200);

    expect(storage.deleteStorageObject).not.toHaveBeenCalled();
    expect((await row("imgkey"))?.detachedAt).toBeInstanceOf(Date);
  });

  it("a comment edit detaches (not deletes) and re-adding the image restores it", async () => {
    const { world, app, s, asset } = await arrange();
    await asset("imgc");
    const [comment] = await db
      .insert(schema.taskActivityTable)
      .values({
        taskId: s.taskId,
        type: "comment",
        userId: world.projectMember.user.id,
        content: img("imgc"),
      })
      .returning();
    mockAuthenticatedSession(world.projectMember.user);

    const edit = await json(app, "PUT", "/api/activity/comment", {
      activityId: comment?.id,
      comment: "text only",
    });
    expect(edit.status, await edit.clone().text()).toBe(200);
    expect((await row("imgc"))?.detachedAt).toBeInstanceOf(Date);
    expect(storage.deleteStorageObject).not.toHaveBeenCalled();

    const restore = await json(app, "PUT", "/api/activity/comment", {
      activityId: comment?.id,
      comment: `back ${img("imgc")}`,
    });
    expect(restore.status, await restore.clone().text()).toBe(200);
    expect((await row("imgc"))?.detachedAt).toBeNull();
  });

  it("a description re-reference inside the window restores the asset", async () => {
    const { world, app, s, asset, setDescription } = await arrange();
    await asset("img2");
    await setDescription(img("img2"));
    mockAuthenticatedSession(world.projectMember.user);
    await json(app, "PUT", `/api/task/description/${s.taskId}`, {
      description: "none",
    });
    expect((await row("img2"))?.detachedAt).not.toBeNull();

    const res = await json(app, "PUT", `/api/task/description/${s.taskId}`, {
      description: `again ${img("img2")}`,
    });
    expect(res.status).toBe(200);
    expect((await row("img2"))?.detachedAt).toBeNull();
  });

  it("GC leaves a detached asset inside the recovery window and deletes it after", async () => {
    const { world, s, asset } = await arrange();
    await asset("img3");
    await db.execute(
      sql`UPDATE asset SET detached_at = now() WHERE id = 'img3'`,
    );

    expect(await cleanDetachedAsset("img3")).toBe(false);
    expect(await row("img3")).toBeDefined();
    expect(storage.deleteStorageObject).not.toHaveBeenCalled();

    await ageDetached("img3");
    const outcome = await collectDetachedAssets();
    expect(outcome).toMatchObject({ scanned: 1, deleted: 1, retained: 0 });
    expect(storage.deleteStorageObject).toHaveBeenCalledWith("key/img3");
    expect(await row("img3")).toBeUndefined();
    expect(s.taskId).toBeTruthy();
    // P0R2-02: the collected asset is recorded by id, workspace and project (system actor).
    const audits = await purgeAudits("img3");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: null,
      actorType: "system",
      entityType: "asset",
      entityId: "img3",
      workspaceId: world.workspaceId,
      projectId: world.project.id,
    });
    expect(audits[0]?.before).toMatchObject({
      taskId: s.taskId,
      filename: "img3.png",
      mimeType: "image/png",
      size: 1,
    });
  });

  it("GC keeps the row when the storage delete fails", async () => {
    const { asset } = await arrange();
    await asset("img4");
    await ageDetached("img4");
    storage.deleteStorageObject.mockRejectedValueOnce(new Error("s3 down"));

    const outcome = await collectDetachedAssets();
    expect(outcome.degraded).toBe(true);
    expect(await row("img4")).toBeDefined();
    // The purge record rolls back with the failed storage call.
    expect(await purgeAudits("img4")).toHaveLength(0);
  });

  it("an open legal hold on the uploader blocks GC until it is lifted", async () => {
    const { world, asset } = await arrange();
    await asset("img5");
    await ageDetached("img5");
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, world.projectMember.user.id));
    expect(person?.id).toBeTruthy();
    const [hold] = await db
      .insert(schema.legalHoldTable)
      .values({
        scope: "person",
        scopeId: person?.id ?? "",
        placedBy: "integration-test",
        reason: "asset gc hold",
      })
      .returning();

    expect(await cleanDetachedAsset("img5")).toBe(false);
    expect(storage.deleteStorageObject).not.toHaveBeenCalled();
    expect(await row("img5")).toBeDefined();
    expect(await purgeAudits("img5")).toHaveLength(0);

    await db
      .update(schema.legalHoldTable)
      .set({ liftedAt: new Date(), liftedBy: "integration-test" })
      .where(eq(schema.legalHoldTable.id, hold?.id ?? ""));
    expect(await cleanDetachedAsset("img5")).toBe(true);
    expect(await row("img5")).toBeUndefined();
    expect(await purgeAudits("img5")).toHaveLength(1);
  });

  it("GC restores instead of deleting an asset a comment references again", async () => {
    const { world, s, asset } = await arrange();
    await asset("img6");
    await ageDetached("img6");
    await db.insert(schema.taskActivityTable).values({
      taskId: s.taskId,
      type: "comment",
      userId: world.projectMember.user.id,
      content: img("img6"),
    });

    expect(await cleanDetachedAsset("img6")).toBe(false);
    expect(storage.deleteStorageObject).not.toHaveBeenCalled();
    expect((await row("img6"))?.detachedAt).toBeNull();
  });
});
