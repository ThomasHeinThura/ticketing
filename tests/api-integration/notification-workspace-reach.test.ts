import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { deliverNotification } from "../../apps/api/src/notification-preferences/delivery";
import { getNotificationPreferences } from "../../apps/api/src/notification-preferences/service";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

const emailProvider = vi.hoisted(() => ({
  sendNotificationEmail: vi.fn(async () => undefined),
}));
vi.mock("@taskdesk/email", () => emailProvider);

beforeEach(async () => {
  emailProvider.sendNotificationEmail.mockClear();
  await resetTestDatabase();
});

async function workspaceNotificationFixture() {
  const { user, workspace } = await createWorkspaceMember();
  await db.insert(schema.userNotificationPreferenceTable).values({
    userId: user.id,
    emailEnabled: true,
  });
  await db.insert(schema.userNotificationWorkspaceRuleTable).values({
    userId: user.id,
    workspaceId: workspace.id,
    emailEnabled: true,
  });
  const notification = requireRow(
    await db
      .insert(schema.notificationTable)
      .values({
        userId: user.id,
        title: "Workspace notice",
        content: "Workspace content",
        type: "info",
        resourceId: workspace.id,
        resourceType: "workspace",
      })
      .returning(),
    "workspace notification",
  );
  return { user, workspace, notification };
}

async function revokeWorkspaceMembership(
  userId: string,
  workspaceId: string,
): Promise<void> {
  await db
    .delete(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.userId, userId),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    );
}

describe("notification workspace reach (PR #506 delta on the S4 notification surface)", () => {
  it("delivers a workspace-scoped notification while the recipient reaches the workspace, and not after", async () => {
    const { user, workspace, notification } =
      await workspaceNotificationFixture();

    await deliverNotification(notification.id);
    expect(emailProvider.sendNotificationEmail).toHaveBeenCalledTimes(1);

    await revokeWorkspaceMembership(user.id, workspace.id);
    await deliverNotification(notification.id);

    expect(emailProvider.sendNotificationEmail).toHaveBeenCalledTimes(1);
  });

  it("lists a workspace notification rule only while the caller reaches the workspace", async () => {
    const { user, workspace } = await workspaceNotificationFixture();

    const before = await getNotificationPreferences(user.id, user.email);
    expect(before.workspaces.map((rule) => rule.workspaceId)).toEqual([
      workspace.id,
    ]);

    await revokeWorkspaceMembership(user.id, workspace.id);
    const after = await getNotificationPreferences(user.id, user.email);

    expect(after.workspaces).toEqual([]);
    // The stored rule is retained; only the read is reach-filtered, so a restored
    // membership restores the rule.
    const [stored] = await db
      .select({ id: schema.userNotificationWorkspaceRuleTable.id })
      .from(schema.userNotificationWorkspaceRuleTable)
      .where(
        eq(schema.userNotificationWorkspaceRuleTable.workspaceId, workspace.id),
      );
    expect(stored).toBeDefined();
  });
});
