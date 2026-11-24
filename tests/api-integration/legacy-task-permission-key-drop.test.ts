/**
 * Issue #398 -- migration 0228 removes the legacy `task` permission key from stored
 * `workspace_role.permission` and `apikey.permissions`, after copying it into `work_item`
 * where `work_item` is missing.
 *
 * Replays the migration's own SQL, read from the file that ships, against rows seeded in the
 * pre-contract shapes. Non-vacuity: each case asserts the seeded row HAS `task` before the
 * replay, so a no-op migration cannot pass.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

const migrationPath = join(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../apps/api/drizzle"),
  "0228_drop_legacy_task_permission_key.sql",
);

async function replayMigration() {
  const source = readFileSync(migrationPath, "utf8");
  for (const statement of source.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) await db.execute(sql.raw(trimmed));
  }
}

async function seedApiKey(userId: string, permissions: string | null) {
  const id = randomUUID();
  await db.insert(schema.apikeyTable).values({
    id,
    key: `legacy-task-${id}`,
    userId,
    permissions,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

async function rolePermission(id: string) {
  const result = await db.execute<{ permission: string }>(
    sql`SELECT permission FROM workspace_role WHERE id = ${id}`,
  );
  return JSON.parse(result.rows[0]?.permission ?? "null");
}

async function keyPermissions(id: string) {
  const result = await db.execute<{ permissions: string | null }>(
    sql`SELECT permissions FROM apikey WHERE id = ${id}`,
  );
  const raw = result.rows[0]?.permissions;
  return raw === null || raw === undefined ? null : JSON.parse(raw);
}

async function seedRole(workspaceId: string, role: string, permission: string) {
  const id = randomUUID();
  await db.execute(sql`
    INSERT INTO workspace_role (id, workspace_id, role, permission, created_at)
    VALUES (${id}, ${workspaceId}, ${role}, ${permission}, now())
  `);
  return id;
}

describe("migration 0228 -- drop the legacy task permission key (#398)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("heals a task-only row into work_item and removes task, for roles and API keys", async () => {
    const member = await createWorkspaceMember();
    const roleId = await seedRole(
      member.workspace.id,
      "legacy-task-only",
      JSON.stringify({ task: ["create", "read"], project: ["read"] }),
    );
    const keyId = await seedApiKey(
      member.user.id,
      JSON.stringify({ task: ["read"] }),
    );
    expect(await rolePermission(roleId)).toHaveProperty("task");
    expect(await keyPermissions(keyId)).toHaveProperty("task");

    await replayMigration();

    expect(await rolePermission(roleId)).toEqual({
      work_item: ["create", "read"],
      project: ["read"],
    });
    expect(await keyPermissions(keyId)).toEqual({ work_item: ["read"] });
  });

  it("keeps an existing work_item over task when both keys are present", async () => {
    const member = await createWorkspaceMember();
    const roleId = await seedRole(
      member.workspace.id,
      "legacy-both",
      JSON.stringify({ task: ["read"], work_item: ["read", "update"] }),
    );
    const keyId = await seedApiKey(
      member.user.id,
      JSON.stringify({ task: ["read"], work_item: ["create"] }),
    );

    await replayMigration();

    expect(await rolePermission(roleId)).toEqual({
      work_item: ["read", "update"],
    });
    expect(await keyPermissions(keyId)).toEqual({ work_item: ["create"] });
  });

  it("leaves rows without task untouched, tolerates a null key permission, and replays cleanly", async () => {
    const member = await createWorkspaceMember();
    const roleId = await seedRole(
      member.workspace.id,
      "no-task",
      JSON.stringify({ work_item: ["read"] }),
    );
    const nullKeyId = await seedApiKey(member.user.id, null);

    await replayMigration();
    await replayMigration();

    expect(await rolePermission(roleId)).toEqual({ work_item: ["read"] });
    expect(await keyPermissions(nullKeyId)).toBeNull();
  });

  it("preflight refuses a non-object permission and changes nothing", async () => {
    const member = await createWorkspaceMember();
    const goodId = await seedRole(
      member.workspace.id,
      "legacy-good",
      JSON.stringify({ task: ["read"] }),
    );
    await seedRole(member.workspace.id, "legacy-bad", JSON.stringify(["task"]));

    const error = await replayMigration().then(
      () => null,
      (e: { cause?: { message?: string } }) => e,
    );
    expect(error?.cause?.message).toContain("#398 preflight");
    expect(await rolePermission(goodId)).toHaveProperty("task");
  });
});
