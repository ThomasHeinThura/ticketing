import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import deleteAccountData from "../../apps/api/src/user/controllers/delete-account-data";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";
import { plantLegacyMembershipRole } from "./helpers/organization-http";

async function addMember(workspaceId: string, role: string) {
  const userId = `user-${randomUUID()}`;

  const user = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: userId,
        email: `${userId}@example.com`,
        emailVerified: true,
        name: "Other Member",
      })
      .returning(),
    "user",
  );

  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });

  return user;
}

describe("API integration: account deletion", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("deletes a workspace the account is the only member of", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });

    await deleteAccountData(owner.user.id);

    const workspaces = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, owner.workspace.id));

    expect(workspaces).toHaveLength(0);
  });

  it("refuses to delete while the account is the only owner of a shared workspace", async () => {
    const owner = await createWorkspaceMember({
      role: "owner",
      workspaceName: "Acme",
    });
    await addMember(owner.workspace.id, "member");

    await expect(deleteAccountData(owner.user.id)).rejects.toThrow(
      /only owner of "Acme"/,
    );

    const workspaces = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, owner.workspace.id));

    expect(workspaces).toHaveLength(1);
  });

  it("refuses when the only OTHER 'owner' is a role merely NAMED \"owner,x\" -- ownerCount must be exact", async () => {
    // THE COVERAGE GAP THIS CLOSES, and it was found in the fix's own review.
    //
    // `planAccountDeletion` blocks on `isOwner && ownerCount <= 1`, so the two
    // inputs want OPPOSITE readings of a comma-joined role value:
    //   - `isOwner`    wants the INCLUSIVE reading -- a false isOwner skips the block
    //   - `ownerCount` wants the EXACT reading -- OVER-counting also skips the block
    //
    // Deriving `ownerCount` with the inclusive `hasOwnerRole` counted a member
    // holding a role merely NAMED "owner,x" as a second owner, so the genuine
    // sole owner's deletion stopped being blocked and the workspace was
    // orphaned. An independent Opus reviewer measured exactly that:
    // `realOwnersAfter = []`.
    //
    // The fix uses `holdsOwnerExactly` for the count. **It had NO coverage** --
    // reverting it to `hasOwnerRole` left the entire suite green, which is the
    // class issue #93 tracks. This probe is the witness.
    const owner = await createWorkspaceMember({
      role: "owner",
      workspaceName: "Exactly",
    });
    const impostor = await addMember(owner.workspace.id, "member");

    // A role value that GRANTS owner when read inclusively but is not the
    // literal "owner". Planted rather than written normally: this pins the READ
    // side regardless of how the row arrived, and after issue #82 there is no
    // longer any way for it to arrive through a route -- the organization write
    // boundary refuses the request and migration `0050`'s CHECK constraint
    // refuses the row, so `plantLegacyMembershipRole` (which drops and re-adds
    // the constraint `NOT VALID`) is what a pre-fix deployment's data looks
    // like. That is precisely the case this probe exists for.
    await plantLegacyMembershipRole(owner.workspace.id, impostor.id, "owner,x");

    // Exact counting sees ONE real owner, so the block fires.
    await expect(deleteAccountData(owner.user.id)).rejects.toThrow(
      /only owner of "Exactly"/,
    );

    // And the workspace still has its genuine owner -- the assertion that would
    // have caught the original defect, where this came back empty.
    const realOwnersAfter = await db
      .select({ userId: schema.workspaceUserTable.userId })
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.workspaceId, owner.workspace.id));
    expect(realOwnersAfter.some((row) => row.userId === owner.user.id)).toBe(
      true,
    );
  });

  it("leaves a shared workspace that keeps another owner", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await addMember(owner.workspace.id, "owner");

    await deleteAccountData(owner.user.id);

    const workspaces = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, owner.workspace.id));
    const members = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, owner.user.id));

    expect(workspaces).toHaveLength(1);
    expect(members).toHaveLength(0);
  });

  it("keeps tasks, time entries, and activity of another workspace after the user row is deleted", async () => {
    const host = await createWorkspaceMember({ role: "owner" });
    const guest = await addMember(host.workspace.id, "member");
    const { project } = await createProjectFixture({
      workspaceId: host.workspace.id,
    });

    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          userId: guest.id,
          title: "Assigned to the leaving user",
          status: "to-do",
          priority: "medium",
          number: 1,
          position: 1,
        })
        .returning(),
      "task",
    );

    const timeEntry = requireRow(
      await db
        .insert(schema.timeEntryTable)
        .values({
          taskId: task.id,
          userId: guest.id,
          startTime: new Date(),
          duration: 60,
        })
        .returning(),
      "timeEntry",
    );

    const activity = requireRow(
      await db
        .insert(schema.activityTable)
        .values({
          taskId: task.id,
          userId: guest.id,
          type: "comment",
          content: "Worth keeping",
        })
        .returning(),
      "activity",
    );

    await deleteAccountData(guest.id);
    await db.delete(schema.userTable).where(eq(schema.userTable.id, guest.id));

    const remainingTask = requireRow(
      await db
        .select()
        .from(schema.taskTable)
        .where(eq(schema.taskTable.id, task.id)),
      "remainingTask",
    );
    const remainingTimeEntry = requireRow(
      await db
        .select()
        .from(schema.timeEntryTable)
        .where(eq(schema.timeEntryTable.id, timeEntry.id)),
      "remainingTimeEntry",
    );
    const remainingActivity = requireRow(
      await db
        .select()
        .from(schema.activityTable)
        .where(eq(schema.activityTable.id, activity.id)),
      "remainingActivity",
    );

    expect(remainingTask.title).toBe("Assigned to the leaving user");
    expect(remainingTask.userId).toBeNull();
    expect(remainingTimeEntry.duration).toBe(60);
    expect(remainingTimeEntry.userId).toBeNull();
    expect(remainingActivity.content).toBe("Worth keeping");
    expect(remainingActivity.userId).toBeNull();
  });

  it("removes the stored avatar with the account", async () => {
    const member = await createWorkspaceMember({ role: "owner" });

    const avatar = requireRow(
      await db
        .insert(schema.userAvatarTable)
        .values({
          userId: member.user.id,
          mimeType: "image/png",
          size: 8,
          data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        })
        .returning(),
      "avatar",
    );

    await db
      .delete(schema.userTable)
      .where(eq(schema.userTable.id, member.user.id));

    const avatars = await db
      .select()
      .from(schema.userAvatarTable)
      .where(eq(schema.userAvatarTable.id, avatar.id));

    expect(avatars).toHaveLength(0);
  });
});

