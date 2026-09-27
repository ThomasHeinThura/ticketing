/**
 * Issue #8 rekey follow-up (Opus review of pull request #392, BLOCKING) — proves migration
 * `0071_workspace_role_apikey_permission_task_to_work_item.sql`'s backfill actually repairs a
 * PRE-EXISTING `workspace_role.permission` row and a PRE-EXISTING `apikey.permissions` row,
 * not just data a post-rename binary would ever write.
 *
 * THE DEFECT THIS COVERS. Pull request #392 renamed the legacy `task` statement key to
 * `work_item` in code (`packages/permissions/src/legacy-better-auth-access-control.ts` and
 * every `requireWorkspacePermission` call site), but did nothing about the JSON already
 * sitting in these two `text` columns. `customRoleStatements()`
 * (`apps/api/src/utils/require-workspace-permission.ts`) reads `workspace_role.permission`
 * directly, with no fall-back to the compiled default (issue #66: a missing/mismatched key is
 * DENY, not fall back) — so a row still shaped `{"task": [...]}` would silently deny every
 * `work_item:*` check for that role. The same is true for `apikey.permissions`, read by
 * `verifyApiKey()` and consulted by `hasWorkspacePermission()` as a narrowing filter on top of
 * the caller's own role. Same defect class as issue #318/PR #322 ("a migration doesn't handle
 * a pre-existing row").
 *
 * WHY THIS REPLAYS THE MIGRATION'S SQL DIRECTLY, RATHER THAN A SEPARATE TEMP DATABASE. Unlike
 * `workspace-role-is-system-backfill-migration.test.ts` (migration `0068`, which ADDED a
 * column and therefore needed a database migrated only up to the cutoff before that column
 * existed), migration `0071` is pure DML against columns (`workspace_role.permission`,
 * `apikey.permissions`) that already exist at the CURRENT schema head. So this file uses the
 * ordinary shared test database (`resetTestDatabase()`, already migrated to head — which means
 * `0071` has already run once, against an empty table, before this test's `beforeEach`), inserts
 * rows directly (bypassing the application layer, which would refuse `task` as an unknown
 * resource today), then replays `0071`'s own SQL text again. That is safe specifically because
 * `0071` is idempotent (its `WHERE ... ? 'task'` guard only ever matches a row this test itself
 * just inserted) and reads the EXACT SQL the real migration runs, not a paraphrase of it.
 *
 * MUTATION-CHECKED BY HAND, per this issue's review instruction: with `replayMigration0071()`'s
 * call removed (i.e. simulating the migration never having run against these rows), this
 * file's "confirms a member... can now actually pass" assertions go red — both the
 * workspace-role case (403, not 200, on the create-task probe) and the API-key case (403, not
 * 200) — confirmed by temporarily commenting out the `replayMigration0071()` call in both
 * `it` blocks and observing both fail before restoring it. Recorded here rather than automated
 * as a second CI variant, for the same reason `0068`'s own test gives: standing up a
 * deliberately-broken migration path inside the suite itself would ship a broken migration
 * alongside the real one.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(currentDir, "../../apps/api/drizzle");
const MIGRATION_TAG = "0071_workspace_role_apikey_permission_task_to_work_item";

/** Replays migration `0071`'s exact SQL text against the shared test database — see this
 * file's own top comment for why that is safe and sufficient here (pure idempotent DML
 * against existing columns), unlike `0068`'s temp-database dance. */
async function replayMigration0071() {
  const sqlText = readFileSync(
    join(migrationsFolder, `${MIGRATION_TAG}.sql`),
    "utf8",
  );
  for (const statement of sqlText.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed.length === 0) continue;
    await db.execute(trimmed);
  }
}

/** Inserts a `workspace_role` row with a RAW permission JSON string, bypassing the
 * application layer entirely (the validated `create-workspace-role`/`update-workspace-role`
 * controllers reject an unknown resource key like `task` today) — simulating exactly what a
 * pre-rename binary would have persisted. Delete-then-insert because `createWorkspaceMember`
 * auto-seeds a `workspace_role` row for default role names (issue #66) and there is no unique
 * constraint on `(workspace_id, role)` to lean on instead. */
async function seedRawWorkspaceRolePermission(
  workspaceId: string,
  role: string,
  rawPermissionJson: string,
) {
  await db
    .delete(schema.workspaceRoleTable)
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, workspaceId),
        eq(schema.workspaceRoleTable.role, role),
      ),
    );
  await db.insert(schema.workspaceRoleTable).values({
    workspaceId,
    role,
    permission: rawPermissionJson,
  });
}

