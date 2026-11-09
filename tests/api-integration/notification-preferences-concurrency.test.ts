import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { encryptSecret } from "../../apps/api/src/notification-preferences/secrets";
import { updateNotificationPreferences } from "../../apps/api/src/notification-preferences/service";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

const preferencePath = "/api/notification-preferences";

async function withSlowPreferenceWrite<T>(work: () => Promise<T>): Promise<T> {
  // Force both HTTP requests to reach the old read/modify/write race window.
  // Under the transaction lock the second request waits before its read instead.
  await db.execute(sql`
    CREATE FUNCTION test_slow_notification_preference_write() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_sleep(0.2);
      RETURN NEW;
    END;
    $$
  `);
  await db.execute(sql`
    CREATE TRIGGER test_slow_notification_preference_write_trigger
    BEFORE INSERT OR UPDATE ON user_notification_preference
    FOR EACH ROW EXECUTE FUNCTION test_slow_notification_preference_write()
  `);
  try {
    return await work();
  } finally {
    await db.execute(
      sql`DROP TRIGGER test_slow_notification_preference_write_trigger ON user_notification_preference`,
    );
    await db.execute(
      sql`DROP FUNCTION test_slow_notification_preference_write()`,
    );
  }
}

describe("notification preference concurrent updates", () => {
  beforeEach(resetTestDatabase);

  it.each([false, true])(
    "preserves concurrent partial writes (existing row: %s)",
    async (rowExists) => {
      const member = await createWorkspaceMember();
      mockAuthenticatedSession(member.user);
      const { app } = createApp();
      const put = (body: Record<string, boolean>) =>
        app.request(preferencePath, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });

      if (rowExists) {
        const seeded = await put({ dueDateReminderEnabled: false });
        expect(seeded.status, await seeded.clone().text()).toBe(200);
      }

      await withSlowPreferenceWrite(async () => {
        const [assignment, comments] = await Promise.all([
          put({ taskAssignmentEnabled: false }),
          put({ taskCommentEnabled: false }),
        ]);
        expect(assignment.status, await assignment.clone().text()).toBe(200);
        expect(comments.status, await comments.clone().text()).toBe(200);
      });

      const read = await app.request(preferencePath);
      expect(read.status).toBe(200);
      expect(await read.json()).toMatchObject({
        taskAssignmentEnabled: false,
        taskCommentEnabled: false,
        dueDateReminderEnabled: !rowExists,
      });
      const rows = await db
        .select()
        .from(schema.userNotificationPreferenceTable)
        .where(
          eq(schema.userNotificationPreferenceTable.userId, member.user.id),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        taskAssignmentEnabled: false,
        taskCommentEnabled: false,
      });
    },
  );

  it("rolls back the preference row if the workspace-rule cascade fails", async () => {
    const member = await createWorkspaceMember();
    await updateNotificationPreferences(member.user.id, member.user.email, {
      emailEnabled: true,
    });
    await db.insert(schema.userNotificationWorkspaceRuleTable).values({
      userId: member.user.id,
      workspaceId: member.workspace.id,
      emailEnabled: true,
    });

    await db.execute(sql`
      CREATE FUNCTION test_notification_rule_failure() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'test cascade failure';
      END;
      $$
    `);
    await db.execute(sql`
      CREATE TRIGGER test_notification_rule_failure_trigger
      BEFORE UPDATE ON user_notification_workspace_rule
      FOR EACH ROW EXECUTE FUNCTION test_notification_rule_failure()
    `);
    try {
      await expect(
        updateNotificationPreferences(member.user.id, member.user.email, {
          emailEnabled: false,
        }),
      ).rejects.toThrow();
      const [preference] = await db
        .select()
        .from(schema.userNotificationPreferenceTable)
        .where(
          eq(schema.userNotificationPreferenceTable.userId, member.user.id),
        );
      const [rule] = await db
        .select()
        .from(schema.userNotificationWorkspaceRuleTable)
        .where(
          eq(schema.userNotificationWorkspaceRuleTable.userId, member.user.id),
        );
      expect(preference?.emailEnabled).toBe(true);
      expect(rule?.emailEnabled).toBe(true);
    } finally {
      await db.execute(
        sql`DROP TRIGGER test_notification_rule_failure_trigger ON user_notification_workspace_rule`,
      );
      await db.execute(sql`DROP FUNCTION test_notification_rule_failure()`);
    }
  });

  it("does not let a workspace rule re-enable email after a concurrent global disable", async () => {
    const member = await createWorkspaceMember();
    await updateNotificationPreferences(member.user.id, member.user.email, {
      emailEnabled: true,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    await db.execute(sql`
      CREATE FUNCTION test_slow_notification_rule_insert() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_sleep(0.7);
        RETURN NEW;
      END;
      $$
    `);
    await db.execute(sql`
      CREATE TRIGGER test_slow_notification_rule_insert_trigger
      BEFORE INSERT ON user_notification_workspace_rule
      FOR EACH ROW EXECUTE FUNCTION test_slow_notification_rule_insert()
    `);
    try {
      const ruleSave = app.request(
        `${preferencePath}/workspaces/${member.workspace.id}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            isActive: true,
            emailEnabled: true,
            ntfyEnabled: false,
            gotifyEnabled: false,
            webhookEnabled: false,
            projectMode: "all",
          }),
        },
      );
      // Wait until the rule has passed the old global check and reached INSERT.
      await vi.waitFor(
        async () => {
          const activity = await db.execute(sql`
            SELECT 1 FROM pg_stat_activity
            WHERE wait_event = 'PgSleep'
              AND query ILIKE '%user_notification_workspace_rule%'
              AND pid <> pg_backend_pid()
          `);
          expect(activity.rows.length).toBeGreaterThan(0);
        },
        { interval: 20, timeout: 3000 },
      );
      const globalDisable = app.request(preferencePath, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emailEnabled: false }),
      });
      const [ruleResponse, globalResponse] = await Promise.all([
        ruleSave,
        globalDisable,
      ]);
      expect(ruleResponse.status, await ruleResponse.clone().text()).toBe(200);
      expect(globalResponse.status, await globalResponse.clone().text()).toBe(
        200,
      );
      const read = await app.request(preferencePath);
      expect(read.status).toBe(200);
      expect(await read.json()).toMatchObject({
        emailEnabled: false,
        workspaces: [
          expect.objectContaining({
            workspaceId: member.workspace.id,
            emailEnabled: false,
          }),
        ],
      });
    } finally {
      await db.execute(
        sql`DROP TRIGGER test_slow_notification_rule_insert_trigger ON user_notification_workspace_rule`,
      );
      await db.execute(sql`DROP FUNCTION test_slow_notification_rule_insert()`);
    }
  });

  it("clears connection URLs and secrets on disconnect, including after reload", async () => {
    const member = await createWorkspaceMember();
    await db.insert(schema.userNotificationPreferenceTable).values({
      userId: member.user.id,
      ntfyEnabled: true,
      ntfyServerUrl: "https://example.com/ntfy",
      ntfyTopic: "ops",
      ntfyToken: encryptSecret("synthetic-ntfy-token"),
      gotifyEnabled: true,
      gotifyServerUrl: "https://example.com/gotify",
      gotifyToken: encryptSecret("synthetic-gotify-token"),
      webhookEnabled: true,
      webhookUrl: "https://example.com/webhook",
      webhookSecret: encryptSecret("synthetic-webhook-secret"),
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const disconnect = await app.request(preferencePath, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ntfyEnabled: false,
        ntfyServerUrl: null,
        ntfyTopic: null,
        ntfyToken: null,
        gotifyEnabled: false,
        gotifyServerUrl: null,
        gotifyToken: null,
        webhookEnabled: false,
        webhookUrl: null,
        webhookSecret: null,
      }),
    });
    expect(disconnect.status, await disconnect.clone().text()).toBe(200);
    const read = await app.request(preferencePath);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      ntfyEnabled: false,
      ntfyServerUrl: null,
      ntfyTopic: null,
      ntfyTokenConfigured: false,
      gotifyEnabled: false,
      gotifyServerUrl: null,
      gotifyTokenConfigured: false,
      webhookEnabled: false,
      webhookUrl: null,
      webhookSecretConfigured: false,
    });
    const [stored] = await db
      .select()
      .from(schema.userNotificationPreferenceTable)
      .where(eq(schema.userNotificationPreferenceTable.userId, member.user.id));
    expect(stored).toMatchObject({
      ntfyServerUrl: null,
      ntfyTopic: null,
      ntfyToken: null,
      gotifyServerUrl: null,
      gotifyToken: null,
      webhookUrl: null,
      webhookSecret: null,
    });
  });
});
