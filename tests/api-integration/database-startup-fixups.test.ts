/**
 * #580 batch 10: the boot-time schema fixups (`database/migrate-*.ts`) moved under the
 * persistence layer. Each routine runs here against its OWN scratch database holding a
 * legacy-shaped table, because they look tables up by name only (the shared test database
 * already has the modern schema, where every one of them is a no-op). Every routine must
 * (a) reconcile the legacy shape, and (b) be safe to run a second time and when the table
 * is absent -- they run on every boot.
 */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DatabaseInstance } from "../../apps/api/src/database";
import { migrateApiKeyReferenceId } from "../../apps/api/src/utils/migrate-apikey-reference-id";
import { migrateNotificationPreferencesSchema } from "../../apps/api/src/utils/migrate-notification-preferences-schema";
import { migrateSessionColumn } from "../../apps/api/src/utils/migrate-session-column";
import { migrateWorkspaceUserEmail } from "../../apps/api/src/utils/migrate-workspace-user-email";

const baseUrl = process.env.TASKDESK_DATABASE_URL ?? "";

function withDatabase(name: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

async function admin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: withDatabase("postgres") });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

class Scratch {
  readonly name = `fixups_${randomUUID().replaceAll("-", "_")}`;
  pool!: Pool;
  db!: DatabaseInstance;

  async open() {
    await admin((c) => c.query(`CREATE DATABASE "${this.name}"`));
    this.pool = new Pool({ connectionString: withDatabase(this.name) });
    this.db = drizzle(this.pool) as unknown as DatabaseInstance;
  }

  query(text: string, params: unknown[] = []) {
    return this.pool.query(text, params);
  }

  async close() {
    await this.pool.end();
    await admin((c) =>
      c.query(`DROP DATABASE IF EXISTS "${this.name}" WITH (FORCE)`),
    );
  }
}

const columns = async (s: Scratch, table: string) =>
  (
    await s.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY column_name",
      [table],
    )
  ).rows.map((r) => r.column_name as string);

const indexes = async (s: Scratch, table: string) =>
  (
    await s.query(
      "SELECT indexname FROM pg_indexes WHERE tablename = $1 ORDER BY indexname",
      [table],
    )
  ).rows.map((r) => r.indexname as string);

