import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type db from "../database";
import defaultDb, { schema } from "../database";

/**
 * Query ownership for the default-data seeds (issue #580): workspace default roles, the
 * internal organisation and staff persons, default work item types and state templates,
 * and a project's concrete states. Moved verbatim from the `seed-*.ts` modules, which keep
 * their orchestration (ordering, idempotence checks, batching, logging and error handling)
 * and export the same functions. Executors keep the structural `Pick<typeof db, ...>` types
 * the seeds already accepted, so callers (and test fakes) pass the same handles as before.
 */

// --- default workspace roles ----------------------------------------------------------

export async function workspaceRoleTableExists(): Promise<boolean> {
  const tableExists = await defaultDb.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_name = 'workspace_role'
      ) AS exists;
    `);
  return (
    tableExists.rows[0]?.exists === true || tableExists.rows[0]?.exists === "t"
  );
}

/** Marks existing default-named role rows `is_system`; returns the healed row ids. */
export async function healSystemRoleRows(roleNames: string[]) {
  return defaultDb
    .update(schema.workspaceRoleTable)
    .set({ isSystem: true })
    .where(
      and(
        inArray(schema.workspaceRoleTable.role, roleNames),
        eq(schema.workspaceRoleTable.isSystem, false),
      ),
    )
    .returning({ id: schema.workspaceRoleTable.id });
}

/** Inserts missing default role rows; conflicts on `(workspace_id, role)` are ignored. */
export async function insertDefaultWorkspaceRoleRows(
  rows: Array<typeof schema.workspaceRoleTable.$inferInsert>,
): Promise<void> {
  await defaultDb
    .insert(schema.workspaceRoleTable)
    .values(rows)
    .onConflictDoNothing({
      target: [
        schema.workspaceRoleTable.workspaceId,
        schema.workspaceRoleTable.role,
      ],
    });
}

// --- internal organisation and staff persons ------------------------------------------

type Selector = Pick<typeof db, "select">;
type Inserter = Pick<typeof db, "insert">;

export async function findInternalOrganisationId(executor: Selector) {
  const [existing] = await executor
    .select({ id: schema.organisationTable.id })
    .from(schema.organisationTable)
    .where(eq(schema.organisationTable.isInternal, true))
    .limit(1);
  return existing;
}

export async function insertInternalOrganisation(
  executor: Inserter,
  values: { key: string; name: string; now: Date },
) {
  const [row] = await executor
    .insert(schema.organisationTable)
    .values({
      key: values.key,
      name: values.name,
      isInternal: true,
      createdAt: values.now,
      updatedAt: values.now,
    })
    .returning({ id: schema.organisationTable.id });
  return row;
}

/** One staff person for a user; ignored when the user already has a person. */
export async function insertStaffPersonIfAbsent(
  userId: string,
  organisationId: string,
  now: Date,
): Promise<void> {
  await defaultDb
    .insert(schema.personTable)
    .values({
      userId,
      organisationId,
      side: "staff",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [schema.personTable.userId],
      where: sql`${schema.personTable.userId} is not null`,
    });
}

export async function listAllUserIds() {
  return defaultDb.select({ id: schema.userTable.id }).from(schema.userTable);
}

export async function listUserIdsWithPerson() {
  return defaultDb
    .select({ userId: schema.personTable.userId })
    .from(schema.personTable)
    .where(isNotNull(schema.personTable.userId));
}

export async function insertStaffPersonBatch(
  rows: Array<typeof schema.personTable.$inferInsert>,
): Promise<void> {
  await defaultDb
    .insert(schema.personTable)
    .values(rows)
    .onConflictDoNothing({
      target: [schema.personTable.userId],
      where: sql`${schema.personTable.userId} is not null`,
    });
}

// --- default work item types and state templates --------------------------------------

export async function insertDefaultWorkItemTypeRows(
  executor: Inserter,
  rows: Array<typeof schema.workItemTypeTable.$inferInsert>,
): Promise<void> {
  await executor
    .insert(schema.workItemTypeTable)
    .values(rows)
    .onConflictDoNothing({
      target: [
        schema.workItemTypeTable.workspaceId,
        schema.workItemTypeTable.key,
      ],
    });
}

export async function insertDefaultStateTemplateRows(
  executor: Inserter,
  rows: Array<typeof schema.stateTemplateTable.$inferInsert>,
): Promise<void> {
  await executor
    .insert(schema.stateTemplateTable)
    .values(rows)
    .onConflictDoNothing({
      target: [
        schema.stateTemplateTable.workspaceId,
        schema.stateTemplateTable.key,
      ],
    });
}

// --- a project's concrete states ------------------------------------------------------

export async function findAnyProjectState(
  executor: Selector,
  projectId: string,
) {
  return executor
    .select({ id: schema.stateTable.id })
    .from(schema.stateTable)
    .where(eq(schema.stateTable.projectId, projectId))
    .limit(1);
}

export async function listActiveStateTemplates(
  executor: Selector,
  workspaceId: string,
) {
  return executor
    .select()
    .from(schema.stateTemplateTable)
    .where(
      and(
        eq(schema.stateTemplateTable.workspaceId, workspaceId),
        isNull(schema.stateTemplateTable.archivedAt),
      ),
    );
}

export async function insertProjectStateRows(
  executor: Inserter,
  rows: Array<typeof schema.stateTable.$inferInsert>,
): Promise<void> {
  await executor.insert(schema.stateTable).values(rows);
}
