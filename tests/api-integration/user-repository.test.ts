import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  deleteAvatarByUserId,
  deleteUserMemberships,
  deleteWorkflowsInWorkspaces,
  deleteWorkspacesByIds,
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

    const members = await listMembersOfWorkspaces(db, a.user.id);
    expect(new Set(members.map((row) => row.workspaceId))).toEqual(
      new Set([a.workspace.id, b.workspace.id]),
    );
    expect(members).toHaveLength(3);
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

  it("listMembersOfWorkspaces returns the members of every named workspace in one call", async () => {
    // A user who belongs to two workspaces, each with another member: account deletion
    // planning counts members and owners per workspace from this one result, so a listing
    // truncated to the first workspace would let a sole owner orphan the second.
    const a = await createWorkspaceMember({ role: "owner" });
    const b = await createWorkspaceMember({ role: "owner" });
    const c = await createWorkspaceMember({ role: "owner" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: b.workspace.id,
      userId: a.user.id,
      role: "member",
      joinedAt: new Date(),
    });

    const members = await listMembersOfWorkspaces(db, a.user.id);
    const perWorkspace = new Map<string, number>();
    for (const row of members) {
      perWorkspace.set(
        row.workspaceId,
        (perWorkspace.get(row.workspaceId) ?? 0) + 1,
      );
    }
    expect(perWorkspace.get(a.workspace.id)).toBe(1);
    expect(perWorkspace.get(b.workspace.id)).toBe(2);
    expect(perWorkspace.has(c.workspace.id)).toBe(false);
    expect(perWorkspace.size).toBe(2);
  });

  it("account-deletion writes require both planned IDs and the subject's current membership", async () => {
    const subject = await createWorkspaceMember({ role: "owner" });
    const foreign = await createWorkspaceMember({ role: "owner" });
    await db.insert(schema.workflowTable).values({
      id: `workflow-${subject.workspace.id}`,
      key: `WF-SUBJECT-${subject.workspace.id}`,
      name: "Subject workflow",
      workspaceId: subject.workspace.id,
      createdAt: new Date(),
    });
    await db.insert(schema.workflowTable).values({
      id: `workflow-${foreign.workspace.id}`,
      key: `WF-FOREIGN-${foreign.workspace.id}`,
      name: "Foreign workflow",
      workspaceId: foreign.workspace.id,
      createdAt: new Date(),
    });

    await db.transaction(async (tx) => {
      await deleteWorkflowsInWorkspaces(tx, subject.user.id, [
        subject.workspace.id,
        foreign.workspace.id,
      ]);
      await deleteWorkspacesByIds(tx, subject.user.id, [
        subject.workspace.id,
        foreign.workspace.id,
      ]);
    });

    expect(
      await db
        .select({ id: schema.workspaceTable.id })
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, subject.workspace.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: schema.workspaceTable.id })
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, foreign.workspace.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select({ id: schema.workflowTable.id })
        .from(schema.workflowTable)
        .where(eq(schema.workflowTable.id, `workflow-${foreign.workspace.id}`)),
    ).toHaveLength(1);
  });

  it("lockUserRow holds a row lock that a second connection cannot take until the transaction ends", async () => {
    const a = await createWorkspaceMember();
    await db.transaction(async (holder) => {
      expect(await lockUserRow(holder, a.user.id)).toEqual([{ id: a.user.id }]);
      expect(await userRowLockedByOther(a.user.id)).toBe(true);
    });
    expect(await userRowLockedByOther(a.user.id)).toBe(false);
  });
});

/** True when another pooled connection cannot immediately lock the user row (SQLSTATE 55P03). */
async function userRowLockedByOther(userId: string) {
  try {
    await db.transaction(async (other) => {
      await other.execute(
        sql`select 1 from "user" where id = ${userId} for update nowait`,
      );
    });
    return false;
  } catch (error) {
    const chain: string[] = [];
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
      chain.push(
        String((e as { code?: unknown }).code ?? ""),
        String((e as { message?: unknown }).message ?? ""),
      );
    }
    const text = chain.join(" ");
    if (text.includes("55P03") || text.includes("could not obtain lock")) {
      return true;
    }
    throw error;
  }
}
