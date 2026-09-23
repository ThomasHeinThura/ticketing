import { DEFAULT_ROLE_NAMES, defaultRolePayloads } from "@taskdesk/permissions";
import { and, eq, inArray, sql } from "drizzle-orm";
import db, { schema } from "../database";

/**
 * Backfill the editable default roles (viewer/member/admin) for every
 * workspace that's missing them. Runs on API startup after Drizzle
 * migrations.
 *
 * These three roles used to be static (compiled into better-auth's
 * `roles` config). They were converted to DB rows so admins can override
 * them per workspace, but that means existing workspaces, which were
 * created before the switch, have no rows yet. Without this backfill,
 * better-auth's dynamic-access-control resolution would treat them as
 * having an empty permission set on existing workspaces.
 *
 * Idempotent: only inserts rows that aren't already present. The insert itself also
 * carries `onConflictDoNothing` against `workspace_role_workspace_id_role_unique`
 * (migration 0051, issue #118) -- the read above narrows which rows this call attempts to
 * insert, but two replicas starting concurrently can both pass that read for the same
 * workspace/role before either has inserted (issue #134: a plain check-then-insert here
 * would let one replica's insert 23505 and `process.exit(1)` in `runStartupTasks`'s
 * catch, crashing a whole replica over an ordinary concurrent-boot race). The conflict
 * target makes the race resolve to a silent no-op for whichever replica loses it, instead.
 *
 * SELF-HEALS `is_system` for existing rows too (issue #318, security -- independent Sonnet
 * review of pull request #322, BLOCKING finding). Migration `0068` itself backfills every
 * existing `viewer`/`member`/`admin` row to `is_system = true`, but this function is the
 * SAME idempotent, every-boot mechanism that repairs a workspace missing a default-role row
 * at all -- so it repairs a deployment that somehow ran `0068` without that migration's own
 * `UPDATE` the identical way: on every boot, not just once. `onConflictDoNothing`'s insert
 * path can never flip an EXISTING row's `is_system`, which is exactly the bug the migration
 * fix closes for the one-time case; this closes it for "ran anyway", forward, forever.
 */
export async function seedDefaultWorkspaceRoles() {
  try {
    const tableExists = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_name = 'workspace_role'
      ) AS exists;
    `);

    const exists =
      tableExists.rows[0]?.exists === true ||
      tableExists.rows[0]?.exists === "t";
    if (!exists) {
      console.log(
        "🛈 workspace_role table does not exist; skipping default-role seed.",
      );
      return;
    }

    // Issue #318 (security) self-heal, run every boot regardless of whether any workspace
    // is missing a row: any `viewer`/`member`/`admin` row that is not yet `is_system = true`
    // is repaired unconditionally. `UNIQUE (workspace_id, role)` means this can only ever
    // match the one genuine row per workspace for each of these three names -- see this
    // function's own doc comment and migration `0068`'s own comment for why a plain
    // migration-time backfill is not enough on its own.
    const healed = await db
      .update(schema.workspaceRoleTable)
      .set({ isSystem: true })
      .where(
        and(
          inArray(
            schema.workspaceRoleTable.role,
            DEFAULT_ROLE_NAMES as unknown as string[],
          ),
          eq(schema.workspaceRoleTable.isSystem, false),
        ),
      )
      .returning({ id: schema.workspaceRoleTable.id });
    if (healed.length > 0) {
      console.log(
        `✅ Self-healed is_system = true on ${healed.length} existing default workspace role row(s) (issue #318).`,
      );
    }

    const workspaces = await db
      .select({ id: schema.workspaceTable.id })
      .from(schema.workspaceTable);

    if (workspaces.length === 0) {
      return;
    }

    const workspaceIds = workspaces.map((w) => w.id);

    const existingRows = await db
      .select({
        workspaceId: schema.workspaceRoleTable.workspaceId,
        role: schema.workspaceRoleTable.role,
      })
      .from(schema.workspaceRoleTable)
      .where(
        and(
          inArray(schema.workspaceRoleTable.workspaceId, workspaceIds),
          inArray(
            schema.workspaceRoleTable.role,
            DEFAULT_ROLE_NAMES as unknown as string[],
          ),
        ),
      );

    const present = new Set(
      existingRows.map((r) => `${r.workspaceId}:${r.role}`),
    );

    const now = new Date();
    const rows: Array<typeof schema.workspaceRoleTable.$inferInsert> = [];
    for (const workspaceId of workspaceIds) {
      for (const name of DEFAULT_ROLE_NAMES) {
        if (present.has(`${workspaceId}:${name}`)) continue;
        rows.push({
          workspaceId,
          role: name,
          permission: JSON.stringify(defaultRolePayloads[name]),
          // Issue #318 (security): this backfill is one of the two places that seed a
          // GENUINE built-in role row (the other is `create-workspace.ts`'s creation-time
          // seed) -- marked so `require-workspace-capability.ts` and `resolve-identity.ts`
          // can tell it apart from a custom row an administrator later names the same
          // thing. See `workspace_role.is_system`'s column comment in `schema.ts`.
          isSystem: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    if (rows.length === 0) {
      return;
    }

    // Postgres' bind protocol caps parameters at 65535 per query, so insert
    // in chunks. 6 columns × 1000 rows = 6000 params per batch, leaving ample
    // headroom even for instances with tens of thousands of workspaces.
    const BATCH_SIZE = 1000;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      await db
        .insert(schema.workspaceRoleTable)
        .values(rows.slice(i, i + BATCH_SIZE))
        .onConflictDoNothing({
          target: [
            schema.workspaceRoleTable.workspaceId,
            schema.workspaceRoleTable.role,
          ],
        });
    }
    console.log(
      `✅ Seeded ${rows.length} default workspace role row(s) across ${workspaceIds.length} workspace(s).`,
    );
  } catch (error) {
    console.error("❌ Failed to seed default workspace roles:", error);
    throw error;
  }
}
