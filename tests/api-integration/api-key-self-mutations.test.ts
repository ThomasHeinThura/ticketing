import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

function hashApiKey(rawKey: string): string {
  return createHash("sha256")
    .update(rawKey)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

describe("API-key access to self-only writes", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("denies every unscoped self-write to keys while preserving session writes", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    const now = new Date();
    const rawKey = `taskdesk_test_${randomUUID()}`;
    await db.insert(schema.apikeyTable).values({
      referenceId: member.user.id,
      userId: member.user.id,
      key: hashApiKey(rawKey),
      name: "self mutation scope test",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      permissions: JSON.stringify({
        notification: ["create", "update", "delete"],
        "notification-preferences": ["update", "delete"],
        user: ["update", "delete"],
      }),
      createdAt: now,
      updatedAt: now,
    });

    const [existingNotification] = await db
      .insert(schema.notificationTable)
      .values({ userId: member.user.id, type: "info", isRead: false })
      .returning();
    expect(existingNotification).toBeDefined();

    const { app } = createApp();
    const keyRequest = (
      path: string,
      method: string,
      body?: Record<string, unknown>,
    ) =>
      app.request(path, {
        method,
        headers: {
          authorization: `Bearer ${rawKey}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

    const workspaceRule = {
      isActive: true,
      emailEnabled: false,
      ntfyEnabled: false,
      gotifyEnabled: false,
      webhookEnabled: false,
      projectMode: "all",
    };
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]).toString("base64");
    const attempts = [
      keyRequest("/api/notification", "POST", { type: "custom" }),
      keyRequest(`/api/notification/${existingNotification?.id}/read`, "PATCH"),
      keyRequest("/api/notification/read-all", "PATCH"),
      keyRequest("/api/notification/clear-all", "DELETE"),
      keyRequest("/api/notification-preferences", "PUT", {
        emailEnabled: true,
      }),
      keyRequest(
        `/api/notification-preferences/workspaces/${member.workspace.id}`,
        "PUT",
        workspaceRule,
      ),
      keyRequest(
        `/api/notification-preferences/workspaces/${member.workspace.id}`,
        "DELETE",
      ),
      keyRequest("/api/user/avatar", "PUT", {
        contentType: "image/png",
        data: png,
      }),
      keyRequest("/api/user/avatar", "DELETE"),
    ];
    const responses = await Promise.all(attempts);
    for (const response of responses) {
      const message = await response.text();
      expect(response.status, message).toBe(403);
      expect(message).toContain("session_required");
    }

    const notificationsAfterKey = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.userId, member.user.id));
    expect(notificationsAfterKey).toHaveLength(1);
    expect(notificationsAfterKey[0]?.isRead).toBe(false);
    expect(
      await db
        .select()
        .from(schema.userNotificationPreferenceTable)
        .where(
          eq(schema.userNotificationPreferenceTable.userId, member.user.id),
        ),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.userNotificationWorkspaceRuleTable)
        .where(
          eq(schema.userNotificationWorkspaceRuleTable.userId, member.user.id),
        ),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.userAvatarTable)
        .where(eq(schema.userAvatarTable.userId, member.user.id)),
    ).toHaveLength(0);

    mockAuthenticatedSession(member.user);
    const sessionWrites = [
      () =>
        app.request("/api/notification", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "custom" }),
        }),
      () =>
        app.request(`/api/notification/${existingNotification?.id}/read`, {
          method: "PATCH",
        }),
      () => app.request("/api/notification/read-all", { method: "PATCH" }),
      () => app.request("/api/notification/clear-all", { method: "DELETE" }),
      () =>
        app.request("/api/notification-preferences", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ emailEnabled: true }),
        }),
      () =>
        app.request(
          `/api/notification-preferences/workspaces/${member.workspace.id}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(workspaceRule),
          },
        ),
      () =>
        app.request("/api/user/avatar", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contentType: "image/png", data: png }),
        }),
      () => app.request("/api/user/avatar", { method: "DELETE" }),
    ];
    const sessionResponses: Response[] = [];
    for (const write of sessionWrites) sessionResponses.push(await write());
    const deleteRule = await app.request(
      `/api/notification-preferences/workspaces/${member.workspace.id}`,
      { method: "DELETE" },
    );
    expect(deleteRule.status, await deleteRule.clone().text()).toBe(200);
    expect(sessionResponses.map((response) => response.status)).toEqual([
      200, 200, 200, 200, 200, 200, 200, 200,
    ]);
  });
});