describe("API integration: avatar routes", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("stores an uploaded avatar and serves it back without authentication", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02,
    ]);

    const uploadResponse = await app.request("/api/user/avatar", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentType: "image/png",
        data: png.toString("base64"),
      }),
    });

    expect(uploadResponse.status).toBe(200);
    const avatar = (await uploadResponse.json()) as {
      id: string;
      url: string;
      size: number;
    };
    expect(avatar.url).toBe(`/api/user/avatar/${avatar.id}`);
    expect(avatar.size).toBe(png.length);

    const downloadResponse = await app.request(avatar.url);

    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("content-type")).toBe("image/png");
    expect(downloadResponse.headers.get("x-content-type-options")).toBe(
      "nosniff",
    );
    expect(Buffer.from(await downloadResponse.arrayBuffer())).toEqual(png);
  });

  it("rejects bytes that do not match the declared image type", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request("/api/user/avatar", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentType: "image/png",
        data: Buffer.from("<html></html>").toString("base64"),
      }),
    });

    expect(response.status).toBe(400);
  });

  it("replaces the previous avatar and retires its URL", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const upload = (contentType: string, data: Buffer) =>
      app.request("/api/user/avatar", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contentType,
          data: data.toString("base64"),
        }),
      });

    const first = (await (
      await upload(
        "image/png",
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      )
    ).json()) as { id: string; url: string };

    const second = (await (
      await upload("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0x01]))
    ).json()) as { id: string; url: string };

    expect(second.id).not.toBe(first.id);
    expect((await app.request(first.url)).status).toBe(404);
    expect((await app.request(second.url)).status).toBe(200);

    const rows = await db
      .select()
      .from(schema.userAvatarTable)
      .where(eq(schema.userAvatarTable.userId, member.user.id));
    expect(rows).toHaveLength(1);
  });

  it("deletes the avatar of the current user", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    await app.request("/api/user/avatar", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentType: "image/png",
        data: Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]).toString("base64"),
      }),
    });

    const response = await app.request("/api/user/avatar", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true });

    const rows = await db
      .select()
      .from(schema.userAvatarTable)
      .where(eq(schema.userAvatarTable.userId, member.user.id));
    expect(rows).toHaveLength(0);
  });

  it("requires authentication to upload an avatar", async () => {
    const { app } = createApp();

    const response = await app.request("/api/user/avatar", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentType: "image/png", data: "" }),
    });

    expect(response.status).toBe(401);
  });
});
