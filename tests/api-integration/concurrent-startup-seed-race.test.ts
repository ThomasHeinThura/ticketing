/**
 * Issue #134 -- concurrent-startup seed race. Three check-then-insert startup/seed paths
 * were flagged by the independent Opus security review of PR #122 (issue #118 DB half):
 * two replicas starting concurrently could both pass a check-then-insert for the same row
 * and one would lose an unhandled unique-violation race.
 *
 *   - `seed-internal-organisation.ts` (`ensureInternalOrganisation` and
 *     `seedInternalOrganisationAndStaffPersons`) was already hardened for this class of
 *     race (issue #192: a SAVEPOINT'd insert + unique-violation fallback, and
 *     `onConflictDoNothing` respectively) -- covered by
 *     `p1-identity-schema-seed.test.ts`, not re-tested here.
 *   - `seed-default-workspace-roles.ts`'s `seedDefaultWorkspaceRoles` now carries
 *     `onConflictDoNothing` against `workspace_role_workspace_id_role_unique` (migration
 *     0051, issue #118).
 *   - `migrations/column-migration.ts`'s `migrateColumns` has no unique constraint to
 *     target (`column` carries no `UNIQUE (project_id, slug)`), so it is closed with a
 *     per-project `pg_advisory_xact_lock` instead, following this codebase's own
 *     established pattern (`workspace-role-lock.ts`'s `WORKSPACE_ROLE_LOCK_NAMESPACE`).
 *
 * Both concurrency tests below follow `workspace-write-create-contract.test.ts`'s own
 * 12-concurrent-calls precedent (A2-P4b): fire N concurrent boot-seed calls against a
 * database seeded with exactly one legacy row missing its seed, and assert every call
 * resolves (no crash-worthy unhandled rejection) with exactly one seeded set of rows --
 * not zero, not duplicated.
 */
import { DEFAULT_ROLE_NAMES } from "@taskdesk/permissions";
import { and, eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { migrateColumns } from "../../apps/api/src/migrations/column-migration";
import { seedDefaultWorkspaceRoles } from "../../apps/api/src/utils/seed-default-workspace-roles";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

const CONCURRENCY = 12;

beforeEach(async () => {
  await resetTestDatabase();
});

describe("issue #134 -- seedDefaultWorkspaceRoles concurrent-boot race", () => {
  it(`survives ${CONCURRENCY} concurrent calls with exactly one row per default role, no duplicates`, async () => {
    // A workspace created before the workspace_role backfill existed: no rows yet --
    // exactly the legacy state seedDefaultWorkspaceRoles backfills.
    const { workspace } = await createWorkspaceMember({
      seedDefaultRoleRow: false,
    });

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, () => seedDefaultWorkspaceRoles()),
    );

    // The whole point of onConflictDoNothing: no replica crash-exits over this race.
    for (const result of results) {
      expect(result.status).toBe("fulfilled");
    }

    const rows = await db
      .select({
        role: schema.workspaceRoleTable.role,
      })
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.workspaceId, workspace.id));

    expect(rows).toHaveLength(DEFAULT_ROLE_NAMES.length);
    expect(new Set(rows.map((r) => r.role))).toEqual(
      new Set(DEFAULT_ROLE_NAMES),
    );
  });

  it("a genuine later boot (not a race) still no-ops cleanly once rows exist", async () => {
    const { workspace } = await createWorkspaceMember({
      seedDefaultRoleRow: false,
    });

    await seedDefaultWorkspaceRoles();
    // A second call finding the rows already present (a normal later boot, not a
    // concurrent race) must still resolve cleanly rather than erroring.
    await seedDefaultWorkspaceRoles();

    const rows = await db
      .select({ role: schema.workspaceRoleTable.role })
      .from(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, workspace.id),
          inArray(
            schema.workspaceRoleTable.role,
            DEFAULT_ROLE_NAMES as unknown as string[],
          ),
        ),
      );

    expect(rows).toHaveLength(DEFAULT_ROLE_NAMES.length);
  });
});

describe("issue #134 -- migrateColumns concurrent-boot race", () => {
  it(`survives ${CONCURRENCY} concurrent calls with exactly the four default columns, no duplicates`, async () => {
    const { workspace } = await createWorkspaceMember();

    // A legacy project with no columns yet -- migrateColumns's own trigger condition.
    const project = requireRow(
      await db
        .insert(schema.projectTable)
        .values({
          workspaceId: workspace.id,
          name: "Legacy Project",
          slug: "legacy-project",
        })
        .returning(),
      "legacy project fixture",
    );

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, () => migrateColumns()),
    );

    for (const result of results) {
      expect(result.status).toBe("fulfilled");
    }

    const columns = await db
      .select({ slug: schema.columnTable.slug })
      .from(schema.columnTable)
      .where(eq(schema.columnTable.projectId, project.id));

    expect(columns).toHaveLength(4);
    expect(new Set(columns.map((c) => c.slug))).toEqual(
      new Set(["to-do", "in-progress", "in-review", "done"]),
    );
  });

  it("a genuine later boot (not a race) still no-ops cleanly once columns exist", async () => {
    const { workspace } = await createWorkspaceMember();

    const project = requireRow(
      await db
        .insert(schema.projectTable)
        .values({
          workspaceId: workspace.id,
          name: "Legacy Project",
          slug: "legacy-project-2",
        })
        .returning(),
      "legacy project fixture",
    );

    await migrateColumns();
    // A second call finding the columns already present (a normal later boot, not a
    // concurrent race) must still resolve cleanly rather than erroring.
    await migrateColumns();

    const columns = await db
      .select({ slug: schema.columnTable.slug })
      .from(schema.columnTable)
      .where(eq(schema.columnTable.projectId, project.id));

    expect(columns).toHaveLength(4);
  });
});