describe("database startup fixups (re-run safety)", () => {
  beforeAll(() => {
    if (!new URL(baseUrl).pathname.endsWith("_test")) {
      throw new Error("TASKDESK_DATABASE_URL must point to a *_test database");
    }
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe("migrateSessionColumn", () => {
    const s = new Scratch();
    beforeAll(() => s.open());
    afterAll(() => s.close());

    it("renames the legacy session column and adds invitation.created_at, once", async () => {
      await s.query(
        `CREATE TABLE "session" (id text PRIMARY KEY, active_workspace_id text)`,
      );
      await s.query(`INSERT INTO "session" VALUES ('s1', 'ws-1')`);
      await s.query(
        `CREATE TABLE "invitation" (id text PRIMARY KEY, expires_at timestamp NOT NULL)`,
      );
      await s.query(
        `INSERT INTO "invitation" VALUES ('i1', '2026-03-01 00:00:00')`,
      );

      await migrateSessionColumn(s.db);

      expect(await columns(s, "session")).toEqual([
        "active_organization_id",
        "id",
      ]);
      expect(
        (await s.query(`SELECT active_organization_id FROM "session"`)).rows,
      ).toEqual([{ active_organization_id: "ws-1" }]);
      const inv = (
        await s.query(
          `SELECT to_char(created_at, 'YYYY-MM-DD') AS d, is_nullable, column_default
             FROM "invitation", information_schema.columns c
            WHERE c.table_name = 'invitation' AND c.column_name = 'created_at'`,
        )
      ).rows[0];
      expect(inv?.d).toBe("2026-02-01");
      expect(inv?.is_nullable).toBe("NO");
      expect(String(inv?.column_default)).toContain("now()");

      // Second run: nothing changes and nothing throws.
      await migrateSessionColumn(s.db);
      expect(await columns(s, "session")).toEqual([
        "active_organization_id",
        "id",
      ]);
      expect(
        (await s.query(`SELECT count(*)::int AS n FROM "invitation"`)).rows[0]
          ?.n,
      ).toBe(1);
    });

    it("skips quietly when the tables are missing or already migrated", async () => {
      const empty = new Scratch();
      await empty.open();
      try {
        await expect(migrateSessionColumn(empty.db)).resolves.toBeUndefined();
        await empty.query(
          `CREATE TABLE "session" (id text, active_organization_id text, active_workspace_id text)`,
        );
        await migrateSessionColumn(empty.db);
        // Both columns present: the old one is left alone (no destructive rename).
        expect(await columns(empty, "session")).toEqual([
          "active_organization_id",
          "active_workspace_id",
          "id",
        ]);
      } finally {
        await empty.close();
      }
    });
  });

  describe("migrateApiKeyReferenceId", () => {
    const s = new Scratch();
    beforeAll(() => s.open());
    afterAll(() => s.close());

    it("adds the new columns, copies user_id, relaxes NOT NULL and creates each index once", async () => {
      await s.query(
        `CREATE TABLE "apikey" (id text PRIMARY KEY, user_id text NOT NULL, "key" text)`,
      );
      await s.query(`INSERT INTO "apikey" VALUES ('k1', 'u1', 'h')`);

      await migrateApiKeyReferenceId(s.db);

      expect(
        (
          await s.query(
            `SELECT reference_id, config_id FROM "apikey" WHERE id = 'k1'`,
          )
        ).rows,
      ).toEqual([{ reference_id: "u1", config_id: "default" }]);
      expect(
        (
          await s.query(
            `SELECT is_nullable FROM information_schema.columns WHERE table_name='apikey' AND column_name='user_id'`,
          )
        ).rows[0]?.is_nullable,
      ).toBe("YES");
      const idx = await indexes(s, "apikey");
      expect(idx).toEqual(
        expect.arrayContaining([
          "apikey_configId_idx",
          "apikey_key_idx",
          "apikey_referenceId_idx",
        ]),
      );

      await migrateApiKeyReferenceId(s.db);
      expect(await indexes(s, "apikey")).toEqual(idx);
      expect(
        (await s.query(`SELECT count(*)::int AS n FROM "apikey"`)).rows[0]?.n,
      ).toBe(1);
    });

    it("keeps an existing reference_id and fills a null config_id", async () => {
      await s.query(
        `INSERT INTO "apikey" (id, user_id, reference_id, config_id, "key") VALUES ('k2', 'u2', 'ref-2', NULL, 'h2')`,
      );
      await migrateApiKeyReferenceId(s.db);
      expect(
        (
          await s.query(
            `SELECT reference_id, config_id FROM "apikey" WHERE id = 'k2'`,
          )
        ).rows,
      ).toEqual([{ reference_id: "ref-2", config_id: "default" }]);
    });

    it("does nothing without an apikey table", async () => {
      const empty = new Scratch();
      await empty.open();
      try {
        await expect(
          migrateApiKeyReferenceId(empty.db),
        ).resolves.toBeUndefined();
        expect(await columns(empty, "apikey")).toEqual([]);
      } finally {
        await empty.close();
      }
    });
  });

  describe("migrateWorkspaceUserEmail", () => {
    const s = new Scratch();
    beforeAll(() => s.open());
    afterAll(() => s.close());

    it("maps emails to user ids, removes unmappable rows, drops user_email, and is re-runnable", async () => {
      await s.query(`CREATE TABLE "user" (id text PRIMARY KEY, email text)`);
      await s.query(`INSERT INTO "user" VALUES ('u1', 'a@example.com')`);
      await s.query(
        `CREATE TABLE "workspace_member" (id text PRIMARY KEY, workspace_id text, user_email text)`,
      );
      await s.query(`INSERT INTO "workspace_member" VALUES
        ('m1', 'w1', 'a@example.com'),
        ('m2', 'w1', 'ghost@example.com'),
        ('m3', 'w1', NULL),
        ('m4', 'w1', '')`);

      await migrateWorkspaceUserEmail(s.db);

      expect(await columns(s, "workspace_member")).toEqual([
        "id",
        "user_id",
        "workspace_id",
      ]);
      expect(
        (
          await s.query(
            `SELECT id, user_id FROM "workspace_member" ORDER BY id`,
          )
        ).rows,
      ).toEqual([{ id: "m1", user_id: "u1" }]);

      await migrateWorkspaceUserEmail(s.db);
      expect(
        (await s.query(`SELECT id, user_id FROM "workspace_member"`)).rows,
      ).toEqual([{ id: "m1", user_id: "u1" }]);
    });

    it("adds user_id when neither column exists and removes rows without a user", async () => {
      const bare = new Scratch();
      await bare.open();
      try {
        await bare.query(
          `CREATE TABLE "workspace_member" (id text PRIMARY KEY, workspace_id text)`,
        );
        await bare.query(`INSERT INTO "workspace_member" VALUES ('m1', 'w1')`);
        await migrateWorkspaceUserEmail(bare.db);
        expect(await columns(bare, "workspace_member")).toEqual([
          "id",
          "user_id",
          "workspace_id",
        ]);
        expect(
          (
            await bare.query(
              `SELECT count(*)::int AS n FROM "workspace_member"`,
            )
          ).rows[0]?.n,
        ).toBe(0);
        await expect(
          migrateWorkspaceUserEmail(bare.db),
        ).resolves.toBeUndefined();
      } finally {
        await bare.close();
      }
    });

    it("does nothing without a workspace_member table", async () => {
      const empty = new Scratch();
      await empty.open();
      try {
        await expect(
          migrateWorkspaceUserEmail(empty.db),
        ).resolves.toBeUndefined();
      } finally {
        await empty.close();
      }
    });
  });

  describe("migrateNotificationPreferencesSchema", () => {
    const s = new Scratch();
    beforeAll(async () => {
      await s.open();
      await s.query(`CREATE TABLE "user" (id text PRIMARY KEY)`);
      await s.query(`CREATE TABLE "workspace" (id text PRIMARY KEY)`);
    });
    afterAll(() => s.close());

    it("creates the tables, indexes and foreign keys, tops up a partial legacy table, and is re-runnable", async () => {
      await s.query(
        `CREATE TABLE "user_notification_preference" (id text PRIMARY KEY NOT NULL, user_id text NOT NULL)`,
      );
      await s.query(
        `INSERT INTO "user" VALUES ('u1'); INSERT INTO "user_notification_preference" VALUES ('p1', 'u1')`,
      );

      await migrateNotificationPreferencesSchema(s.db);

      const prefColumns = await columns(s, "user_notification_preference");
      expect(prefColumns).toEqual(
        expect.arrayContaining([
          "due_date_reminder_lead_time_minutes",
          "email_enabled",
          "task_comment_enabled",
          "webhook_secret",
        ]),
      );
      // The existing row picked up the column defaults.
      expect(
        (
          await s.query(
            `SELECT due_date_reminder_lead_time_minutes AS lead, task_comment_enabled AS c FROM "user_notification_preference"`,
          )
        ).rows,
      ).toEqual([{ lead: 1440, c: true }]);
      expect(await columns(s, "user_notification_workspace_rule")).toContain(
        "project_mode",
      );
      expect(await columns(s, "user_notification_workspace_project")).toContain(
        "workspace_rule_id",
      );
      const idx = await indexes(s, "user_notification_workspace_rule");
      expect(idx).toEqual(
        expect.arrayContaining([
          "user_notification_workspace_rule_user_workspace_unique",
          "user_notification_workspace_rule_userId_idx",
        ]),
      );
      expect(
        (
          await s.query(
            `SELECT indexdef FROM pg_indexes WHERE indexname = 'user_notification_workspace_rule_user_workspace_unique'`,
          )
        ).rows[0]?.indexdef,
      ).toMatch(/UNIQUE.*\(user_id, workspace_id\)/);
      const fkNames = async () =>
        (
          await s.query(
            `SELECT conname FROM pg_constraint WHERE contype = 'f' AND conname LIKE 'user_notification_%' ORDER BY conname`,
          )
        ).rows.map((r) => r.conname as string);
      const fks = await fkNames();
      expect(fks).toHaveLength(4);

      await migrateNotificationPreferencesSchema(s.db);
      expect(await fkNames()).toEqual(fks);
      expect(await indexes(s, "user_notification_workspace_rule")).toEqual(idx);
      expect(
        (
          await s.query(
            `SELECT count(*)::int AS n FROM "user_notification_preference"`,
          )
        ).rows[0]?.n,
      ).toBe(1);
    });
  });
});
