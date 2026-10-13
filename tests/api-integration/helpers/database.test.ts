import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { taskReminderSentTable } from "../../../apps/api/src/database/schema";
import { ensureInternalOrganisation } from "../../../apps/api/src/utils/seed-internal-organisation";
import { resetTestDatabase } from "./database";
import { createWorkspaceMember } from "./fixtures";

async function seedTaskReminderSentRow(): Promise<string> {
  const userId = `user-${randomUUID()}`;
  const workspaceId = `workspace-${randomUUID()}`;
  const projectId = `project-${randomUUID()}`;
  const columnId = `column-${randomUUID()}`;
  const taskId = `task-${randomUUID()}`;
  const id = `task-reminder-${randomUUID()}`;

  await db.insert(schema.userTable).values({
    id: userId,
    email: `${userId}@example.com`,
    emailVerified: true,
    name: "Reminder Test User",
  });
  const organisation = await ensureInternalOrganisation();
  await db.insert(schema.workspaceTable).values({
    id: workspaceId,
    createdAt: new Date(),
    name: "Reminder Workspace",
    slug: `workspace-${randomUUID()}`,
    organisationId: organisation.id,
  });
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId,
    role: "admin",
    joinedAt: new Date(),
  });
  await db.insert(schema.projectTable).values({
    id: projectId,
    workspaceId,
    name: "Reminder Project",
    icon: "Folder",
    slug: `project-${randomUUID()}`,
  });
  await db.insert(schema.columnTable).values({
    id: columnId,
    projectId,
    name: "To do",
    slug: "to-do",
    position: 1,
    isFinal: false,
  });
  await db.insert(schema.taskTable).values({
    id: taskId,
    projectId,
    title: "Reminder task",
    description: "",
    priority: "low",
    status: "to-do",
    columnId,
    number: 1,
    position: 1,
  });
  await db.insert(taskReminderSentTable).values({
    id,
    taskId,
    reminderType: "due-soon",
  });

  return id;
}

async function rowExists(tableName: string, id: string): Promise<boolean> {
  const result = await db.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM ${sql.raw(`"${tableName}"`)}
      WHERE id = ${id}
    ) AS exists
  `);
  return result.rows[0]?.exists === true;
}

describe("resetTestDatabase", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(async () => {
    await resetTestDatabase();
  });

  it("truncates task_reminder_sent rows", async () => {
    const id = await seedTaskReminderSentRow();

    await resetTestDatabase();

    expect(await rowExists("task_reminder_sent", id)).toBe(false);
  });

  it("truncates tables that live outside the schema registry", async () => {
    // A raw SQL table that no module in apps/api/src/database knows about.
    // If resetTestDatabase ever reverts to deriving its list from the schema
    // registry, this table will not appear in the TRUNCATE list and the row
    // below will survive the reset.
    const tableName = `test_only_unregistered_${randomUUID().replaceAll("-", "")}`;
    const id = `row-${randomUUID()}`;
    const quoted = `"${tableName}"`;

    await db.execute(
      sql.raw(
        `CREATE TABLE ${quoted} (id text PRIMARY KEY, label text NOT NULL)`,
      ),
    );

    try {
      await db.execute(
        sql.raw(`INSERT INTO ${quoted} (id, label) VALUES ('${id}', 'seed')`),
      );

      await resetTestDatabase();

      expect(await rowExists(tableName, id)).toBe(false);
    } finally {
      await db.execute(sql.raw(`DROP TABLE ${quoted}`));
    }
  });

  it("clears test fixture memberships before validating the applied grant projection", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(sql`${schema.personTable.userId} = ${user.id}`)
      .limit(1);
    if (!person) throw new Error("Fixture person was not created");
    const [role] = await db
      .insert(schema.roleTable)
      .values({
        scope: "workspace",
        workspaceId: workspace.id,
        key: `reset-fixture-${randomUUID()}`,
        name: "Reset fixture role",
        rank: 1,
        capabilities: [],
      })
      .returning();
    if (!role) throw new Error("Fixture role was not created");
    await db.insert(schema.membershipTable).values({
      personId: person.id,
      scope: "workspace",
      scopeId: workspace.id,
      roleId: role.id,
      seesAll: false,
    });

    await expect(resetTestDatabase()).resolves.toBeUndefined();

    const memberships = await db.select().from(schema.membershipTable);
    expect(memberships).toHaveLength(0);
  });
});