function hashApiKeyForTest(key: string): string {
  return createHash("sha256")
    .update(key)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function postCreateTask(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  headers: Record<string, string> = {},
) {
  return app.request(`/api/task/${projectId}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      title: "rekey-backfill probe",
      description: "",
      priority: "low",
      status: "to-do",
    }),
  });
}

describe("migration 0071_workspace_role_apikey_permission_task_to_work_item.sql — backfill for PRE-EXISTING rows (issue #8 rekey follow-up, Opus review of #392)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rewrites a pre-existing workspace_role.permission row's task key to work_item, and a member with that role can then actually pass the renamed work_item:create check", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    // Step 1: insert the OLD pre-migration JSON shape directly, bypassing the application
    // layer — exactly what a pre-rename binary would have persisted for this role.
    const oldShapePermission = JSON.stringify({ task: ["create", "read"] });
    await seedRawWorkspaceRolePermission(
      member.workspace.id,
      "member",
      oldShapePermission,
    );

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    // PROVES THE TEST HAS TEETH: before the backfill runs, the renamed runtime check
    // (`requireWorkspacePermission({ work_item: ["create"] })`) reads this still-`task`-keyed
    // row and finds no `work_item` key at all — issue #66 means that is a DENY, not a
    // fall-back — so the exact same probe that must pass after the backfill must fail before
    // it. This is the automated equivalent of "confirm it fails against the OLD unfixed data
    // shape if the backfill is skipped."
    const beforeBackfill = await postCreateTask(app, project.id);
    expect(beforeBackfill.status).toBe(403);

    // Step 2: run the backfill.
    await replayMigration0071();

    // Step 3: assert the JSON itself was rewritten — work_item key present with the SAME
    // action array, task key gone.
    const [row] = await db
      .select({ permission: schema.workspaceRoleTable.permission })
      .from(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, member.workspace.id),
          eq(schema.workspaceRoleTable.role, "member"),
        ),
      );
    expect(row).toBeDefined();
    const parsed = JSON.parse(row?.permission ?? "{}") as Record<
      string,
      unknown
    >;
    expect(parsed.work_item).toEqual(["create", "read"]);
    expect(parsed.task).toBeUndefined();

    // Step 4: an ACTUAL end-to-end assertion, not just a raw JSON check — a member of this
    // role can now really pass the runtime work_item:create check, through the real HTTP
    // route and the real `requireWorkspacePermission` middleware.
    const afterBackfill = await postCreateTask(app, project.id);
    expect(afterBackfill.status).toBe(200);
  });

  it("rewrites a pre-existing apikey.permissions row's task key to work_item, and that API key can then actually pass the renamed work_item:create check", async () => {
    // Admin so the underlying membership role is never the reason for a 403 here — the ONLY
    // gate under test is the API key's own narrowing permissions.
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    const rawKey = `taskdesk_test_${randomUUID()}`;
    const hashed = hashApiKeyForTest(rawKey);
    const now = new Date();

    // Step 1: insert the OLD pre-migration JSON shape directly on the apikey row, bypassing
    // the application layer.
    await db.insert(schema.apikeyTable).values({
      referenceId: member.user.id,
      userId: member.user.id,
      key: hashed,
      name: "rekey-backfill apikey probe",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      createdAt: now,
      updatedAt: now,
      permissions: JSON.stringify({ task: ["create"] }),
    });

    const { app } = createApp();

    // PROVES THE TEST HAS TEETH: before the backfill runs, `hasWorkspacePermission`'s
    // API-key narrowing check (`apps/api/src/utils/require-workspace-permission.ts`) reads
    // this still-`task`-keyed row, finds no `work_item` key, and denies — even though the
    // underlying `admin` role would otherwise grant `work_item:create` freely.
    const beforeBackfill = await postCreateTask(app, project.id, {
      Authorization: `Bearer ${rawKey}`,
    });
    expect(beforeBackfill.status).toBe(403);

    // Step 2: run the backfill.
    await replayMigration0071();

    // Step 3: assert the JSON itself was rewritten.
    const [row] = await db
      .select({ permissions: schema.apikeyTable.permissions })
      .from(schema.apikeyTable)
      .where(eq(schema.apikeyTable.key, hashed));
    expect(row).toBeDefined();
    const parsed = JSON.parse(row?.permissions ?? "{}") as Record<
      string,
      unknown
    >;
    expect(parsed.work_item).toEqual(["create"]);
    expect(parsed.task).toBeUndefined();

    // Step 4: an ACTUAL end-to-end assertion — the API key can now really pass the runtime
    // work_item:create check, through the real HTTP route, real Bearer-token authentication,
    // and the real `hasWorkspacePermission` API-key narrowing check.
    const afterBackfill = await postCreateTask(app, project.id, {
      Authorization: `Bearer ${rawKey}`,
    });
    expect(afterBackfill.status).toBe(200);
  });
});
