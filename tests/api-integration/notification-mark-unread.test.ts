import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import getNotifications from "../../apps/api/src/notification/controllers/get-notifications";
import markAllNotificationsAsRead from "../../apps/api/src/notification/controllers/mark-all-notifications-as-read";
import markNotificationAsRead from "../../apps/api/src/notification/controllers/mark-notification-as-read";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

async function workspaceNotification() {
  const { user, workspace } = await createWorkspaceMember({ role: "owner" });
  const row = requireRow(
    await db
      .insert(schema.notificationTable)
      .values({
        userId: user.id,
        title: "Workspace created",
        content: "Workspace notice",
        type: "workspace_created",
        resourceType: "workspace",
        resourceId: workspace.id,
      })
      .returning(),
    "workspace notification",
  );
  return { user, workspace, row };
}

const stored = async (id: string) =>
  requireRow(
    await db
      .select({
        isRead: schema.notificationTable.isRead,
        readAt: schema.notificationTable.readAt,
      })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.id, id)),
    "stored notification",
  );

describe("NO-15 mark read and mark unread", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("stamps read_at on read and clears it again on unread", async () => {
    const { user, row } = await workspaceNotification();
    await markNotificationAsRead(row.id, user.id);
    const read = await stored(row.id);
    expect(read.isRead).toBe(true);
    expect(read.readAt).toBeInstanceOf(Date);

    // Reading an already-read row keeps its original read time.
    await markNotificationAsRead(row.id, user.id);
    expect((await stored(row.id)).readAt?.getTime()).toBe(
      read.readAt?.getTime(),
    );

    const unread = await markNotificationAsRead(row.id, user.id, "unread");
    expect(unread.isRead).toBe(false);
    expect(await stored(row.id)).toEqual({ isRead: false, readAt: null });
  });

  it("mark-all-read also stamps read_at", async () => {
    const { user, row } = await workspaceNotification();
    await markAllNotificationsAsRead(user.id);
    const read = await stored(row.id);
    expect(read.isRead).toBe(true);
    expect(read.readAt).toBeInstanceOf(Date);
  });

  it("another user's notification is not found, and nothing changes", async () => {
    const { row } = await workspaceNotification();
    const other = await createWorkspaceMember({ role: "owner" });
    await expect(
      markNotificationAsRead(row.id, other.user.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      markNotificationAsRead(row.id, other.user.id, "unread"),
    ).rejects.toMatchObject({ status: 404 });
    expect(await stored(row.id)).toEqual({ isRead: false, readAt: null });
  });

  it("an unreachable resource is not found for mark-unread, like mark-read", async () => {
    const { user, workspace, row } = await workspaceNotification();
    await db
      .delete(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.userId, user.id),
          eq(schema.workspaceUserTable.workspaceId, workspace.id),
        ),
      );
    await expect(
      markNotificationAsRead(row.id, user.id, "unread"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("the list carries kind, readAt and no work item key for a workspace notification", async () => {
    const { user, row } = await workspaceNotification();
    await markNotificationAsRead(row.id, user.id);
    const [listed] = (await getNotifications(user.id, true)).filter(
      (n) => n.id === row.id,
    );
    expect(listed).toMatchObject({
      id: row.id,
      kind: null,
      workItemKey: null,
    });
    expect(listed?.readAt).toBeInstanceOf(Date);
  });
});
