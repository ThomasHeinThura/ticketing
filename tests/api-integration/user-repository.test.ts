import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  deleteAvatarByUserId,
  deleteUserMemberships,
  findAvatarById,
  listMembersOfWorkspaces,
  listUserMemberships,
  lockUserRow,
  upsertAvatar,
} from "../../apps/api/src/user/repository";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

describe("user repository (#580)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("upsertAvatar keeps one row per user, rotates its id, and reads/deletes are per id/user", async () => {
    const a = await createWorkspaceMember();
    const b = await createWorkspaceMember();
    const first = await upsertAvatar({
      userId: a.user.id,
      mimeType: "image/png",
      data: Buffer.from([1, 2, 3]),
    });
    const other = await upsertAvatar({
      userId: b.user.id,
      mimeType: "image/png",
      data: Buffer.from([9]),
    });
    const second = await upsertAvatar({
      userId: a.user.id,
      mimeType: "image/jpeg",
      data: Buffer.from([4, 5]),
    });

    expect(second?.id).not.toBe(first?.id);
    expect(await findAvatarById(first?.id ?? "")).toBeUndefined();
    const current = await findAvatarById(second?.id ?? "");
    expect(current).toMatchObject({ mimeType: "image/jpeg", size: 2 });
    expect(Buffer.from(current?.data ?? []).equals(Buffer.from([4, 5]))).toBe(
      true,
    );
    const rows = await db
      .select()
      .from(schema.userAvatarTable)
      .where(eq(schema.userAvatarTable.userId, a.user.id));
    expect(rows).toHaveLength(1);

    const deleted = await deleteAvatarByUserId(a.user.id);
    expect(deleted).toHaveLength(1);
    expect(await deleteAvatarByUserId(a.user.id)).toHaveLength(0);
    // another user's avatar is untouched
    expect((await findAvatarById(other?.id ?? ""))?.size).toBe(1);
  });

  it("account-deletion statements are scoped to the user and the named workspaces", async () => {
    const a = await createWorkspaceMember({ role: "owner" });
    const b = await createWorkspaceMember({ role: "owner" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: b.workspace.id,
      userId: a.user.id,
      role: "member",
      joinedAt: new Date(),
    });

    const memberships = await listUserMemberships(db, a.user.id);
    expect(memberships.map((row) => row.workspaceId).sort()).toEqual(
      [a.workspace.id, b.workspace.id].sort(),
    );

    const members = await listMembersOfWorkspaces(db, [b.workspace.id]);
    expect(members.every((row) => row.workspaceId === b.workspace.id)).toBe(
      true,
    );
    expect(members).toHaveLength(2);
    expect(members[0]?.workspaceName).toBeTruthy();

    await db.transaction(async (tx) => {
      const locked = await lockUserRow(tx, a.user.id);
      expect(locked).toEqual([{ id: a.user.id }]);
      await deleteUserMemberships(tx, a.user.id, [b.workspace.id]);
    });

    // only the named workspace's membership of this user is gone
    expect(
      (await listUserMemberships(db, a.user.id)).map((r) => r.workspaceId),
    ).toEqual([a.workspace.id]);
    expect(
      (await listUserMemberships(db, b.user.id)).map((r) => r.workspaceId),
    ).toEqual([b.workspace.id]);
  });
});
